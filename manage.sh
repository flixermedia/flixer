#!/usr/bin/env bash
# Manage an installed Flixer stack: ./manage.sh [start|stop|restart|update|status]
set -euo pipefail

cd "$(dirname "$0")"
[ -f .env ] && [ -f docker-compose.yml ] || { echo "Run this script from a Flixer installation with .env and docker-compose.yml." >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "Docker and the Compose plugin are required." >&2; exit 1; }
DOCKER=(docker)
if ! docker info >/dev/null 2>&1; then
    if command -v sudo >/dev/null 2>&1 && sudo -n docker info >/dev/null 2>&1; then
        DOCKER=(sudo docker)
    else
        echo "Cannot reach Docker. Start Docker or grant your user access." >&2
        exit 1
    fi
fi
"${DOCKER[@]}" compose version >/dev/null || { echo "Docker Compose is required." >&2; exit 1; }

data_dir=$("${DOCKER[@]}" compose config --environment | sed -n 's/^DATA_DIR=//p')
[ -n "$data_dir" ] || { echo "DATA_DIR is not configured." >&2; exit 1; }
COMPOSE=("${DOCKER[@]}" compose)
if [ -f "$data_dir/updater-state/versions.env" ]; then
    COMPOSE+=(--env-file .env --env-file "$data_dir/updater-state/versions.env")
fi

action=${1:-}
if [ -z "$action" ]; then
    printf 'Flixer management\n  1) Start\n  2) Stop\n  3) Restart\n  4) Update\n  5) Status\n'
    read -r -p 'Choose an action: ' action
fi
[ "$#" -le 1 ] || { echo "Usage: $0 [start|stop|restart|update|status]" >&2; exit 2; }
case "$action" in
    1|start) "${COMPOSE[@]}" up -d ;;
    2|stop) "${COMPOSE[@]}" --profile '*' stop ;;
    3|restart) "${COMPOSE[@]}" --profile '*' stop; "${COMPOSE[@]}" up -d ;;
    4|update)
        echo "Pulling configured image tags. Pinned versions remain pinned; use Admin > Updates to change them safely."
        "${COMPOSE[@]}" pull
        "${COMPOSE[@]}" up -d
        ;;
    5|status) "${COMPOSE[@]}" ps ;;
    *) echo "Usage: $0 [start|stop|restart|update|status]" >&2; exit 2 ;;
esac
