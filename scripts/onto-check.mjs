#!/usr/bin/env node
// Dry-run a package against the onto registry's version gate and print the semantic diff as Markdown.
// Nothing is stored: POST /api/packages/@scope/name/check is the registry-side `onto check`.
//
//   node scripts/onto-check.mjs packages/tax-indirect [more dirs…]  > comment.md
//
// Exit code 1 when any package fails the gate (version too small, IRI policy, failing competency
// questions), 2 when the registry can't be reached. ONTO_REGISTRY defaults to production; the
// check is read-only, so that is safe.

import fs from "node:fs";
import path from "node:path";

const REGISTRY = (process.env.ONTO_REGISTRY ?? "https://onto.melx.buzz").replace(/\/$/, "");
// Same file selection as the onto CLI, so the registry sees exactly what `onto publish` would send.
const TEXT_FILES = /\.(ttl|nt|trig|rdf|rdfs|owl|md|ya?ml|json|rq|sparql|txt)$/i;
const SKIP_DIRS = new Set(["node_modules", ".git", "ontologies", ".next"]);
const ICON = { breaking: "🔴", deprecating: "🟡", additive: "🟢", patch: "🔵", cosmetic: "⚪" };

function walk(dir, root = dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith(".") || SKIP_DIRS.has(ent.name) || ent.name === "onto-lock.json") continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, root, out);
    else if (TEXT_FILES.test(ent.name)) out.push(path.relative(root, p).split(path.sep).join("/"));
  }
  return out.sort();
}

function field(yaml, key) {
  const m = new RegExp(`^${key}:\\s*["']?([^"'\\n#]+?)["']?\\s*(#.*)?$`, "m").exec(yaml);
  return m?.[1];
}

const short = (iri) => /[#/]([^#/]+)$/.exec(iri)?.[1] ?? iri;

async function check(dir) {
  const manifest = fs.readFileSync(path.join(dir, "onto.yaml"), "utf8");
  const name = field(manifest, "name");
  const version = field(manifest, "version");
  const files = walk(dir).map((p) => ({ path: p, content: fs.readFileSync(path.join(dir, p), "utf8") }));
  const res = await fetch(`${REGISTRY}/api/packages/${name}/check`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ manifest, files }),
  });
  const json = await res.json().catch(() => ({}));
  const result = json.details?.check ? json.details : json;
  return { dir, name, version, status: res.status, result };
}

function render({ name, version, status, result }) {
  const out = [];
  const { check, diff, tests } = result;
  if (!check) {
    out.push(`### ❌ \`${name}@${version}\``, "", "```", result.error ?? `HTTP ${status}`, "```");
    return out.join("\n");
  }
  out.push(`### ${check.ok ? "✅" : "❌"} \`${name}@${version}\`${check.base ? ` vs \`${check.base}\`` : ""}`, "");
  out.push(`> ${check.message}`, "");
  if (!diff) out.push("_Initial version: nothing to compare against._");
  else if (!diff.changes.length) out.push("_No semantic changes._");
  else {
    const n = diff.counts;
    out.push(`**${n.breaking} breaking · ${n.deprecating} deprecating · ${n.additive} additive · ${n.patch} patch** → requires **${diff.required}**`, "");
    out.push("| | Class | Term | Change |", "| --- | --- | --- | --- |");
    for (const ch of diff.changes.slice(0, 50)) {
      out.push(`| ${ICON[ch.class] ?? ""} | ${ch.class} | \`${ch.label ?? short(ch.iri)}\` | ${ch.message.replace(/\|/g, "\\|")}${ch.violation ? " **(IRI policy)**" : ""} |`);
    }
    if (diff.changes.length > 50) out.push(``, `_…and ${diff.changes.length - 50} more._`);
  }
  if (tests?.summary) {
    const s = tests.summary;
    const cov = tests.coverage?.total ? ` · term coverage ${Math.round((tests.coverage.covered.length / tests.coverage.total) * 100)}%` : "";
    out.push("", `Competency questions: ${s.pass} passed, ${s.fail} failed, ${s.error} errored, ${s.skipped} skipped${cov}`);
  }
  return out.join("\n");
}

const dirs = process.argv.slice(2);
if (!dirs.length) {
  console.error("usage: onto-check.mjs <package-dir>…");
  process.exit(2);
}
let failed = false;
const sections = [];
for (const dir of dirs) {
  let r;
  try {
    r = await check(dir);
  } catch (e) {
    console.error(`registry unreachable at ${REGISTRY}: ${e.message}`);
    process.exit(2);
  }
  failed ||= !(r.result.check?.ok && r.result.ok !== false);
  sections.push(render(r));
}
console.log(["<!-- onto-check -->", "## onto semantic diff", "", ...sections, "", `<sub>Checked against ${REGISTRY} (dry run, nothing stored).</sub>`].join("\n"));
process.exit(failed ? 1 : 0);
