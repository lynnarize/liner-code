#!/usr/bin/env bash
# Builds "Liner Code.app" on Electron: the web app, the shell (desktop/), the engine's source and
# its one dependency, an icon, and an ad-hoc signature. The engine runs on Electron's own Node, so
# the app needs no Node installed. Output: build/Liner Code.app
#   npm run mac            a release build
#   npm run mac -- --open  …and open it
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
APP="$ROOT/build/Liner Code.app"
STAGE="$ROOT/build/stage"
VERSION="$(node -p "require('./package.json').version")"
# Where the app looks for its updates: package.json's "repository", or this checkout's GitHub origin.
REPO="$(bash scripts/release-repo.sh)"

echo "→ Building the app's pages"
npm run build -w ui >/dev/null

echo "→ Building the shell"
node desktop/build.ts

echo "→ Putting what goes inside together"
rm -rf "$STAGE"
mkdir -p "$STAGE/desktop" "$STAGE/engine" "$STAGE/contracts" "$STAGE/node_modules/@anthropic-ai"
cp -R desktop/dist "$STAGE/desktop/"
cp -R ui/dist "$STAGE/ui"
cp -R engine/src engine/package.json "$STAGE/engine/"
cp -R contracts/src contracts/package.json "$STAGE/contracts/"
# The engine's only dependency. Its own Claude Code binary (about 260 MB) stays out: the engine
# drives the claude you installed and signed in to, so your plan and settings come along.
cp -R node_modules/@anthropic-ai/claude-agent-sdk "$STAGE/node_modules/@anthropic-ai/"
cat > "$STAGE/package.json" <<JSON
{ "name": "liner-code", "productName": "Liner Code", "version": "$VERSION", "type": "module", "main": "desktop/dist/main.cjs", "liner": { "releases": "$REPO" } }
JSON
if [[ -z "$REPO" ]]; then echo "  (no GitHub repository yet: this build won't look for updates)"; fi

echo "→ Drawing the icon"
ICONSET="$ROOT/build/AppIcon.iconset"
rm -rf "$ICONSET"
swift scripts/make-icon.swift "$ICONSET" >/dev/null
iconutil -c icns "$ICONSET" -o "$ROOT/build/AppIcon.icns"

echo "→ Wrapping it in Electron $(node -p "require('electron/package.json').version")"
OUT="$(node desktop/package.ts "$STAGE" "$ROOT/build/AppIcon.icns" "$ROOT/build/electron")"
rm -rf "$APP"
mv "$OUT/Liner Code.app" "$APP"
rm -rf "$ROOT/build/electron" "$STAGE"

echo "→ Signing (ad hoc)"
codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || echo "  (signing skipped)"

echo "✓ $APP ($(du -sh "$APP" | cut -f1))"
if [[ " $* " == *" --open "* ]]; then open "$APP"; fi
