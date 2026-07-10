#!/bin/bash
# slack-debloat installer:
#   1. seeds custom.css / custom.js from the examples (if you don't have them)
#   2. installs a LaunchAgent that keeps the injector running at login
#   3. builds "/Applications/Slack Debloat.app" — the icon you click instead of Slack
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LABEL="ai.benri.slack-debloat"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
APP="/Applications/Slack Debloat.app"

# --- prerequisites ---
[ -d "/Applications/Slack.app" ] || { echo "error: /Applications/Slack.app not found"; exit 1; }
NODE="$(command -v node || true)"
[ -n "$NODE" ] || { echo "error: node not found (need Node.js >= 22)"; exit 1; }
"$NODE" -e 'process.exit(+process.versions.node.split(".")[0] >= 22 ? 0 : 1)' \
  || { echo "error: Node.js >= 22 required (built-in WebSocket), found $("$NODE" --version)"; exit 1; }

# --- 1. user files ---
[ -f "$DIR/config.json" ] || cp "$DIR/config.json.example" "$DIR/config.json"
[ -f "$DIR/custom.css" ]  || cp "$DIR/custom.css.example"  "$DIR/custom.css"
[ -f "$DIR/custom.js" ]   || cp "$DIR/custom.js.example"   "$DIR/custom.js"

# --- 2. LaunchAgent (injector) ---
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${NODE}</string>
        <string>${DIR}/inject.mjs</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${DIR}/injector.log</string>
    <key>StandardErrorPath</key>
    <string>${DIR}/injector.log</string>
</dict>
</plist>
EOF
# bootout is async — wait until the old instance is fully gone before
# re-bootstrapping, or launchd returns EIO
if launchctl print "gui/$(id -u)/${LABEL}" >/dev/null 2>&1; then
  launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
  for _ in $(seq 1 20); do
    launchctl print "gui/$(id -u)/${LABEL}" >/dev/null 2>&1 || break
    sleep 0.5
  done
fi
launchctl bootstrap "gui/$(id -u)" "$PLIST"

# --- 3. wrapper app ---
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cat > "$APP/Contents/Info.plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key><string>Slack Debloat</string>
    <key>CFBundleDisplayName</key><string>Slack Debloat</string>
    <key>CFBundleIdentifier</key><string>ai.benri.slack-debloat.launcher</string>
    <key>CFBundleVersion</key><string>1.0</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleExecutable</key><string>launcher</string>
    <key>CFBundleIconFile</key><string>app.icns</string>
    <key>LSUIElement</key><true/>
</dict>
</plist>
EOF
cat > "$APP/Contents/MacOS/launcher" <<EOF
#!/bin/bash
exec "${DIR}/launch-slack.sh"
EOF
chmod +x "$APP/Contents/MacOS/launcher"
cp /Applications/Slack.app/Contents/Resources/electron.icns "$APP/Contents/Resources/app.icns"

echo "✓ installed"
echo "  injector:  running as LaunchAgent ${LABEL} (log: ${DIR}/injector.log)"
echo "  launcher:  ${APP} — put this in your Dock instead of Slack"
echo "  config:    edit ${DIR}/config.json — applies live within ~1s"
echo
echo "Launch Slack via 'Slack Debloat' now to activate, then flip options"
echo "in config.json (see README for what each key does)."