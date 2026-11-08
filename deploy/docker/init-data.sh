#!/bin/sh
set -eu

DATA_ROOT=${DATA_ROOT:-/data}
APP_LOGS="$DATA_ROOT/app-logs"
LOGGER_LOGS="$DATA_ROOT/logs"

mkdir -p \
	"$DATA_ROOT/advertisements" "$DATA_ROOT/avatars" "$DATA_ROOT/config" \
	"$DATA_ROOT/database" "$DATA_ROOT/cache/images" "$DATA_ROOT/cache/people" \
	"$DATA_ROOT/cache/theme" "$DATA_ROOT/cache/subtitles" "$DATA_ROOT/cache/trickplay" \
	"$DATA_ROOT/cache/trailers" "$DATA_ROOT/mounts" "$DATA_ROOT/backups" \
	"$DATA_ROOT/plugins" "$DATA_ROOT/meilisearch" "$DATA_ROOT/ai/models" \
	"$APP_LOGS" "$LOGGER_LOGS"

# Move legacy shared logs without touching a logger database or replacing a file.
find "$LOGGER_LOGS" -mindepth 1 -maxdepth 1 ! -name logger \
	-exec sh -c '
		set -eu
		destination=$1
		shift
		for source do
			target=$destination/${source##*/}
			if [ -e "$target" ]; then
				echo "Cannot migrate legacy log path; destination already exists: $target" >&2
				exit 1
			fi
			mv "$source" "$target"
		done
	' sh "$APP_LOGS" {} +

	chown root:root "$LOGGER_LOGS"
	chmod 0755 "$LOGGER_LOGS"
	chown -R 1000:1000 \
		"$DATA_ROOT/advertisements" "$DATA_ROOT/avatars" "$DATA_ROOT/config" \
	"$DATA_ROOT/mounts" "$DATA_ROOT/backups" "$DATA_ROOT/plugins" "$APP_LOGS"
find "$APP_LOGS" -type d -exec chmod 0750 {} +
find "$APP_LOGS" -type f -exec chmod 0640 {} +
chown 70:70 "$DATA_ROOT/database"
chown -R 65532:65532 "$DATA_ROOT/cache"
find "$DATA_ROOT/cache" -type d -exec chmod 2775 {} +
chmod 0755 "$DATA_ROOT/plugins"
chown 10001:10001 "$DATA_ROOT/ai" "$DATA_ROOT/ai/models"
chown 1000:1000 /run/flixer-secrets
chmod 0755 /run/flixer-secrets
touch /run/flixer-secrets/logger-ca.crt
chmod 0644 /run/flixer-secrets/logger-ca.crt
install -d -o 1000 -g 1000 -m 0700 /run/flixer-secrets/logger

mkdir -p "$LOGGER_LOGS/logger"
if [ "$(stat -c '%u' "$LOGGER_LOGS/logger" 2>/dev/null || echo 0)" != 1000 ]; then
	chown -R 1000:1000 "$LOGGER_LOGS/logger"
fi
install -d -o 1000 -g 1000 -m 0700 "$LOGGER_LOGS/logger"
touch "$LOGGER_LOGS/logger/tls.crt" "$LOGGER_LOGS/logger/tls.key"
chown 1000:1000 "$LOGGER_LOGS/logger/tls.crt" "$LOGGER_LOGS/logger/tls.key"
chmod 0644 "$LOGGER_LOGS/logger/tls.crt"
chmod 0600 "$LOGGER_LOGS/logger/tls.key"
