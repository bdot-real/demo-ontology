# Scripted demo versions (staging only, decision D3)

Copied unchanged from the ontology repo's `drafts/demo/` at 00c3e20. **Never publish these to production.** `scripts/beats.sh` publishes them to the staging registry in this order:

| Step | Draft | Expected | Beat |
| --- | --- | --- | --- |
| 1 | `tax-core-1.1.0` | accepted: additive, minor | 4 |
| 2 | `tax-core-1.1.1` | accepted: no semantic change, patch (needs 1.1.0 published first) | 4 |
| 3 | `tax-indirect-1.1.0-bad` | **rejected**: 2 breaking, needs a major | 5 |
| 4 | `tax-indirect-2.0.0` | accepted: major, `claimedOn` deprecated in favour of `creditedSupply` | 6 |
