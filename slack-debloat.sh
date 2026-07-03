#!/bin/bash
# Launch native Slack with a localhost-only CDP port and run the injector.
# Usage: ./slack-debloat.sh   (Ctrl-C stops the injector; Slack keeps running)
set -euo pipefail

PORT="${SLACK_CDP_PORT:-9222}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Slack must be launched fresh with the flag — quit a running instance.
if pgrep -q -f "Slack.app/Contents/MacOS/Slack"; then
  echo "Quitting running Slack…"
  osascript -e 'quit app "Slack"' || true
  for _ in $(seq 1 20); do
    pgrep -q -f "Slack.app/Contents/MacOS/Slack" || break
    sleep 0.5
  done
fi

echo "Launching Slack with CDP on 127.0.0.1:${PORT}…"
# --remote-allow-origins: Chromium ≥111 rejects CDP websocket clients with
# unexpected Origin headers without it. Port binds to localhost only.
open -a Slack --args \
  --remote-debugging-port="${PORT}" \
  --remote-allow-origins="*"

exec node "${DIR}/inject.mjs"
