#!/usr/bin/env bash
# Builds "Liner Code.app" on Electron: the web app, the shell (desktop/), the engine's source and
# its one dependency, an icon, the licences, and a signature. The engine runs on Electron's own
# Node, so the app needs no Node installed. Output: build/Liner Code.app
# Signing: a "Developer ID Application" identity in your keychain (or LINER_SIGN_IDENTITY) signs it
# with the hardened runtime; LINER_NOTARY_PROFILE (from `xcrun notarytool store-credentials`) also
# notarizes and staples it. With neither, it's signed ad hoc, like the alphas.
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
# Before macOS 26 the Dock only knows the .icns, which is light, so the app sets these as the system's appearance changes.
swift scripts/make-icon.swift "$STAGE/icons/light.png" light 512 >/dev/null
swift scripts/make-icon.swift "$STAGE/icons/dark.png" dark 512 >/dev/null
# macOS 26 and later switch an app's icon with the appearance only when it comes from an Icon
# Composer icon compiled into Assets.car and named by CFBundleIconName. actool (Xcode 26 or later)
# takes desktop/AppIcon.icon as it is: icon.json with a light and a dark fill for the tile and each
# layer, and the two turns as filled outlines (it fills an SVG's stroked paths as shapes). It comes
# out as IconImageStack renditions for NSAppearanceNameAqua, NSAppearanceNameDarkAqua and
# ISAppearanceTintable (`xcrun assetutil --info Assets.car`). The .icns stays for older macOS.
CAR="$ROOT/build/icon-car"
ICON_CAR=""
rm -rf "$CAR" && mkdir -p "$CAR"
if xcrun actool desktop/AppIcon.icon --compile "$CAR" --platform macosx --minimum-deployment-target 13.0 --app-icon AppIcon --output-partial-info-plist "$CAR/partial.plist" >/dev/null 2>&1 && [[ -f "$CAR/Assets.car" ]]; then
  ICON_CAR="$CAR/Assets.car"
else
  echo "  (no actool from Xcode 26 or later here: on macOS 26 the icon won't turn dark with the system)"
fi

echo "→ Gathering the licences"
RES="$ROOT/build/licences"
rm -rf "$RES" && mkdir -p "$RES"
cp LICENSE THIRD_PARTY_NOTICES.md "$RES/"
cp node_modules/electron/dist/LICENSE "$RES/LICENSE.electron"
cp node_modules/electron/dist/LICENSES.chromium.html "$RES/"

if [[ -z "${LINER_SIGN_IDENTITY:-}" ]]; then
  LINER_SIGN_IDENTITY="$(security find-identity -v -p codesigning 2>/dev/null | sed -n 's/.*"\(Developer ID Application: [^"]*\)".*/\1/p' | head -1)"
fi
export LINER_SIGN_IDENTITY

echo "→ Wrapping it in Electron $(node -p "require('electron/package.json').version")"
if [[ -n "$LINER_SIGN_IDENTITY" ]]; then
  echo "  signing as $LINER_SIGN_IDENTITY${LINER_NOTARY_PROFILE:+, notarizing with $LINER_NOTARY_PROFILE}"
fi
OUT="$(node desktop/package.ts "$STAGE" "$ROOT/build/AppIcon.icns" "$ROOT/build/electron" "$RES"/* ${ICON_CAR:+"$ICON_CAR"})"
rm -rf "$APP"
mv "$OUT/Liner Code.app" "$APP"
rm -rf "$ROOT/build/electron" "$STAGE" "$RES" "$CAR"

if [[ -z "$LINER_SIGN_IDENTITY" ]]; then
  echo "→ Signing (ad hoc: no Developer ID on this Mac)"
  codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || echo "  (signing skipped)"
fi
codesign --verify --deep --strict "$APP" || { echo "The app's signature doesn't check out." >&2; exit 1; }

echo "✓ $APP ($(du -sh "$APP" | cut -f1))"
if [[ " $* " == *" --open "* ]]; then open "$APP"; fi
