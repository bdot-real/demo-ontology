#!/usr/bin/env bash
# Beats 4-6 against the running staging registry (start it with `node scripts/stage.mjs`).
# Each step prints the registry's verdict and fails if the verdict isn't the expected one.
#   scripts/beats.sh            all steps
#   scripts/beats.sh 3          one step
set -uo pipefail
cd "$(dirname "$0")/.."
steps=(
  "tax-core-1.1.0:ok"
  "tax-core-1.1.1:ok"
  "tax-indirect-1.1.0-bad:reject"
  "tax-indirect-2.0.0:ok"
)
fail=0
for i in "${!steps[@]}"; do
  n=$((i + 1)); [ $# -gt 0 ] && [ "$1" != "$n" ] && continue
  IFS=: read draft want <<<"${steps[$i]}"
  echo "── step $n: $draft (expect $want)"
  node scripts/stage.mjs --publish "scripted/$draft"; code=$?
  got=$([ $code -eq 0 ] && echo ok || echo reject)
  [ "$got" = "$want" ] && echo "   ✔ as expected" || { echo "   ✘ expected $want, got $got"; fail=1; }
done
exit $fail
