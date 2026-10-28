#!/usr/bin/env bash
# Builds the older Swift shell's "Liner Code.app" (the Electron one is scripts/build-mac.sh): the
# web app, the Swift shell, the engine's source and its one dependency, an icon, and an ad-hoc
# signature. Output: build/swift/Liner Code.app
#   npm run mac:swift          a release build
#   npm run mac:swift -- --open   …and open it
#   npm run mac:swift -- --bundle-node   …with this Mac's Node inside, for people without one
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
APP="$ROOT/build/swift/Liner Code.app"
VERSION="$(node -p "require('./package.json').version")"

echo "→ Building the app's pages"
npm run build -w ui >/dev/null

echo "→ Building the macOS shell"
(cd mac && swift build -c release 2>&1 | tail -1)
BIN="$(cd mac && swift build -c release --show-bin-path)/LinerCode"

echo "→ Putting the bundle together"
rm -rf "$APP"
mkdir -p "$ROOT/build/swift" "$APP/Contents/MacOS" "$APP/Contents/Resources/app/engine" "$APP/Contents/Resources/app/contracts" "$APP/Contents/Resources/app/node_modules/@anthropic-ai"
cp "$BIN" "$APP/Contents/MacOS/LinerCode"
cp -R ui/dist "$APP/Contents/Resources/ui"
cp -R engine/src engine/package.json "$APP/Contents/Resources/app/engine/"
cp -R contracts/src contracts/package.json "$APP/Contents/Resources/app/contracts/"
# The engine's only dependency. Its own Claude Code binary (about 260 MB) stays out: the engine
# drives the claude you installed and signed in to, so your plan and settings come along.
cp -R node_modules/@anthropic-ai/claude-agent-sdk "$APP/Contents/Resources/app/node_modules/@anthropic-ai/"
echo '{"type":"module"}' > "$APP/Contents/Resources/app/package.json"
if [[ " $* " == *" --bundle-node "* ]]; then
  # About 110 MB. The shell prefers it over a Node on PATH. It has to stand alone: Homebrew's
  # node links to Homebrew's libraries, so point LINER_NODE at the binary from nodejs.org.
  NODE_BIN="$(python3 -c 'import os,sys;print(os.path.realpath(sys.argv[1]))' "${LINER_NODE:-$(command -v node)}")"
  if otool -L "$NODE_BIN" | tail -n +2 | grep -qvE '^\s*(/usr/lib/|/System/)'; then
    echo "✗ $NODE_BIN needs libraries outside macOS. Download Node's macOS binary from nodejs.org and run with LINER_NODE=/path/to/node/bin/node." >&2
    exit 1
  fi
  echo "→ Bundling Node $("$NODE_BIN" --version)"
  mkdir -p "$APP/Contents/Resources/node/bin"
  cp "$NODE_BIN" "$APP/Contents/Resources/node/bin/node"
fi

echo "→ Drawing the icon"
ICONSET="$ROOT/build/swift/AppIcon.iconset"
rm -rf "$ICONSET"
swift scripts/make-icon.swift "$ICONSET" >/dev/null
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Liner Code</string>
  <key>CFBundleDisplayName</key><string>Liner Code</string>
  <key>CFBundleIdentifier</key><string>app.liner.code</string>
  <key>CFBundleExecutable</key><string>LinerCode</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.developer-tools</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSSupportsAutomaticGraphicsSwitching</key><true/>
  <key>NSHumanReadableCopyright</key><string>Liner Code. Your models, your code.</string>
  <key>NSAppTransportSecurity</key>
  <dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict>
</plist>
PLIST

echo "→ Signing (ad hoc)"
codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || echo "  (signing skipped)"

echo "✓ $APP"
if [[ " $* " == *" --open "* ]]; then open "$APP"; fi
