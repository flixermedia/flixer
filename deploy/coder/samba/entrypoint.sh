#!/bin/sh
set -eu

if [ -z "${SMB_PASSWORD:-}" ]; then
  echo "SMB_PASSWORD must be configured." >&2
  exit 1
fi

printf '%s\n%s\n' "$SMB_PASSWORD" "$SMB_PASSWORD" | smbpasswd -s -a coder >/dev/null
unset SMB_PASSWORD

exec smbd --foreground --no-process-group
