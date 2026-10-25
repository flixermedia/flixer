#!/usr/bin/env bash
# Flixer installer for macOS and Debian/Ubuntu Linux.
#
#   curl -fsSL https://get.flixer.dev | bash
#   curl -fsSL https://get.flixer.dev | bash -s -- --yes --dir ~/flixer
#
# Options:
#   --dir <path>       install directory (default ~/flixer)
#   --data <path>      data folder (default <dir>/data)
#   --media <path>     media folder (default <dir>/media)
#   --port <port>      HTTP port (default 8080)
#   --version <tag>    pin the Flixer image version (default latest)
#   --ref <git ref>    repo ref to download compose files from (default main)
#   --smb              set up an SMB share (host, share, user and password are asked for)
#   --smb-host/--smb-share/--smb-user/--smb-pass <value>   SMB details (implies --smb)
#   --install-docker   install Docker if it is missing without asking
#   --yes              accept all defaults, never prompt
#   --dry-run          print what would happen without changing anything
#   --no-start         write the files but do not start the stack
set -euo pipefail

REPO_RAW="https://raw.githubusercontent.com/flixermedia/flixer"
REF="${FLIXER_REF:-main}"
INSTALL_DIR="${FLIXER_DIR:-$HOME/flixer}"
DATA_PATH="${FLIXER_DATA_PATH:-}"
MEDIA_PATH="${FLIXER_MEDIA_PATH:-}"
HTTP_PORT="${FLIXER_HTTP_PORT:-8080}"
FLIXER_VERSION_PIN="${FLIXER_VERSION:-}"
SMB_HOST="${SMB_HOST:-}"
SMB_SHARE="${SMB_SHARE:-}"
SMB_USERNAME="${SMB_USERNAME:-}"
SMB_PASSWORD="${SMB_PASSWORD:-}"
USE_SMB=false
ASSUME_YES=false
DRY_RUN=false
START=true
INSTALL_DOCKER=false

if [ -t 1 ]; then B=$'\033[1m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; N=$'\033[0m'; else B=""; G=""; Y=""; R=""; N=""; fi
info() { printf '%s==>%s %s\n' "$B" "$N" "$*"; }
ok() { printf '%s✓%s %s\n' "$G" "$N" "$*"; }
warn() { printf '%s!%s %s\n' "$Y" "$N" "$*" >&2; }
die() { printf '%s✗ %s%s\n' "$R" "$*" "$N" >&2; exit 1; }

while [ $# -gt 0 ]; do
    case "$1" in
        --dir) INSTALL_DIR="${2:?}"; shift 2 ;;
        --data) DATA_PATH="${2:?}"; shift 2 ;;
        --media) MEDIA_PATH="${2:?}"; shift 2 ;;
        --port) HTTP_PORT="${2:?}"; shift 2 ;;
        --version) FLIXER_VERSION_PIN="${2:?}"; shift 2 ;;
        --ref) REF="${2:?}"; shift 2 ;;
        --smb) USE_SMB=true; shift ;;
        --smb-host) SMB_HOST="${2:?}"; USE_SMB=true; shift 2 ;;
        --smb-share) SMB_SHARE="${2:?}"; USE_SMB=true; shift 2 ;;
        --smb-user) SMB_USERNAME="${2:?}"; USE_SMB=true; shift 2 ;;
        --smb-pass) SMB_PASSWORD="${2:?}"; USE_SMB=true; shift 2 ;;
        --install-docker) INSTALL_DOCKER=true; shift ;;
        --yes | -y) ASSUME_YES=true; shift ;;
        --dry-run) DRY_RUN=true; shift ;;
        --no-start) START=false; shift ;;
        -h | --help) sed -n '2,23p' "$0" 2>/dev/null | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) die "Unknown option: $1" ;;
    esac
done

# Prompts read from the terminal so the script still works when piped from curl.
CAN_PROMPT=false
if ! $ASSUME_YES && [ -r /dev/tty ] && { : </dev/tty; } 2>/dev/null; then CAN_PROMPT=true; fi

