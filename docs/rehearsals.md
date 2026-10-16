# Rehearsal log

| Date | What | Result | Notes |
| --- | --- | --- | --- |
| 2026-10-16 | Beats 4–6 on staging, 2 runs with a reset between (`scripts/beats.sh`) | ✔ ✔ | Identical verdicts. Agent pinned `^1` stays on `@tax/indirect@1.0.0` and picks up `@tax/core@1.1.1` |
| 2026-10-16 | CI beat 4 (#20) and beat 5 (#21), 10 attempts each | ✔ 10/10 green, ✔ 10/10 red | Every red run failed at the Gate step |
| 2026-10-16 | Agent beats 1–3, headless (`agent/run.sh -p`), run 1 | ✘ setup | User MCP servers leaked in; seed reads denied |
| 2026-10-16 | Agent beats 1–3, run 2 | ✘ setup | Agent read the answer key (`docs/expected-…`) and project memory. Reads now limited to `seed/`, auto-memory off, seed README moved to `docs/` |
| 2026-10-16 | Agent beats 1–3, run 3 (clean: only onto tools, reads only `seed/`) | ◐ | 0 Bash/web/RDF calls; 198/2 and 6/1 rejections correct; 14 obligations and 7 returns validated through tools. 5 of 7 lines match `expected-october-2026.md` exactly. QST and WA are off by cents (it rounded the total, not each invoice; rule added to `agent/CLAUDE.md`). Citations show provision IDs, not text: registry gap #23 |
