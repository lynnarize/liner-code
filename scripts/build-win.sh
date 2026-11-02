#!/usr/bin/env bash
# Builds Liner Code for Windows, from this Mac: the same pages, shell, engine source and its one
# dependency as the Mac app, wrapped in Electron's Windows build as "Liner Code.exe" in a folder,
# then zipped with its SHA-256 beside it. It isn't signed, so SmartScreen asks the first time.
#   npm run win                 build/release/Liner-Code-<version>-win-x64.zip and .sha256
#   npm run win -- arm64        …for Windows on Arm
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
ARCH="${1:-x64}"
case "$ARCH" in x64|arm64) ;; *) echo "Unknown architecture: $ARCH (x64 or arm64)" >&2; exit 2 ;; esac
STAGE="$ROOT/build/stage-win"
VERSION="$(node -p "require('./package.json').version")"
REPO="$(bash scripts/release-repo.sh)"
OUT="$ROOT/build/release"
ZIP="$OUT/Liner-Code-$VERSION-win-$ARCH.zip"

echo "→ Building the app's pages"
npm run build -w ui >/dev/null

echo "→ Building the shell"
node desktop/build.ts

echo "→ Putting what goes inside together"
rm -rf "$STAGE"
mkdir -p "$STAGE/desktop/dist" "$STAGE/engine" "$STAGE/contracts" "$STAGE/node_modules/@anthropic-ai"
# The Mac addon (mac.node) stays out: it's AppKit.
cp desktop/dist/main.cjs desktop/dist/preload.cjs "$STAGE/desktop/dist/"
cp -R ui/dist "$STAGE/ui"
cp -R engine/src engine/package.json "$STAGE/engine/"
cp -R contracts/src contracts/package.json "$STAGE/contracts/"
# As on the Mac, the engine drives the claude you installed, so the SDK's own binary stays out.
cp -R node_modules/@anthropic-ai/claude-agent-sdk "$STAGE/node_modules/@anthropic-ai/"
cat > "$STAGE/package.json" <<JSON
{ "name": "liner-code", "productName": "Liner Code", "version": "$VERSION", "type": "module", "main": "desktop/dist/main.cjs", "liner": { "releases": "$REPO" } }
JSON

echo "→ Drawing the icon"
ICONSET="$ROOT/build/AppIcon.iconset"
rm -rf "$ICONSET"
swift scripts/make-icon.swift "$ICONSET" >/dev/null
node scripts/make-ico.ts "$ICONSET" "$ROOT/build/AppIcon.ico"

echo "→ Gathering the licences"
RES="$ROOT/build/licences-win"
rm -rf "$RES" && mkdir -p "$RES"
cp LICENSE THIRD_PARTY_NOTICES.md "$RES/"

echo "→ Wrapping it in Electron $(node -p "require('electron/package.json').version") for Windows ($ARCH)"
PACKED="$(LINER_TARGET="win32-$ARCH" node desktop/package.ts "$STAGE" "$ROOT/build/AppIcon.ico" "$ROOT/build/electron-win" "$RES"/*)"
APP="$ROOT/build/Liner Code-win-$ARCH"
rm -rf "$APP"
mv "$PACKED" "$APP"
rm -rf "$ROOT/build/electron-win" "$STAGE" "$RES"
[[ -f "$APP/Liner Code.exe" ]] || { echo "No Liner Code.exe in $APP." >&2; exit 1; }

echo "→ Zipping it"
mkdir -p "$OUT"
rm -f "$ZIP" "$ZIP.sha256"
# The folder inside is "Liner Code", so it unzips as one.
TMP="$ROOT/build/zip-win" && rm -rf "$TMP" && mkdir -p "$TMP" && mv "$APP" "$TMP/Liner Code"
( cd "$TMP" && zip -qr -X "$ZIP" "Liner Code" )
mv "$TMP/Liner Code" "$APP" && rm -rf "$TMP"
( cd "$OUT" && shasum -a 256 "$(basename "$ZIP")" > "$(basename "$ZIP").sha256" )

echo "✓ $ZIP ($(du -h "$ZIP" | cut -f1))"
echo "  $(cut -d' ' -f1 "$ZIP.sha256")"
