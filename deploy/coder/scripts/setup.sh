#!/usr/bin/env bash
# Runs on every workspace start: clones the repos, writes .env files, installs dependencies,
# then (re)starts the stack with `flixer-stack`.
set -euo pipefail

ROOT="$HOME/projects"
mkdir -p "$ROOT" "$HOME/bin" "$HOME/logs"
sudo chown "$(id -u):$(id -g)" "$ROOT"
mkdir -p "$ROOT/flixer-data"
sudo chown "$(id -u):$(id -g)" "$ROOT/flixer-data"
mkdir -p "$ROOT/flixer-data/media" "$ROOT/flixer-data/avatars" "$ROOT/flixer-data/config" "$ROOT/flixer-data/cache/images" "$ROOT/flixer-data/cache/people" "$ROOT/flixer-data/cache/theme" "$ROOT/flixer-data/cache/trickplay" "$ROOT/flixer-data/cache/subtitles" "$ROOT/flixer-data/database" "$ROOT/flixer-data/logs" "$ROOT/flixer-data/mounts" "$ROOT/flixer-data/backups"
export PATH="$HOME/bin:$PATH"

for repo in flixer flixer-web flixer-indexer flixer-streamer flixer-docs flixer-cloud; do
  if [ ! -d "$ROOT/$repo/.git" ]; then
    if [ "$repo" = flixer-cloud ]; then
      git clone "${GIT_BASE_URL}/$repo.git" "$ROOT/$repo" || \
        echo "Warning: could not clone optional repository $repo; continuing." >&2
    else
      git clone "${GIT_BASE_URL}/$repo.git" "$ROOT/$repo"
    fi
  fi
done

# Projects is a host bind mount, so changing its root owner does not change existing files inside it.
# Repair ownership and tracked file modes once; both changes persist on the host mount.
restore_tracked_modes() {
  local repo_path="$1" entry metadata path mode stage
  while IFS= read -r -d '' entry; do
    metadata="${entry%%$'\t'*}"
    path="${entry:${#metadata}+1}"
    mode="${metadata%% *}"
    stage="${metadata##* }"
    [ "$stage" = 0 ] || continue
    case "$mode" in
      100644) chmod 644 -- "$repo_path/$path" ;;
      100755) chmod 755 -- "$repo_path/$path" ;;
    esac
  done < <(git -C "$repo_path" ls-files --stage -z)
}

OWNERSHIP_MARKER="$ROOT/.flixer-repo-ownership-$(id -u)-$(id -g)-v2"
if [ ! -e "$OWNERSHIP_MARKER" ]; then
  for repo in flixer flixer-web flixer-indexer flixer-streamer flixer-docs flixer-cloud; do
    if [ -d "$ROOT/$repo" ]; then
      sudo chown -R "$(id -u):$(id -g)" "$ROOT/$repo"
      if git -C "$ROOT/$repo" rev-parse --git-dir >/dev/null 2>&1; then
        restore_tracked_modes "$ROOT/$repo"
      fi
    fi
  done
  touch "$OWNERSHIP_MARKER"
fi

# Secrets are generated once and kept in the home volume.
SECRETS="$HOME/.flixer-dev-secrets"
if [ ! -f "$SECRETS" ]; then
  {
    echo "JWT_SECRET=$(openssl rand -hex 32)"
    echo "APP_SECRET=$(openssl rand -hex 32)"
  } > "$SECRETS"
  chmod 600 "$SECRETS"
fi
# shellcheck disable=SC1090
. "$SECRETS"

# Written only when missing so local edits (provider keys, etc.) survive restarts.
if [ ! -f "$ROOT/flixer/.env" ]; then
  cat > "$ROOT/flixer/.env" <<EOF
