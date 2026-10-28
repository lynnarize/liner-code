#!/usr/bin/env bash
# Copies the Liner UI library into this app again, after it changes in ../Liner UI.
# Liner Code doesn't edit ui/src/liner; app styles live in ui/src/app/app.css.
set -euo pipefail
cd "$(dirname "$0")/.."
SRC="${LINER_UI:-../Liner UI}/src/liner"
[ -d "$SRC" ] || { echo "No Liner UI library at $SRC (set LINER_UI to its folder)"; exit 1; }
rsync -a --delete "$SRC/" ui/src/liner/
echo "✓ ui/src/liner now matches $SRC"