ask() { # ask <prompt> <default> -> echoes the answer
    local reply=""
    if $CAN_PROMPT; then
        read -r -p "$1 [$2]: " reply </dev/tty || true
    fi
    printf '%s' "${reply:-$2}"
}
confirm() { # confirm <prompt> <default y|n>
    local def="$2" reply=""
    if $CAN_PROMPT; then
        read -r -p "$1 [$([ "$def" = y ] && echo Y/n || echo y/N)]: " reply </dev/tty || true
    fi
    reply="${reply:-$def}"
    case "$reply" in y | Y | yes | YES) return 0 ;; *) return 1 ;; esac
}
run() {
    if $DRY_RUN; then printf '  [dry-run] %s\n' "$*"; else "$@"; fi
}
as_root() {
    if [ "$(id -u)" -eq 0 ]; then run "$@"; else run sudo "$@"; fi
}
# shellcheck disable=SC2088 # the tilde is matched literally on purpose
expand() { case "$1" in "~") printf '%s' "$HOME" ;; "~/"*) printf '%s' "$HOME/${1#\~/}" ;; *) printf '%s' "$1" ;; esac; }
rand_hex() { LC_ALL=C tr -dc 'a-f0-9' </dev/urandom | head -c "${1:-32}"; }

OS="$(uname -s)"
case "$OS" in
    Darwin) PLATFORM=mac ;;
    Linux)
        if [ -r /etc/os-release ] && grep -qiE '^ID(_LIKE)?=.*(debian|ubuntu)' /etc/os-release; then
            PLATFORM=debian
        else
            PLATFORM=linux
            warn "Only Debian/Ubuntu is officially supported; automatic Docker install is disabled on this distro."
        fi
        ;;
    *) die "Unsupported OS: $OS. Flixer's installer supports macOS and Linux." ;;
esac

command -v curl >/dev/null 2>&1 || die "curl is required."

printf '\n%sFlixer installer%s (%s)\n\n' "$B" "$N" "$PLATFORM"

# --- Docker -----------------------------------------------------------------
have_compose() { docker compose version >/dev/null 2>&1; }

install_docker() {
    case "$PLATFORM" in
        mac)
            if command -v brew >/dev/null 2>&1; then
                info "Installing Docker Desktop with Homebrew"
                run brew install --cask docker
                info "Starting Docker Desktop"
                run open -a Docker
            else
                die "Homebrew is not installed. Install Docker Desktop from https://www.docker.com/products/docker-desktop/ (or install Homebrew from https://brew.sh) and re-run this script."
            fi
            ;;
        debian)
            info "Installing Docker Engine with the official convenience script"
            if $DRY_RUN; then
                echo "  [dry-run] curl -fsSL https://get.docker.com | sh"
            else
                curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
                as_root sh /tmp/get-docker.sh
                rm -f /tmp/get-docker.sh
            fi
            as_root systemctl enable --now docker
            if [ "$(id -u)" -ne 0 ]; then as_root usermod -aG docker "$USER"; fi
            ;;
        *) die "Install Docker manually: https://docs.docker.com/engine/install/" ;;
    esac
}

wait_for_docker() {
    for _ in $(seq 1 60); do
        docker info >/dev/null 2>&1 && return 0
        sleep 2
    done
    return 1
}

DOCKER=(docker)
if command -v docker >/dev/null 2>&1 && have_compose; then
    ok "Docker and Compose found"
else
    warn "Docker with the Compose plugin was not found."
    if $INSTALL_DOCKER || confirm "Install Docker now?" "$($ASSUME_YES && echo y || echo n)"; then
        install_docker
    else
        die "Docker is required. Install it and re-run this script."
    fi
fi

if ! $DRY_RUN; then
    if ! docker info >/dev/null 2>&1; then
        if [ "$PLATFORM" = mac ]; then
            info "Waiting for Docker Desktop to start (accept any prompts it shows)"
            wait_for_docker || die "Docker is not running. Start Docker Desktop and re-run."
        elif sudo -n true 2>/dev/null || [ "$(id -u)" -eq 0 ]; then
            # Group membership from a fresh install only applies to new shells.
            DOCKER=(sudo docker)
            "${DOCKER[@]}" info >/dev/null 2>&1 || die "Cannot reach the Docker daemon."
        else
            die "Cannot reach the Docker daemon. Start it, or log out and in again if Docker was just installed."
        fi
    fi
fi

# --- Configuration ----------------------------------------------------------
INSTALL_DIR="$(expand "$INSTALL_DIR")"
$CAN_PROMPT && INSTALL_DIR="$(expand "$(ask "Install directory" "$INSTALL_DIR")")"
DATA_PATH="$(expand "${DATA_PATH:-$INSTALL_DIR/data}")"
MEDIA_PATH="$(expand "${MEDIA_PATH:-$INSTALL_DIR/media}")"
if $CAN_PROMPT; then
    DATA_PATH="$(expand "$(ask "Data folder (database backups, metadata, avatars, logs)" "$DATA_PATH")")"
    MEDIA_PATH="$(expand "$(ask "Media folder (your movies and shows)" "$MEDIA_PATH")")"
    HTTP_PORT="$(ask "HTTP port" "$HTTP_PORT")"
    if ! $USE_SMB && confirm "Connect a network (SMB) share for media?" n; then USE_SMB=true; fi
