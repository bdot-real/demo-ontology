#!/usr/bin/env node
// Primary-source check of the real tax rates (#14, decision D4). Run it the week of the demo.
//
//   node scripts/verify-rates.mjs            # exit 1 on any mismatch or unreachable source
//
// Three checks:
//   1. Every TaxRate in every production version of @tax/core matches the verified value, effective date
//      and provision citation below.
//   2. seed/rates.jsonl (the ERP table) agrees with the @tax/core version the agent pins.
//   3. Each official page is fetched live and still states the rate (and the date, where the page gives one).
//      The match is on the wording around the rate, not a bare "5%".
//
// Known errata (KNOWN) are reported with ⚠ and don't fail the run, so a new discrepancy still shows red.
// Evidence and verification dates are in docs/rate-verification.md.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROD = (process.env.ONTO_PROD ?? "https://onto.melx.buzz").replace(/\/$/, "");
const ACTS = "https://onto.melx.buzz/ns/legal/acts#";
// canada.ca drops curl's TLS handshake and Revenu Québec returns 403 to short user agents.
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";

const CRA_HISTORY =
  "https://www.canada.ca/en/revenue-agency/programs/about-canada-revenue-agency-cra/income-statistics-gst-hst-statistics/gst-hst-statistics/gst-hst-statistics-tables-2017-2021-calendar-years.html";

// What the official sources say. `pages` are fetched live; each `match` must be found in the page text.
const VERIFIED = {
  "rate-GST-CA": {
    rate: "0.05", effectiveFrom: "2008-01-01", citation: "ETA s.165(1)",
    pages: [
      { url: "https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/charge-collect-which-rate/calculator.html", match: /Quebec 5% 9\.975%/ },
      { url: CRA_HISTORY, match: /Beginning January 1, 2008, and ending June 30, 2010 .*GST rates \(1\) 7% 7% 6% 5%/ },
    ],
  },
  "rate-HST-ON": {
    rate: "0.13", effectiveFrom: "2010-07-01", citation: "ETA s.165(2)",
    pages: [
      { url: "https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/charge-collect-which-rate/calculator.html", match: /Ontario 13%/ },
      { url: CRA_HISTORY, match: /Beginning July 1, 2010, and ending March 31, 2013 .*Ontario n\/a n\/a n\/a n\/a 13%/ },
    ],
  },
  "rate-QST-QC": {
    rate: "0.09975", effectiveFrom: "2013-01-01", citation: "Act respecting the Québec sales tax s.16",
    pages: [
      { url: "https://www.revenuquebec.ca/en/businesses/consumption-taxes/gsthst-and-qst/collecting-gst-and-qst/calculating-the-taxes/", match: /use the 9\.975% rate/ },
      { url: "https://www.revenuquebec.ca/en/businesses/consumption-taxes/gsthst-and-qst/basic-rules-for-applying-the-gsthst-and-qst/tables-of-gst-and-qst-rates/", match: /January 1, 2013 – present 9\.975%/ },
    ],
  },
  "rate-PST-BC": {
    rate: "0.07", effectiveFrom: "2013-04-01", citation: "PSTA s.105(1)",
    pages: [
      { url: "https://www2.gov.bc.ca/gov/content/taxes/tim/pst/parts/pt-4", match: /Subsection 105\(1\) provides that .{0,200}tax at the rate of 7% of the purchase price of the Part 4 software/ },
      { url: "https://www2.gov.bc.ca/gov/content/taxes/tim/pst", match: /On April 1, 2013, British Columbia re-implemented the provincial sales tax/ },
    ],
  },
  "rate-ST-NY": {
    rate: "0.04", effectiveFrom: "2005-06-01", citation: "NY Tax Law §1105",
    pages: [
      { url: "https://www.tax.ny.gov/pubs_and_bulls/tg_bulletins/st/sales_tax_rates_additional_sales_taxes_and_fees.htm", match: /state rate \(currently 4%\)/ },
      // N-05-8 is a PDF; its text isn't extractable without a PDF library, so it is checked by hand (docs/rate-verification.md).
    ],
  },
  "rate-ST-WA": {
    rate: "0.065", effectiveFrom: "1983-03-01", citation: "RCW 82.08.020",
    pages: [
      { url: "https://dor.wa.gov/taxes-rates/retail-sales-tax", match: /The state tax rate is 6\.5%/ },
      // DOR Chart 4 (PDF, 1983 column): "State rate increased from 5.4% to 6.5% in 36 counties, effective 3/1/83". Checked by hand.
    ],
  },
};

