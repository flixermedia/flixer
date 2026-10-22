#!/usr/bin/env bash
# Runs on every workspace start: clones the repos, writes .env files, installs dependencies,
# then (re)starts the stack with `flixer-stack`.
set -euo pipefail

ROOT="$HOME/projects"
mkdir -p "$ROOT" "$HOME/bin" "$HOME/logs" "$ROOT/flixer-data/media" "$ROOT/flixer-data/avatars" "$ROOT/flixer-data/media-images" "$ROOT/flixer-data/logs"
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
MEDIA_IMAGE_DIR=$ROOT/flixer-data/media-images
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
STREAM_TOKEN_SECRET=$STREAM_TOKEN_SECRET
FLIXER_URL=http://localhost:8083
TRANSCODE_DIR=$ROOT/flixer-data/transcodes
EOF
fi

if [ ! -f "$ROOT/flixer-indexer/.env" ]; then
  cat > "$ROOT/flixer-indexer/.env" <<EOF
PORT=8092
ROLE=all
FLIXER_URL=http://localhost:8083
STREAM_TOKEN_SECRET=$STREAM_TOKEN_SECRET
REDIS_ADDR=redis:6379
CACHE_PATH=$ROOT/flixer-data/cache/metadata
EOF
fi

cat > "$HOME/bin/flixer-stack" <<'EOS'
#!/usr/bin/env bash
# Usage: flixer-stack [start|stop|restart|status|logs [service]] — services: api web indexer streamer docs
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

is_running() { [ -f "$RUN/$1.pid" ] && kill -0 "$(cat "$RUN/$1.pid")" 2>/dev/null; }

start_one() {
  if is_running "$1"; then echo "$1 already running"; return; fi
  IFS='|' read -r dir cmd <<< "$(command_for "$1")"
  # Own session/process group so stop can take down npm/go and their children together.
  (cd "$dir" && setsid bash -c "set -a; [ -f .env ] && . ./.env; set +a; exec $cmd" >> "$LOGS/$1.log" 2>&1 & echo $! > "$RUN/$1.pid")
  echo "started $1"
}

stop_one() {
  if is_running "$1"; then
    kill -- "-$(cat "$RUN/$1.pid")" 2>/dev/null || kill "$(cat "$RUN/$1.pid")" 2>/dev/null
    echo "stopped $1"
  fi
  rm -f "$RUN/$1.pid"
}

case "${1:-status}" in
  start) for s in ${2:-$SERVICES}; do start_one "$s"; done ;;
  stop) for s in ${2:-$SERVICES}; do stop_one "$s"; done ;;
  restart) for s in ${2:-$SERVICES}; do stop_one "$s"; start_one "$s"; done ;;
  status) for s in $SERVICES; do is_running "$s" && echo "$s: running" || echo "$s: stopped"; done ;;
  logs) tail -n 100 -f "$LOGS/${2:-api}.log" ;;
  *) echo "usage: flixer-stack [start|stop|restart|status|logs] [service]"; exit 1 ;;
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
