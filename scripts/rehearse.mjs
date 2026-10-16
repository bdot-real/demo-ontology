#!/usr/bin/env node
// One full end-to-end rehearsal (#17): fresh staging, every beat through the real agent, automatic checks.
//
//   node scripts/rehearse.mjs [--out DIR]     # exit 1 if any check fails
//
// Beats 1-3: one agent session, checked line by line against docs/expected-october-2026.md.
// Beat 4: publish @tax/core 3.1.0 to staging, then ask the agent what changed.
// Beat 5: runs in CI (PR #21); here only the staging gate's rejection is checked (scripts/beats.sh 3).
// Beat 6: publish 3.1.1 and @tax/indirect 2.0.0, ask whether we're affected, then re-run the position.
// Every run is audited: only onto tools plus Read/Glob/Grep under seed/ or agent/.

import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const oi = process.argv.indexOf("--out");
const OUT = path.resolve(oi > 0 ? process.argv[oi + 1] : path.join(root, ".staging/rehearsal", new Date().toISOString().replace(/[:.]/g, "-")));
fs.mkdirSync(OUT, { recursive: true });

const prompts = Object.fromEntries(
  [...fs.readFileSync(path.join(root, "agent/prompts/beats.md"), "utf8").matchAll(/^(\d)\. \*\*[^*]+\*\*[^"\n]*"([^"]+)"/gm)].map((m) => [m[1], m[2]]),
);
const BEAT6_RERUN = "Re-run October's filing check.";

// Expected position: [jurisdiction, tax type, tax amount, citation] from the reference answer.
const expected = fs
  .readFileSync(path.join(root, "docs/expected-october-2026.md"), "utf8")
  .split("\n")
  .filter((l) => /^\| (CA|US)-/.test(l))
  .map((l) => l.split("|").map((c) => c.trim()))
  .map((c) => ({ j: c[1], type: c[2], tax: c[6].replace(/^(CAD|USD) /, ""), cite: c[7].replace(/ \([^)]*\)$/, "") }));

const results = [];
const check = (beat, ok, what) => {
  results.push({ beat, ok, what });
  console.log(`  ${ok ? "✔" : "✘"} ${what}`);
};

// --- staging ---------------------------------------------------------------------------------------
console.log(`rehearsal → ${OUT}\nstarting fresh staging…`);
spawnSync("pkill", ["-INT", "-f", "scripts/stage.mjs"]);
await new Promise((r) => setTimeout(r, 2000));
const stageLog = fs.openSync(path.join(OUT, "stage.log"), "w");
const stage = spawn(process.execPath, [path.join(root, "scripts/stage.mjs")], { stdio: ["ignore", stageLog, stageLog] });
for (let i = 0; ; i++) {
  if (fs.readFileSync(path.join(OUT, "stage.log"), "utf8").includes("ready.")) break;
  if (i > 300 || stage.exitCode !== null) throw new Error("staging did not start; see stage.log");
  await new Promise((r) => setTimeout(r, 1000));
}
const refused = fs.readFileSync(path.join(OUT, "stage.log"), "utf8").split("\n").filter((l) => /^\s+! /.test(l));
check("staging", refused.length === 0, `staging mirrors every production version${refused.length ? `; refused: ${refused.map((l) => l.trim().split(/\s+/)[1]).join(", ")}` : ""}`);
const beatsStep = (n) => spawnSync(path.join(root, "scripts/beats.sh"), [String(n)], { encoding: "utf8" });

// --- agent -------------------------------------------------------------------------------------------
const ALLOWED_READ = [path.join(root, "seed"), path.join(root, "agent")];
function agent(name, prompt, cont = false) {
  const file = path.join(OUT, `${name}.jsonl`);
  const args = [...(cont ? ["--continue"] : []), "-p", prompt, "--output-format", "stream-json", "--verbose"];
  const t0 = Date.now();
  const r = spawnSync(path.join(root, "agent/run.sh"), args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 28, timeout: 15 * 60_000 });
  fs.writeFileSync(file, r.stdout + r.stderr);
  const events = r.stdout.split("\n").filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
  const uses = events.filter((e) => e.type === "assistant").flatMap((e) => e.message.content.filter((c) => c.type === "tool_use"));
  const result = events.find((e) => e.type === "result");
  const text = result?.result ?? "";
  fs.writeFileSync(path.join(OUT, `${name}.md`), text);
  const stray = uses.filter((u) => {
    if (u.name.startsWith("mcp__onto__") || u.name.startsWith("mcp__onto-tools__")) return false;
    if (!["Read", "Glob", "Grep"].includes(u.name)) return true;
    const p = path.resolve(path.join(root, "agent"), u.input.file_path ?? u.input.path ?? ".");
    return !ALLOWED_READ.some((a) => p === a || p.startsWith(a + path.sep));
  });
  console.log(`\n${name}: ${result?.subtype ?? "no result"}, ${uses.length} tool calls, ${Math.round((Date.now() - t0) / 1000)} s`);
  check(name, result?.subtype === "success", "agent run completed");
  check(name, stray.length === 0, `only onto tools and seed/agent reads${stray.length ? `: ${stray.map((u) => `${u.name} ${JSON.stringify(u.input).slice(0, 80)}`).join("; ")}` : ""}`);
  return { text, uses };
}

/** The table row for a jurisdiction and tax type, so amounts can't be matched in the wrong line. */
const row = (text, j, type) =>
  text.split("\n").find((l) => l.startsWith("|") && l.includes(j) && l.toLowerCase().includes(type.toLowerCase().replace(/ \(.*\)$/, "")) && /\d/.test(l)) ?? "";

function checkPosition(beat, text) {
  for (const e of expected) {
    const line = row(text, e.j, e.type === "Sales tax (state portion only)" ? "Sales tax" : e.type);
    check(beat, line.includes(e.tax), `${e.j} ${e.type}: ${e.tax}${line.includes(e.tax) ? "" : ` (row: ${line.slice(0, 140) || "missing"})`}`);
    check(beat, line.includes(e.cite), `${e.j} ${e.type} cites ${e.cite}`);
    if (e.j.startsWith("US")) check(beat, /state portion only/i.test(line), `${e.j} labelled state portion only`);
  }
  for (const id of ["INV-00126", "INV-00081", "PST-BC-promo"]) check(beat, text.includes(id), `excluded ${id} reported`);
  check(beat, /not tax advice/i.test(text), `"not tax advice" disclaimer`);
}

// Beats 1-3
const b13 = agent("beats-1-3", [prompts[1], prompts[2], prompts[3]].join(" "));
check("beats-1-3", /198/.test(b13.text) && /6 of 7|6\/7|6 valid/.test(b13.text), "validation counts 198/200 and 6/7");
checkPosition("beats-1-3", b13.text);
check("beats-1-3", b13.uses.some((u) => /validate_tax_obligation$/.test(u.name)) && b13.uses.some((u) => /validate_return$/.test(u.name)), "obligations and returns validated through tools");

// Beat 4
let s = beatsStep(1);
check("beat-4", s.status === 0, "staging accepted @tax/core 3.1.0 as minor");
const b4 = agent("beat-4", prompts[4]);
check("beat-4", b4.uses.some((u) => u.name.endsWith("diff_versions")), "used diff_versions");
check("beat-4", /3\.1\.0/.test(b4.text) && /2027/.test(b4.text) && /10\s?%|0\.10/.test(b4.text), "names 3.1.0 and the 10% QST rate from 2027");
check("beat-4", /(nothing|no)[^.]{0,40}(breaks|break|breaking)/i.test(b4.text), "says nothing breaks");

// Beat 5 (CI) and the rest of the scripted versions
s = beatsStep(2);
check("beat-5", s.status === 0, "staging accepted @tax/core 3.1.1 as patch");
s = beatsStep(3);
check("beat-5", s.status === 0 && /require a major bump/.test(s.stdout), "staging rejected @tax/indirect 1.1.0 (needs a major)");
s = beatsStep(4);
check("beat-6", s.status === 0, "staging accepted @tax/indirect 2.0.0 as major");

// Beat 6
const b6 = agent("beat-6", prompts[6]);
check("beat-6", /not affected|aren't affected|are not affected|\bno\b[,.]? we|today:?\W{0,4}no\b/i.test(b6.text) && /1\.0\.\d/.test(b6.text), "not affected today; stays on @tax/indirect 1.0.x");
check("beat-6", /creditedSupply/.test(b6.text) && /placeOfSupply/.test(b6.text), "explains the migration (placeOfSupply, creditedSupply)");
const b6b = agent("beat-6-rerun", BEAT6_RERUN, true);
checkPosition("beat-6-rerun", b6b.text);

stage.kill("SIGINT");
const failed = results.filter((r) => !r.ok);
fs.writeFileSync(path.join(OUT, "checks.json"), JSON.stringify(results, null, 2));
console.log(`\n${failed.length ? `✘ ${failed.length} of ${results.length} checks failed` : `✔ all ${results.length} checks passed`} (${OUT})`);
process.exit(failed.length ? 1 : 0);