// Reported, not failed. Remove an entry once the fix is published.
const KNOWN = {
  "rate-ST-WA effectiveFrom": "DOR Chart 4: 6.5% effective 1983-03-01 (border counties 1985-01-01), not 1983-07-01. Reported to the ontology agent (#14).",
  "rate-PST-BC citation": "Cites the whole Act; 7% on software is PSTA s.105(1). Reported to the ontology agent (#14).",
  "rate-HST-ON@1.0.0 citation": "Fixed to ETA s.165(2) in @tax/core 2.0.0 (#23); 1.x keeps s.165(1).",
};

let failures = 0;
let known = 0;
const report = (ok, key, msg) => {
  if (ok) return console.log(`  ✔ ${msg}`);
  if (KNOWN[key]) {
    known++;
    return console.log(`  ⚠ ${msg}\n      known: ${KNOWN[key]}`);
  }
  failures++;
  console.log(`  ✘ ${msg}`);
};

// Each site blocks a different client: canada.ca stalls curl, and Revenu Québec returns 403 to Node's
// fetch and to curl unless the headers are exactly User-Agent (via -A), Accept: text/html, Accept-Language.
// So fetch first, then fall back to curl.
async function get(url, as = "text") {
  const accept = as === "json" ? "application/json" : "text/html";
  const r = await fetch(url, { headers: { "user-agent": UA, accept, "accept-language": "en-CA,en" }, signal: AbortSignal.timeout(45000) }).catch((e) => ({ ok: false, status: e.message }));
  if (r.ok) return r[as]();
  try {
    const body = execFileSync("curl", ["-sfL", "--http1.1", "--max-time", "45", "-A", UA, "-H", `Accept: ${accept}`, "-H", "Accept-Language: en-CA,en", url], { encoding: "utf8", maxBuffer: 1 << 26 });
    return as === "json" ? JSON.parse(body) : body;
  } catch {
    throw new Error(`fetch ${r.status}, curl failed: ${url}`);
  }
}

/** TaxRate individuals from a Turtle file: `:rate-X a :TaxRate ; ... .` blocks. */
function ratesFromTurtle(ttl) {
  const out = {};
  for (const m of ttl.matchAll(/^:(rate-[\w-]+) a :TaxRate ;([\s\S]*?) \.\s*$/gm)) {
    const body = m[2];
    const lit = (p) => new RegExp(`:${p} "([^"]+)"`).exec(body)?.[1];
    const ref = (p) => new RegExp(`:${p} (?:<([^>]+)>|:(\\S+))`).exec(body)?.slice(1).find(Boolean);
    out[m[1]] = {
      rate: lit("rate"), effectiveFrom: lit("effectiveFrom"), imposedBy: ref("imposedBy"),
      taxType: ref("taxType"), jurisdiction: ref("jurisdiction"), hypothetical: /hypothetical/i.test(body),
    };
  }
  return out;
}