fi
case "$HTTP_PORT" in '' | *[!0-9]*) die "Invalid port: $HTTP_PORT" ;; esac

if $USE_SMB; then
    if $CAN_PROMPT; then
        SMB_HOST="$(ask "SMB server IP address" "${SMB_HOST:-192.168.1.10}")"
        SMB_SHARE="$(ask "SMB share name" "${SMB_SHARE:-media}")"
        SMB_USERNAME="$(ask "SMB username (guest for none)" "${SMB_USERNAME:-guest}")"
        if [ "$SMB_USERNAME" != guest ] && [ -z "$SMB_PASSWORD" ]; then
            read -r -s -p "SMB password: " SMB_PASSWORD </dev/tty || true
            echo
        fi
    fi
    [ -n "$SMB_HOST" ] && [ -n "$SMB_SHARE" ] || die "SMB needs --smb-host and --smb-share."
    case "$SMB_PASSWORD" in *,*) die "SMB passwords containing a comma are not supported." ;; esac
fi

info "Installing into $INSTALL_DIR"
run mkdir -p "$INSTALL_DIR" "$DATA_PATH" "$MEDIA_PATH"

fetch() { # fetch <file>
    info "Downloading $1"
    if $DRY_RUN; then echo "  [dry-run] $REPO_RAW/$REF/$1 -> $INSTALL_DIR/$1"; return; fi
    curl -fsSL "$REPO_RAW/$REF/$1" -o "$INSTALL_DIR/$1.tmp" && mv "$INSTALL_DIR/$1.tmp" "$INSTALL_DIR/$1"
}
fetch docker-compose.yml
$USE_SMB && fetch docker-compose.smb-volume.yml

# --- .env -------------------------------------------------------------------
ENV_FILE="$INSTALL_DIR/.env"
write_env=true
if [ -f "$ENV_FILE" ]; then
    if confirm ".env already exists. Overwrite it (a backup is kept)?" n; then
        run cp "$ENV_FILE" "$ENV_FILE.bak.$(date +%s)"
    else
        write_env=false
        warn "Keeping existing .env"
    fi
fi

if $write_env; then
    info "Writing .env"
    if $DRY_RUN; then
        echo "  [dry-run] $ENV_FILE with DATA_PATH=$DATA_PATH MEDIA_PATH=$MEDIA_PATH HTTP_PORT=$HTTP_PORT"
    else
        umask 077
        {
            echo "# Generated by the Flixer installer"
            echo "DATA_PATH=$DATA_PATH"
            echo "MEDIA_PATH=$MEDIA_PATH"
            echo "HTTP_PORT=$HTTP_PORT"
            echo "PROJECT_DIR=$INSTALL_DIR"
            [ -n "$FLIXER_VERSION_PIN" ] && echo "FLIXER_VERSION=$FLIXER_VERSION_PIN"
            if $USE_SMB; then
                echo "COMPOSE_FILE=docker-compose.yml:docker-compose.smb-volume.yml"
                echo "SMB_HOST=$SMB_HOST"
                echo "SMB_SHARE=$SMB_SHARE"
                echo "SMB_USERNAME=${SMB_USERNAME:-guest}"
                echo "SMB_PASSWORD=$SMB_PASSWORD"
            fi
        } >"$ENV_FILE"
        chmod 600 "$ENV_FILE"
    fi
fi

# --- Start ------------------------------------------------------------------
if ! $START; then
    ok "Files written. Start Flixer with: cd $INSTALL_DIR && docker compose up -d"
    exit 0
fi

info "Pulling images and starting Flixer (this can take a few minutes)"
if $DRY_RUN; then
    echo "  [dry-run] cd $INSTALL_DIR && docker compose up -d --pull always"
    exit 0
fi
cd "$INSTALL_DIR"
"${DOCKER[@]}" compose up -d --pull always

info "Waiting for Flixer to become healthy"
URL="http://localhost:$HTTP_PORT"
for _ in $(seq 1 90); do
    if curl -fsS "$URL/healthz" >/dev/null 2>&1; then
        printf '\n%sFlixer is running!%s\n  Open %s to create your admin account.\n' "$G$B" "$N" "$URL"
        printf '  Manage:  cd %s && docker compose logs -f | down | pull\n' "$INSTALL_DIR"
        printf '  If the database is ever lost, check "docker compose logs api" for a recovery code.\n\n'
        exit 0
    fi
    sleep 2
done
warn "Flixer did not respond in time. Check: cd $INSTALL_DIR && docker compose ps && docker compose logs"
exit 1
