#!/bin/bash
# Removes the LaunchAgent and wrapper app. Leaves this directory (and your
# custom.css/custom.js) alone. Relaunch Slack normally to get stock behavior.
set -uo pipefail

LABEL="ai.benri.slack-debloat"
launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null
rm -f "$HOME/Library/LaunchAgents/${LABEL}.plist"
rm -rf "/Applications/Slack Debloat.app"
echo "✓ uninstalled — quit and reopen Slack normally to return to stock"