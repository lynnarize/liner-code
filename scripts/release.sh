#!/usr/bin/env bash
# Builds a Liner Code release for GitHub: the app zipped the way its updater wants it, the zip's
# SHA-256 beside it (the updater won't put in a download it can't check), and a disk image for a
# first install.
#   npm run release                      build/release/Liner-Code-<version>-mac-<arch>.zip, .sha256 and .dmg
#   npm run release -- 0.2.0             sets package.json's version first
#   npm run release -- 0.2.0 --publish   …then publishes them with gh as the release v0.2.0
#   LINER_RELEASE_TITLE, LINER_RELEASE_NOTES (a file) name the release and say what's in it
# Every copy of the app looks at the repository's latest release (not drafts or pre-releases)
# every six hours, downloads it, and puts it in when you restart or quit.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"

PUBLISH=0
NEXT=""
for a in "$@"; do
  case "$a" in
    --publish) PUBLISH=1 ;;
    [0-9]*.[0-9]*.[0-9]*) NEXT="$a" ;;
    *) echo "Unknown option: $a" >&2; exit 2 ;;
  esac
done

REPO="$(bash scripts/release-repo.sh)"
if [[ -z "$REPO" ]]; then
  echo "No GitHub repository: set \"repository\" in package.json or add a GitHub origin first," >&2
  echo "so the app knows where to look for its updates." >&2
  exit 1
fi

if [[ -n "$NEXT" ]]; then
  node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync("package.json","utf8"));p.version=process.argv[1];fs.writeFileSync("package.json",JSON.stringify(p,null,2)+"\n")' "$NEXT"
fi
VERSION="$(node -p "require('./package.json').version")"
ARCH="$([[ "$(uname -m)" == "arm64" ]] && echo arm64 || echo x64)"
OUT="$ROOT/build/release"
ZIP="$OUT/Liner-Code-$VERSION-mac-$ARCH.zip"
DMG="$OUT/Liner-Code-$VERSION-mac-$ARCH.dmg"

# The same Developer ID the build signs with signs the disk image (none: both ad hoc).
if [[ -z "${LINER_SIGN_IDENTITY:-}" ]]; then
  LINER_SIGN_IDENTITY="$(security find-identity -v -p codesigning 2>/dev/null | sed -n 's/.*"\(Developer ID Application: [^"]*\)".*/\1/p' | head -1)"
fi
export LINER_SIGN_IDENTITY

echo "→ Liner Code $VERSION for $REPO"
bash scripts/build-mac.sh

echo "→ Zipping it"
mkdir -p "$OUT"
rm -f "$ZIP" "$ZIP.sha256"
ditto -c -k --sequesterRsrc --keepParent "$ROOT/build/Liner Code.app" "$ZIP"
( cd "$OUT" && shasum -a 256 "$(basename "$ZIP")" > "$(basename "$ZIP").sha256" )

echo "→ Making the disk image"
# A writable image first, so Finder can lay out its window before it's compressed: the app on the
# left, Applications on the right, and a picture with the arrow and what to do the first time
# macOS won't open it (make-dmg-background.swift, dmg-layout.applescript). The volume is mounted
# under its own name, or the picture's link in the layout would point at another.
IMG="$ROOT/build/dmg"
RW="$ROOT/build/dmg-rw.dmg"
VOL="Liner Code $VERSION"
rm -rf "$IMG" "$RW" "$DMG" "$ROOT/build/dmg-bg" && mkdir -p "$IMG/.background"
ditto "$ROOT/build/Liner Code.app" "$IMG/Liner Code.app"
ln -s /Applications "$IMG/Applications"
swift scripts/make-dmg-background.swift "$ROOT/build/dmg-bg" >/dev/null
tiffutil -cathidpicheck "$ROOT/build/dmg-bg/background.png" "$ROOT/build/dmg-bg/background@2x.png" -out "$IMG/.background/background.tiff" >/dev/null
if [[ -d "/Volumes/$VOL" ]]; then hdiutil detach -quiet "/Volumes/$VOL"; fi
hdiutil create -quiet -volname "$VOL" -srcfolder "$IMG" -size "$(($(du -sm "$IMG" | cut -f1) + 20))m" -fs HFS+ -format UDRW -ov "$RW"
MNT="$(hdiutil attach -readwrite -noverify -noautoopen "$RW" | awk -F'\t' '/Apple_HFS/ {print $NF}')"
if ! osascript scripts/dmg-layout.applescript "$(basename "$MNT")" >/dev/null; then
  echo "  (Finder couldn't lay out the window, so it opens as a plain folder)"
fi
rm -rf "$MNT/.fseventsd"
sync
hdiutil detach -quiet "$MNT"
hdiutil convert -quiet "$RW" -format UDZO -imagekey zlib-level=9 -o "$DMG"
rm -rf "$IMG" "$RW" "$ROOT/build/dmg-bg"
if [[ -n "${LINER_SIGN_IDENTITY:-}" ]]; then codesign --sign "$LINER_SIGN_IDENTITY" "$DMG"; fi
( cd "$OUT" && shasum -a 256 "$(basename "$DMG")" > "$(basename "$DMG").sha256" )

echo "✓ $ZIP ($(du -h "$ZIP" | cut -f1))"
echo "  $(cut -d' ' -f1 "$ZIP.sha256")"
echo "✓ $DMG ($(du -h "$DMG" | cut -f1))"

if [[ "$PUBLISH" == 1 ]]; then
  echo "→ Publishing v$VERSION"
  TITLE="${LINER_RELEASE_TITLE:-Liner Code $VERSION}"
  if [[ -n "${LINER_RELEASE_NOTES:-}" ]]; then NOTES=(--notes-file "$LINER_RELEASE_NOTES"); else NOTES=(--generate-notes); fi
  gh release create "v$VERSION" "$DMG" "$DMG.sha256" "$ZIP" "$ZIP.sha256" --repo "$REPO" --title "$TITLE" "${NOTES[@]}"
else
  echo
  echo "To publish it:"
  echo "  gh release create v$VERSION \"$DMG\" \"$DMG.sha256\" \"$ZIP\" \"$ZIP.sha256\" --repo $REPO --title \"Liner Code $VERSION\" --generate-notes"
fi