const citations = new Map();
async function citation(iri) {
  if (!citations.has(iri)) {
    const r = await fetch(`${PROD}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "describe_term", arguments: { iri, package: "@legal/acts" } } }),
    });
    const text = await r.text();
    const body = text.startsWith("{") ? JSON.parse(text) : JSON.parse(/^data: (.*)$/m.exec(text)[1]);
    const term = JSON.parse(body.result.content[0].text)[0];
    citations.set(iri, term?.assertions?.find((a) => a.label === "citation")?.value ?? null);
  }
  return citations.get(iri);
}

// --- 1. Every production version of @tax/core ---------------------------------------------------------
const pkg = await get(`${PROD}/api/packages/@tax/core`, "json");
const versions = Object.keys(pkg.versions).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
const byVersion = {};
for (const v of versions) {
  console.log(`\n@tax/core ${v} (production)`);
  byVersion[v] = ratesFromTurtle(await get(`${PROD}/api/packages/@tax/core/${v}/files/ontology/core.ttl`));
  for (const [id, r] of Object.entries(byVersion[v])) {
    if (r.hypothetical) {
      report(false, "", `${id} is marked hypothetical but is on production (D3: scripted versions are staging-only)`);
      continue;
    }
    const exp = VERIFIED[id];
    if (!exp) {
      report(false, "", `${id}: no verified evidence on file; add it to VERIFIED`);
      continue;
    }
    report(r.rate === exp.rate, `${id} rate`, `${id} rate ${r.rate}${r.rate === exp.rate ? "" : ` (verified ${exp.rate})`}`);
    report(r.effectiveFrom === exp.effectiveFrom, `${id} effectiveFrom`, `${id} effectiveFrom ${r.effectiveFrom}${r.effectiveFrom === exp.effectiveFrom ? "" : ` (verified ${exp.effectiveFrom})`}`);
    const cite = await citation(r.imposedBy);
    const key = v.startsWith("1.") && id === "rate-HST-ON" ? `${id}@1.0.0 citation` : `${id} citation`;
    report(cite === exp.citation, key, `${id} imposedBy ${r.imposedBy.replace(ACTS, "")} → "${cite}"${cite === exp.citation ? "" : ` (should be "${exp.citation}")`}`);
  }
  for (const id of Object.keys(VERIFIED)) if (!byVersion[v][id]) report(false, "", `${id} missing from @tax/core ${v}`);
}

// --- 2. seed/rates.jsonl against the pinned version ----------------------------------------------------
const range = JSON.parse(fs.readFileSync(path.join(root, "agent/pins.json"), "utf8"))["@tax/core"];
const major = range.replace(/^[\^~=]/, "").split(".")[0];
const pinned = versions.filter((v) => v.split(".")[0] === major && !v.includes("-")).at(-1);
console.log(`\nseed/rates.jsonl against @tax/core ${pinned} (agent pin ${range})`);
const seed = fs.readFileSync(path.join(root, "seed/rates.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const onto = byVersion[pinned];
for (const row of seed) {
  const id = row["@id"].split("/").pop();
  if (!row.effectiveFrom) {
    console.log(`  · ${id} has no effectiveFrom (planted bad row, docs/seed-data.md)`);
    continue;
  }
  const o = Object.values(onto).find((r) => r.jurisdiction === row.jurisdiction && row.taxType.endsWith(`#${r.taxType}`));
  if (!o) {
    report(false, "", `${id}: no matching TaxRate in @tax/core ${pinned}`);
    continue;
  }
  const diffs = [];
  if (Number(row.rate) !== Number(o.rate)) diffs.push(`rate ${row.rate} vs ${o.rate}`);
  if (row.effectiveFrom !== o.effectiveFrom) diffs.push(`effectiveFrom ${row.effectiveFrom} vs ${o.effectiveFrom}`);
  if (row.imposedBy !== o.imposedBy) diffs.push(`imposedBy ${row.imposedBy.replace(ACTS, "")} vs ${o.imposedBy.replace(ACTS, "")}`);
  report(!diffs.length, "", `${id} ${diffs.length ? diffs.join("; ") : `agrees (${row.rate}, from ${row.effectiveFrom})`}`);
}

// --- 3. Live official pages ----------------------------------------------------------------------------
console.log("\nofficial sources (live)");
const pages = new Map();
for (const [id, exp] of Object.entries(VERIFIED)) {
  for (const { url, match } of exp.pages) {
    try {
      if (!pages.has(url)) {
        const html = await get(url);
        pages.set(url, html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/\s+/g, " "));
      }
      const m = match.exec(pages.get(url));
      report(!!m, "", `${id} ${new URL(url).host}: ${m ? `"${m[0].slice(0, 90)}${m[0].length > 90 ? "…" : ""}"` : `no match for ${match}`}`);
    } catch (e) {
      report(false, "", `${id} ${url}: ${e.message}`);
    }
  }
}

console.log(`\n${failures ? `✘ ${failures} failure(s)` : "✔ all checks pass"}${known ? `, ${known} known erratum/errata` : ""} — ${new Date().toISOString().slice(0, 10)}`);
process.exit(failures ? 1 : 0);
