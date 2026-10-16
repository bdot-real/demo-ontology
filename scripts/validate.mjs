#!/usr/bin/env node
// Validate the seed data against the published JSON Schemas, through the same MCP bridge the agent
// uses (agent/onto-tools.mjs), so this checks exactly what beat 2 shows.
//
//   node scripts/validate.mjs            # exit 1 unless the result matches EXPECTED
//
// ONTO_REGISTRY selects the registry (default production; staging for rehearsals).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "agent/package.json"));
const { Client } = await import(require.resolve("@modelcontextprotocol/sdk/client/index.js"));
const { StdioClientTransport } = await import(require.resolve("@modelcontextprotocol/sdk/client/stdio.js"));

// Three deliberate bad rows across the two files (see seed/README.md).
const EXPECTED = {
  "october-2026.jsonl": { tool: "tax_indirect__validate_taxable_supply", valid: 198, invalid: 2 },
  "rates.jsonl": { tool: "tax_core__validate_tax_rate", valid: 6, invalid: 1 },
};

const client = new Client({ name: "seed-validate", version: "1.0.0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(root, "agent/onto-tools.mjs")], env: process.env, stderr: "ignore" }));
const call = async (name, args) => {
  const r = await client.callTool({ name, arguments: args });
  if (r.isError) throw new Error(`${name}: ${r.content[0].text}`);
  return JSON.parse(r.content[0].text);
};

let ok = true;
for (const [file, exp] of Object.entries(EXPECTED)) {
  const r = await call("onto_validate_batch", { tool: exp.tool, file });
  const pass = r.valid === exp.valid && r.invalid === exp.invalid;
  ok &&= pass;
  console.log(`${pass ? "✔" : "✘"} ${file} as ${r.class} (${r.package}): ${r.valid} valid, ${r.invalid} rejected (expected ${exp.valid}/${exp.invalid})`);
  for (const bad of r.rejected) console.log(`    line ${bad.line} ${bad["@id"].split("/").pop()}: ${bad.errors.join("; ")}`);
}

// The profile's deadlines and periods must also be valid instances of their classes.
const profile = JSON.parse(fs.readFileSync(path.join(root, "seed/maplewood.json"), "utf8"));
for (const [list, tool] of [[profile.deadlines, "legal_processes__validate_filing_deadline"], [profile.periods, "tax_filing__validate_filing_period"]]) {
  for (const inst of list) {
    const r = await call(tool, { instance: inst });
    ok &&= r.valid;
    if (!r.valid) console.log(`✘ ${inst["@id"]}: ${r.errors.join("; ")}`);
  }
  console.log(`✔ ${list.length} ${tool.split("__validate_")[1]} instances checked`);
}

await client.close();
process.exit(ok ? 0 : 1);
