#!/usr/bin/env bash
# Launch the Compliance Agent with nothing but onto tools.
#   agent/run.sh                 interactive (the live demo)
#   agent/run.sh -p "prompt"     headless (rehearsal checks), any extra claude flags pass through
#
# --strict-mcp-config: only the two onto servers in .mcp.json, never the presenter's own connectors.
# --tools: the only built-ins are Read/Glob/Grep, limited to ../seed by --add-dir. Bash, web and
# write tools don't exist in the session. Reads outside ../seed need approval (denied headless), and
# .claude/settings.json denies RDF/SPARQL files, docs/ (which holds the answer key) and memory.
set -euo pipefail
cd "$(dirname "$0")"
[ -d node_modules ] || npm install --silent
export CLAUDE_CODE_DISABLE_AUTO_MEMORY=1   # the agent must not see this repo's project memory
export ONTO_REGISTRY=${ONTO_REGISTRY:-http://127.0.0.1:3299}
exec claude --strict-mcp-config --mcp-config .mcp.json --setting-sources project \
  --tools Read,Glob,Grep --add-dir ../seed \
  --allowedTools "mcp__onto__*" "mcp__onto-tools__*" \
  "$@"
