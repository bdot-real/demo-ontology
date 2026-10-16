#!/usr/bin/env bash
# Build the staging registry at the exact commit production runs, so staging verdicts match CI.
# A clean clone in .staging/registry is used; the ontology agent's working tree is only read from.
#
#   scripts/stage-setup.sh [commit]     # default: the commit production serves (deploy/deploy.sh)
set -euo pipefail
COMMIT=${1:-d181153}
SRC=${ONTO_SRC:-$(cd "$(dirname "$0")/../../ontology" && pwd)}
DEST="$(cd "$(dirname "$0")/.." && pwd)/.staging/registry"
[ -d "$DEST/.git" ] || git clone -q --no-checkout "$SRC" "$DEST"
git -C "$DEST" fetch -q origin 2>/dev/null || git -C "$DEST" fetch -q "$SRC"
git -C "$DEST" checkout -q --detach "$COMMIT"
cd "$DEST/web"
npm ci --no-audit --no-fund --silent
npm run build:native        # production runs the native Rust core (web/Dockerfile)
npm run build
echo "staging registry built at $(git -C "$DEST" rev-parse --short HEAD)"
