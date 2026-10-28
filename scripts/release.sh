#!/usr/bin/env bash
# Builds a Liner Code release for GitHub: the app zipped the way its updater wants it, and the
# zip's SHA-256 beside it (the updater won't put in a download it can't check).
#   npm run release                      build/release/Liner-Code-<version>-mac-<arch>.zip and .sha256
#   npm run release -- 0.2.0             sets package.json's version first
#   npm run release -- 0.2.0 --publish   …then publishes them with gh as the release v0.2.0
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

echo "→ Liner Code $VERSION for $REPO"
bash scripts/build-mac.sh

echo "→ Zipping it"
mkdir -p "$OUT"
rm -f "$ZIP" "$ZIP.sha256"
ditto -c -k --sequesterRsrc --keepParent "$ROOT/build/Liner Code.app" "$ZIP"
( cd "$OUT" && shasum -a 256 "$(basename "$ZIP")" > "$(basename "$ZIP").sha256" )

echo "✓ $ZIP ($(du -h "$ZIP" | cut -f1))"
echo "  $(cut -d' ' -f1 "$ZIP.sha256")"

if [[ "$PUBLISH" == 1 ]]; then
  echo "→ Publishing v$VERSION"
  gh release create "v$VERSION" "$ZIP" "$ZIP.sha256" --repo "$REPO" --title "Liner Code $VERSION" --generate-notes
else
  echo
  echo "To publish it:"
  echo "  gh release create v$VERSION \"$ZIP\" \"$ZIP.sha256\" --repo $REPO --title \"Liner Code $VERSION\" --generate-notes"
fi
