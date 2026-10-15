# onto demo: Compliance Agent

A 10-minute demo of [onto](https://onto.melx.buzz), which treats ontologies like code: versioned, diffed, tested, and consumed by agents as typed tools.

**Maplewood Software Inc.** is a fictional Ontario SaaS company that sells to customers in Ontario, Quebec, British Columbia, New York and Washington. A Claude agent connected to onto over MCP answers three questions every month: what do we owe, to whom, and by when. Every answer traces back to the legal provision that created the obligation.

> Maplewood is fictional. Rates are real at the verification date recorded beside each one, but this repository is a demonstration, not tax advice.

Status and task tracking: see the [issues](../../issues), starting with the tracking issue labelled `epic`.

| Path | Contents |
| --- | --- |
| `docs/decisions.md` | Binding decisions: namespace, naming, staging versus production |
| `agent/` | Compliance Agent config (onto MCP server, system prompt) |
| `seed/` | Maplewood seed data: jurisdictions, rates, 200 October invoice lines |
| `scripts/` | Validation against published JSON Schemas, staging reset |
| `.github/workflows/` | Semantic-diff CI gate (beat 5) |
