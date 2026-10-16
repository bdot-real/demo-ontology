# Compliance Agent

Claude Code, configured as Maplewood's indirect-tax agent.

```sh
cd agent && npm install
./run.sh                                        # staging (default; start it with ../scripts/stage.mjs)
ONTO_REGISTRY=https://onto.melx.buzz ./run.sh   # production registry (read-only use)
```

- `.mcp.json` connects two servers: the registry's own MCP endpoint (`onto`, for discovery across every package) and `onto-tools.mjs`.
- `onto-tools.mjs` is a **generic** bridge (decision D6). It loads the MCP tool manifest and JSON Schema that the registry generates for each version pinned in `pins.json`, and serves them as live tools. It contains no domain code: the tools, their names and their shapes all come from the registry, and a new package version changes the tool set with no code change. `^1.0.0` resolves to the highest 1.x, so the agent keeps working after 2.0.0 ships (beat 6).
- `.claude/settings.json` enforces "no raw OWL or SPARQL" through permissions, not prompting. Bash, web access, writes, and reads of RDF or query files are denied. The agent can only call onto tools and read `../seed/`.
- `CLAUDE.md` is the system prompt. `prompts/beats.md` holds the prompt for each beat.

"Every write is a typed MCP tool call": the manifests contain validation tools, not write tools. Each line of the position is therefore built as an instance of its class and passed through that class's `validate_*` tool before it is reported. If real writes (to an ERP or a filing system) are wanted, the registry's MCP backend would have to generate them.
