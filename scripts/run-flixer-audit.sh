#!/usr/bin/env bash
# Run on the Linux Coder workspace. Ollama runs on the remote Mac via SSH.
set -Eeuo pipefail

MAC_HOST="${MAC_HOST:-ashley@ashleys-macbook-pro}"
LOCAL_PORT="${LOCAL_PORT:-11435}"
MODEL="${MODEL:-qwen2.5-coder:7b}"
ROOT="${ROOT:-$HOME/projects}"
OUT="${OUT:-$HOME/projects/flixer-audit-results}"
SCRIPT="${AUDIT_SCRIPT:-$PWD/scripts/ollama_flixer_audit.py}"
TUNNEL_SESSION="flixer-ollama-tunnel"
AUDIT_SESSION="flixer-audit"
URL="http://127.0.0.1:${LOCAL_PORT}"
ACTION="${1:-start}"
if [[ $# -gt 0 ]]; then shift; fi
AUDIT_ARGS=("$@")

say(){ printf '\n==> %s\n' "$*"; }
fail(){ printf 'ERROR: %s\n' "$*" >&2; exit 1; }
require(){ command -v "$1" >/dev/null || fail "Missing $1. Install it in Coder."; }
has_session(){ tmux has-session -t "=$1" 2>/dev/null; }
api_up(){ curl -fsS --max-time 4 "$URL/api/version" >/dev/null 2>&1; }

case "$ACTION" in
  start)
    require ssh; require tmux; require curl; require python3
    [[ -f "$SCRIPT" ]] || fail "Audit script missing: $SCRIPT. Set AUDIT_SCRIPT=/path/to/ollama_flixer_audit.py"
    [[ -d "$ROOT" ]] || fail "Repository root does not exist: $ROOT"
    mkdir -p "$OUT"
    if ! has_session "$TUNNEL_SESSION"; then
      say "Checking SSH access to $MAC_HOST"
      ssh -o BatchMode=yes -o ConnectTimeout=10 "$MAC_HOST" 'true' || fail "SSH authentication failed. Check SSH keys/host connectivity."
      say "Starting persistent SSH tunnel in tmux ($TUNNEL_SESSION)"
      # The loop retries SSH on connection loss; tmux survives disconnects from Coder.
      printf -v tunnel_cmd 'while true; do ssh -NT -o BatchMode=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=20 -o ServerAliveCountMax=3 -o ConnectTimeout=10 -L %q %q; echo "SSH tunnel disconnected; retrying in 5 seconds"; sleep 5; done' "127.0.0.1:${LOCAL_PORT}:127.0.0.1:11434" "$MAC_HOST"
      tmux new-session -d -s "$TUNNEL_SESSION" "bash -lc $(printf '%q' "$tunnel_cmd")"
    else
      say "Tunnel tmux session already exists"
    fi
    say "Waiting for Ollama through SSH ($URL)"
    ready=0
    for ((i=0;i<20;i++)); do
      if api_up; then ready=1; break; fi
      sleep 2
    done
    ((ready)) || fail "Cannot reach Ollama. Check 'tmux attach -t $TUNNEL_SESSION' and that Ollama is running on the Mac."
    if ! curl -fsS --max-time 10 "$URL/api/tags" | python3 -c 'import json,sys; m=sys.argv[1]; d=json.load(sys.stdin); sys.exit(0 if any(x.get("name")==m or x.get("model")==m for x in d.get("models",[])) else 1)' "$MODEL"; then
      fail "Model $MODEL not found on Mac. Download: ssh $MAC_HOST '/usr/local/bin/ollama pull $MODEL'"
    fi
    if has_session "$AUDIT_SESSION"; then
      say "Audit already running in tmux ($AUDIT_SESSION); not launching another"
    else
      say "Starting resumable audit in tmux ($AUDIT_SESSION)"
      printf -v audit_cmd '%q ' python3 -u "$SCRIPT" --root "$ROOT" --url "$URL" --model "$MODEL" --out "$OUT" "${AUDIT_ARGS[@]}"
      # Keep the terminal open when the audit exits, so errors remain visible.
      tmux new-session -d -s "$AUDIT_SESSION" "bash -lc $(printf '%q' "${audit_cmd}; rc=\$?; echo; echo 'Audit exited with status' \$rc; echo 'Press Enter to close'; read -r")"
    fi
    printf '\nAudit session: tmux attach -t %s\nResults: %s\nStop gracefully: %s stop\n' "$AUDIT_SESSION" "$OUT" "$0"
    ;;
  status)
    require tmux
    for session in "$TUNNEL_SESSION" "$AUDIT_SESSION"; do
      if has_session "$session"; then echo "$session: session exists"; else echo "$session: not running"; fi
    done
    if command -v curl >/dev/null && api_up; then echo "Ollama tunnel API: reachable"; else echo "Ollama tunnel API: unreachable"; fi
    [[ ! -f "$OUT/state.json" ]] || python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print("Completed chunks:",len(d.get("completed",{})),"| Findings:",len(d.get("findings",[])))' "$OUT/state.json"
    ;;
  attach)
    require tmux
    exec tmux attach -t "$AUDIT_SESSION"
    ;;
  stop)
    require tmux
    if has_session "$AUDIT_SESSION"; then
      say "Sending Ctrl+C to audit; it will finish its current Ollama request and checkpoint"
      tmux send-keys -t "$AUDIT_SESSION" C-c
      echo "Check progress: $0 attach (may take several minutes to finish). Tunnel remains running."
    else
      echo "No audit tmux session found"
    fi
    ;;
  tunnel-stop)
    require tmux
    if has_session "$AUDIT_SESSION"; then fail "Stop the audit before stopping the tunnel"; fi
    tmux kill-session -t "$TUNNEL_SESSION" 2>/dev/null || true
    echo "Tunnel stopped"
    ;;
  *)
    echo "Usage: $0 {start|status|attach|stop|tunnel-stop} [extra audit options]"
    echo "Environment overrides: MAC_HOST, LOCAL_PORT, MODEL, ROOT, OUT, AUDIT_SCRIPT"
    exit 2
    ;;
esac
