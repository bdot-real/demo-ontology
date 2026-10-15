# Decisions

Decisions that bind every package and script in this demo. Published IRIs and versions are permanent, so these don't change without a new entry here.

| # | Date | Decision | Why |
| --- | --- | --- | --- |
| D1 | 2026-10-15 | Every new package uses the namespace `https://onto.melx.buzz/ns/<scope>/<pkg>#`, for example `https://onto.melx.buzz/ns/tax/core#TaxRate`. | The existing `@legal` terms already use it, so nothing has to be re-homed. Published IRIs can only be deprecated. |
| D2 | 2026-10-15 | Package names never repeat the scope: `@legal/acts`, not `@legal/legal-acts`. The old `@legal/legal-*` packages are deprecated with pointers to their successors. | Removes the naming stutter and makes a registry story of its own. |
| D3 | 2026-10-15 | Base packages are published to production (onto.melx.buzz). The scripted demo versions (`@tax/core` 1.1.0 and 1.1.1, `@tax/indirect` 1.1.0-bad and 2.0.0) are published **only** to a staging registry that resets before each run. | Versions are immutable, and beats 4 to 6 must run 10/10 and twice in a row. |
| D4 | 2026-10-15 | Seed data uses real Canadian and US rates, verified at build time. Each rate carries its source URL and verification date and is labelled "for demonstration, not tax advice". | More credible to a tax audience. |
| D5 | 2026-10-15 | The CI gate vendors the onto GitHub Action (`.github/actions/onto-diff`) because the `ontology` repo is private. | A public repo can't `uses:` an action from a private repo. |
