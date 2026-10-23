#!/usr/bin/env bash
# Runs on every workspace start: clones the repos, writes .env files, installs dependencies,
# then (re)starts the stack with `flixer-stack`.
set -euo pipefail

ROOT="$HOME/projects"
mkdir -p "$ROOT" "$HOME/bin" "$HOME/logs" "$ROOT/flixer-data/media" "$ROOT/flixer-data/avatars" "$ROOT/flixer-data/metadata" "$ROOT/flixer-data/logs"
export PATH="$HOME/bin:$PATH"

for repo in flixer flixer-web flixer-indexer flixer-streamer flixer-docs; do
  [ -d "$ROOT/$repo/.git" ] || git clone "${GIT_BASE_URL}/$repo.git" "$ROOT/$repo"
done

# Secrets are generated once and kept in the home volume.
SECRETS="$HOME/.flixer-dev-secrets"
if [ ! -f "$SECRETS" ]; then
  {
    echo "JWT_SECRET=$(openssl rand -hex 32)"
    echo "STREAM_TOKEN_SECRET=$(openssl rand -hex 32)"
  } > "$SECRETS"
  chmod 600 "$SECRETS"
fi
# shellcheck disable=SC1090
. "$SECRETS"

# Written only when missing so local edits (provider keys, etc.) survive restarts.
if [ ! -f "$ROOT/flixer/.env" ]; then
  cat > "$ROOT/flixer/.env" <<EOF
DATABASE_URL=postgres://flixer:flixer@postgres:5432/flixer
JWT_SECRET=$JWT_SECRET
STREAM_TOKEN_SECRET=$STREAM_TOKEN_SECRET
PORT=8083
FLIXER_PUBLIC_URL=$PUBLIC_URL
APP_URL=$PUBLIC_URL
PASSKEY_RP_ID=$PUBLIC_HOST
PASSKEY_ORIGINS=$PUBLIC_URL
MEDIA_PATH=$ROOT/flixer-data/media
AVATAR_DIR=$ROOT/flixer-data/avatars
METADATA_DIR=$ROOT/flixer-data/metadata
STREAM_MEDIA_ROOT=$ROOT/flixer-data/media
LOG_DIR=$ROOT/flixer-data/logs
STREAMER_INTERNAL_URL=http://localhost:8091
INDEXER_URL=http://localhost:8092
SMB_MOUNT_SUDO=true
EOF
fi

if [ ! -f "$ROOT/flixer-streamer/.env" ]; then
  cat > "$ROOT/flixer-streamer/.env" <<EOF
PORT=8091
FLIXER_URL=http://localhost:8083
TRANSCODE_DIR=$ROOT/flixer-data/transcodes
EOF
fi

if [ ! -f "$ROOT/flixer-indexer/.env" ]; then
  cat > "$ROOT/flixer-indexer/.env" <<EOF
PORT=8092
ROLE=all
FLIXER_URL=http://localhost:8083
CACHE_PATH=$ROOT/flixer-data/cache/metadata
EOF
fi

cat > "$HOME/bin/flixer-stack" <<'EOS'
#!/usr/bin/env bash
# Usage: flixer-stack [start|stop|restart|status|logs [service]] — service defaults to all: api streamer indexer web docs
set -uo pipefail
ROOT="$HOME/projects"
RUN="$HOME/.flixer-run"
LOGS="$HOME/logs"
mkdir -p "$RUN" "$LOGS"
SERVICES="api streamer indexer web docs"

command_for() {
  case "$1" in
    api) echo "$ROOT/flixer|npm start" ;;
    streamer) echo "$ROOT/flixer-streamer|go run ./cmd/flixer-streamer" ;;
    indexer) echo "$ROOT/flixer-indexer|go run ./cmd/flixer-indexer" ;;
    web) echo "$ROOT/flixer-web|npm run dev -- --port 5173" ;;
    docs) echo "$ROOT/flixer-docs|npm start -- --host 0.0.0.0 --port 3000 --no-open" ;;
  esac
}

match_for() {
  case "$1" in
    api) echo 'npm start|npm run barrels|tsed' ;;
    streamer) echo 'go run|go-build|flixer-streamer' ;;
    indexer) echo 'go run|go-build|flixer-indexer' ;;
    web) echo 'npm run dev|vite' ;;
    docs) echo 'npm start|docusaurus' ;;
  esac
}

