# Beat prompts

Paste one prompt per beat. Run the agent from `agent/` with `ONTO_REGISTRY` pointing at staging (`http://127.0.0.1:3299`) for rehearsals and the live demo.

1. **Discover.** "Prepare Maplewood's October 2026 indirect-tax position. Start by finding the terms you need for tax obligations, place of supply, filing deadlines and jurisdictions, and tell me which packages they come from."
2. **Install and type.** "Show me which package versions you're pinned to. Then validate `october-2026.jsonl` as taxable supplies and `rates.jsonl` as tax rates. Report how many rows are valid and show each rejected row with its reason."
3. **Compute and explain.** "Now produce the October position by jurisdiction. Every line needs its tax obligation, the provision it arises from, who it's owed to, and the filing deadline."
4. **The law changes** (after the beat-4 minor of `@tax/core` is published to staging; it must be in the agent's pinned major, see `agent/pins.json`. Being rebased from 1.1.0 onto 3.0.0 as 3.1.0, D7). "A rate changed in `@tax/core`. What changed, and does anything we rely on break?"
5. **The model changes.** (This beat runs in CI. Show the PR.)
6. **Nobody broke** (after `@tax/indirect` 2.0.0 is published to staging). "`@tax/indirect` has a new major. Are we affected today? What would we need to change to move to 2.0.0?" Then: "Re-run October's filing check."
