#!/bin/sh
set -eu

if [ -z "${SMB_PASSWORD:-}" ]; then
  echo "SMB_PASSWORD must be configured." >&2
  exit 1
fi

for _ in $(seq 1 120); do
  if ip -o addr show dev tailscale0 2>/dev/null | grep -q 'scope global'; then
    break
  fi
  sleep 1
done

if ! ip -o addr show dev tailscale0 2>/dev/null | grep -q 'scope global'; then
  echo "Tailscale interface did not become ready; refusing to start SMB." >&2
  exit 1
fi

printf '%s\n%s\n' "$SMB_PASSWORD" "$SMB_PASSWORD" | smbpasswd -s -a coder >/dev/null
unset SMB_PASSWORD

exec smbd --foreground --no-process-group
