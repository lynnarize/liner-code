#!/usr/bin/env bash
# Copies the Liner UI library into this app again, after it changes in ../Liner UI.
# Liner Code isn't meant to edit ui/src/liner (app styles live in ui/src/app/app.css), but it has, more than once: so this
# first lists what the copy would lose or gain and stops. --yes does it.
#   npm run sync-liner            lists what would change, and changes nothing
#   npm run sync-liner -- --yes   copies, and records which Liner UI it took in ui/src/liner/UPSTREAM
set -euo pipefail
cd "$(dirname "$0")/.."
SRC="${LINER_UI:-../Liner UI}/src/liner"
[ -d "$SRC" ] || { echo "No Liner UI library at $SRC (set LINER_UI to its folder)"; exit 1; }

YES=0
for a in "$@"; do
  case "$a" in
    --yes) YES=1 ;;
    *) echo "Unknown option: $a" >&2; exit 2 ;;
  esac
done

# Edits here that were never committed would be gone for good.
if [[ -n "$(git status --porcelain -- ui/src/liner)" ]]; then
  echo "ui/src/liner has changes that aren't committed. Commit or drop them first." >&2
  exit 1
fi

CHANGES="$(rsync -a --delete --exclude UPSTREAM -n -i "$SRC/" ui/src/liner/)"
if [[ -z "$CHANGES" ]]; then
  echo "✓ ui/src/liner already matches $SRC"
  exit 0
fi
if [[ "$YES" != 1 ]]; then
  echo "$CHANGES"
  echo
  echo "These files in ui/src/liner would be replaced or deleted (a line starting with *deleting is removed)."
  echo "A change made only in this copy is lost unless Liner UI has it too. To go ahead: npm run sync-liner -- --yes"
  exit 1
fi

rsync -a --delete --exclude UPSTREAM "$SRC/" ui/src/liner/
# Which Liner UI this copy is, so the next person can tell.
{
  echo "Copied from Liner UI on $(date +%Y-%m-%d)."
  echo "Commit: $(git -C "$SRC" rev-parse HEAD 2>/dev/null || echo "unknown (the source isn't a git checkout)")"
} > ui/src/liner/UPSTREAM
echo "✓ ui/src/liner now matches $SRC"