JWT_SECRET=$JWT_SECRET
APP_SECRET=$APP_SECRET
PORT=8083
REDIS_URL=redis://redis:6379
FLIXER_PUBLIC_URL=$PUBLIC_URL
APP_URL=$PUBLIC_URL
PASSKEY_RP_ID=$PUBLIC_HOST
PASSKEY_ORIGINS=$PUBLIC_URL
DATA_DIR=$ROOT/flixer-data
MEDIA_PATH=$ROOT/flixer-data/media
STREAM_MEDIA_ROOT=$ROOT/flixer-data/media
MEILISEARCH_URL=http://meilisearch:7700
SMB_MOUNT_SUDO=true
EOF
fi

if [ ! -f "$ROOT/flixer-streamer/.env" ]; then
  cat > "$ROOT/flixer-streamer/.env" <<EOF
PORT=8091
DATA_DIR=$ROOT/flixer-data
FLIXER_URL=http://localhost:8083
EOF
fi

if [ ! -f "$ROOT/flixer-indexer/.env" ]; then
  cat > "$ROOT/flixer-indexer/.env" <<EOF
PORT=8092
ROLE=all
DATA_DIR=$ROOT/flixer-data
FLIXER_URL=http://localhost:8083
EOF
fi

# Existing local env files keep their provider keys. DATA_DIR is the one data root; services derive DATA_PATH and every
# folder under it from it, so stale per-folder overrides are removed.
for env_file in "$ROOT/flixer/.env" "$ROOT/flixer-streamer/.env" "$ROOT/flixer-indexer/.env"; do
  sed -i -E '/^(DATA_PATH|DATA_DIR|LOG_DIR|CACHE_PATH|TRICKPLAY_DIR|TRANSCODE_DIR|SUBTITLE_DIR)=/d' "$env_file"
  printf 'DATA_DIR=%s\n' "$ROOT/flixer-data" >> "$env_file"
done
if ! grep -q '^REDIS_URL=' "$ROOT/flixer/.env"; then
  printf 'REDIS_URL=redis://redis:6379\n' >> "$ROOT/flixer/.env"
fi
if grep -q '^MEILISEARCH_URL=' "$ROOT/flixer/.env"; then
  sed -i 's|^MEILISEARCH_URL=.*|MEILISEARCH_URL=http://meilisearch:7700|' "$ROOT/flixer/.env"
else
  printf 'MEILISEARCH_URL=http://meilisearch:7700\n' >> "$ROOT/flixer/.env"
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
  # The API publishes its app secret here and the streamer and indexer read it, so the three always agree.
  export APP_SECRET_FILE="${APP_SECRET_FILE:-$RUN/app-secret}"
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
# A secret file left by an earlier run can differ from the one the API publishes on boot, so clear it before the API starts.
# The streamer and indexer wait for the fresh file instead of reading the old value.
reset_secret() {
  case " $* " in *" api "*) is_running api || rm -f "${STREAM_TOKEN_SECRET_FILE:-$RUN/stream-token-secret}" "${APP_SECRET_FILE:-$RUN/app-secret}" ;; esac
}

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
  start) reset_secret $(targets "${@:2}"); each_parallel start_one $(targets "${@:2}") ;;
  stop) each_parallel stop_one $(targets "${@:2}") ;;
  restart) each_parallel stop_one $(targets "${@:2}"); reset_secret $(targets "${@:2}"); each_parallel start_one $(targets "${@:2}") ;;
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

# Existing workspaces were built before ping was added to the image.
command -v ping >/dev/null 2>&1 || { sudo apt-get update -qq && sudo apt-get install -y -qq --no-install-recommends iputils-ping; } || true

# The indexer and streamer run inside this workspace, so their service names resolve to it (as in Compose).
grep -qE '(^|[[:space:]])indexer([[:space:]]|$)' /etc/hosts || echo "127.0.0.1 indexer streamer" | sudo tee -a /etc/hosts >/dev/null

# Wait for the sidecars, then start.
for _ in $(seq 1 60); do
  pg_isready -h postgres -U flixer -q && redis-cli -h redis ping >/dev/null 2>&1 && break
  sleep 1
done

flixer-stack restart
echo "Flixer dev stack started. Use 'flixer-stack status|logs <service>|restart <service>'."