# Services are found by working directory and command line rather than by a recorded pid, so a stale or missing
# pid file (or a copy started by hand or by an older run) can never hide a running service from stop/status.
find_pids() {
  local dir pat p pid args
  IFS='|' read -r dir _ <<< "$(command_for "$1")"
  pat="$(match_for "$1")"
  for p in /proc/[0-9]*; do
    pid="${p#/proc/}"
    [ "$pid" = "$$" ] && continue
    [ "$(readlink "$p/cwd" 2>/dev/null)" = "$dir" ] || continue
    args="$(tr '\0' ' ' < "$p/cmdline" 2>/dev/null)"
    [[ "$args" =~ $pat ]] && echo "$pid"
  done
}

is_running() { [ -n "$(find_pids "$1")" ]; }

# Signals a process, and its whole group when it leads one, so npm/go take their children down with them.
signal_tree() {
  local sig="$1" pid="$2" pgid own
  pgid="$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ')"
  own="$(ps -o pgid= -p "$$" | tr -d ' ')"
  [ -n "$pgid" ] || return 0
  if [ "$pgid" = "$pid" ] && [ "$pgid" != "$own" ]; then
    kill "-$sig" -- "-$pgid" 2>/dev/null
  else
    kill "-$sig" "$pid" 2>/dev/null
  fi
}

start_one() {
  if is_running "$1"; then echo "$1 already running"; return; fi
  IFS='|' read -r dir cmd <<< "$(command_for "$1")"
  # The API publishes its stream token secret here and the streamer and indexer read it, so the three always agree.
  export STREAM_TOKEN_SECRET_FILE="${STREAM_TOKEN_SECRET_FILE:-$RUN/stream-token-secret}"
  # The workspace has passwordless sudo and SYS_ADMIN, which is how flixer mounts SMB shares without running as root.
  export SMB_MOUNT_SUDO="${SMB_MOUNT_SUDO:-true}"
  # Own session/process group so stop can take down npm/go and their children together.
  (cd "$dir" && setsid bash -c "set -a; [ -f .env ] && . ./.env; set +a; exec $cmd" >> "$LOGS/$1.log" 2>&1 &)
  echo "started $1"
}

stop_one() {
  local pids pid
  pids="$(find_pids "$1")"
  [ -n "$pids" ] || return 0
  for pid in $pids; do signal_tree TERM "$pid"; done
  for _ in $(seq 1 20); do
    is_running "$1" || break
    sleep 0.5
  done
  for pid in $(find_pids "$1"); do signal_tree KILL "$pid"; done
  echo "stopped $1"
}

# Runs a function for every given service at once and waits, so stopping or starting everything takes as long as the slowest one.
each_parallel() {
  local fn="$1"; shift
  local s
  for s in "$@"; do "$fn" "$s" & done
  wait
}

# Interleaves the logs of several services, each line prefixed with its service name. Ctrl+C ends all of them.
tail_logs() {
  local s
  trap 'kill $(jobs -p) 2>/dev/null' EXIT INT TERM
  for s in "$@"; do
    touch "$LOGS/$s.log"
    tail -n "${LOG_LINES:-20}" -F "$LOGS/$s.log" 2>/dev/null | sed -u "s/^/[$s] /" &
  done
  wait
}

targets() { if [ "$#" -eq 0 ] || [ "$1" = all ]; then echo $SERVICES; else echo "$@"; fi; }

case "${1:-status}" in
  start) each_parallel start_one $(targets "${@:2}") ;;
  stop) each_parallel stop_one $(targets "${@:2}") ;;
  restart) each_parallel stop_one $(targets "${@:2}"); each_parallel start_one $(targets "${@:2}") ;;
  status) for s in $SERVICES; do is_running "$s" && echo "$s: running" || echo "$s: stopped"; done ;;
  logs) tail_logs $(targets "${@:2}") ;;
  *) echo "usage: flixer-stack [start|stop|restart|status|logs] [all|service]"; exit 1 ;;
esac
EOS
chmod +x "$HOME/bin/flixer-stack"

# Dependencies; reinstalled only when the lockfile changes.
install_node() {
  local dir="$ROOT/$1" stamp="$ROOT/$1/node_modules/.lock-hash"
  local hash; hash="$(sha256sum "$dir/package-lock.json" | cut -d' ' -f1)"
  if [ ! -f "$stamp" ] || [ "$(cat "$stamp")" != "$hash" ]; then
    (cd "$dir" && npm ci && echo "$hash" > "$stamp")
  fi
}
install_node flixer
install_node flixer-web
install_node flixer-docs
(cd "$ROOT/flixer-indexer" && go mod download)
(cd "$ROOT/flixer-streamer" && go mod download)

# Wait for the sidecars, then start.
for _ in $(seq 1 60); do
  pg_isready -h postgres -U flixer -q && redis-cli -h redis ping >/dev/null 2>&1 && break
  sleep 1
done

flixer-stack restart
echo "Flixer dev stack started. Use 'flixer-stack status|logs <service>|restart <service>'."
