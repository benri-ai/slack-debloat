#!/bin/bash
# Launch (or fix) Slack so it always has the CDP port. Used by the
# "Slack Debloat" wrapper app. The injector runs separately as a
# LaunchAgent, so this script only handles Slack itself.
set -euo pipefail

PORT="${SLACK_CDP_PORT:-9222}"

port_open() {
  curl -s -m 1 -o /dev/null "http://127.0.0.1:${PORT}/json/version"
}

if pgrep -q -f "Slack.app/Contents/MacOS/Slack"; then
  if port_open; then
    # Already running with the flag — just bring it to front.
    open -a Slack
    exit 0
  fi
  # Running stock (e.g. macOS reopened it at login) — relaunch flagged.
  osascript -e 'quit app "Slack"' || true
  for _ in $(seq 1 20); do
    pgrep -q -f "Slack.app/Contents/MacOS/Slack" || break
    sleep 0.5
  done
fi

open -a Slack --args \
  --remote-debugging-port="${PORT}" \
  --remote-allow-origins="*"
