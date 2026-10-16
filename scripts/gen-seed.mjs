#!/usr/bin/env node
// Generates the Maplewood seed data deterministically (fixed PRNG seed), so every rehearsal sees the
// same 200 invoice lines and the same answer. Rerun after changing anything here, and commit the output.
//
//   node scripts/gen-seed.mjs
//
// Shapes follow the published JSON Schemas: TaxableSupply (@tax/indirect 1.0.0) and TaxRate
// (@tax/core 1.0.0). Conventions that the ontology leaves open, such as currency, are in docs/seed-data.md.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SEED = path.join(path.dirname(fileURLToPath(import.meta.url)), "../seed");
const J = "https://onto.melx.buzz/ns/legal/jurisdictions#";
const TAX = "https://onto.melx.buzz/ns/tax/core#";
const ACTS = "https://onto.melx.buzz/ns/legal/acts#";
const MW = "https://maplewood.example/";

// mulberry32: small, deterministic PRNG.
let s = 20261031;
const rand = () => {
  s |= 0;
  s = (s + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (a) => a[Math.floor(rand() * a.length)];

// Monthly subscription prices, in the place of supply's currency.
const PLANS = { CAD: [49, 99, 249, 499, 1200], USD: [39, 79, 199, 399, 990] };

// Line counts by place of supply. Quebec splits consumers (who pay QST under the specified system)
// from QST-registered businesses (who don't).
const MIX = [
  { code: "CA-ON", n: 80, cur: "CAD", taxes: () => ["HST"], registrant: () => rand() < 0.7 },
  { code: "CA-QC", n: 25, cur: "CAD", taxes: () => ["GST", "QST"], registrant: () => false },
  { code: "CA-QC", n: 20, cur: "CAD", taxes: () => ["GST"], registrant: () => true },
  { code: "CA-BC", n: 30, cur: "CAD", taxes: () => ["GST", "PST"], registrant: () => rand() < 0.6 },
  { code: "US-NY", n: 25, cur: "USD", taxes: () => ["US_SalesTax"], registrant: () => true },
  { code: "US-WA", n: 20, cur: "USD", taxes: () => ["US_SalesTax"], registrant: () => true },
];

const lines = [];
let inv = 0;
for (const m of MIX) {
  for (let i = 0; i < m.n; i++) {
    inv++;
    const day = 1 + Math.floor(rand() * 31);
    const cust = `${m.code}-${String(1 + Math.floor(rand() * 40)).padStart(3, "0")}`;
    lines.push({
      "@id": `${MW}invoices/2026-10/INV-${String(inv).padStart(5, "0")}`,
      amount: pick(PLANS[m.cur]),
      placeOfSupply: J + m.code,
      recipient: `${MW}customers/${cust}`,
      recipientIsRegistrant: m.registrant(),
      supplyDate: `2026-10-${String(day).padStart(2, "0")}`,
      taxType: m.taxes().map((t) => TAX + t),
    });
  }
}

// Two deliberate bad invoice rows (beat 2). The third bad row is in rates.jsonl.
const qc = lines.find((l) => l.placeOfSupply === J + "CA-QC" && !l.recipientIsRegistrant);
delete qc.placeOfSupply; // 1. a Quebec sale with no place of supply
const bc = lines.find((l) => l.placeOfSupply === J + "CA-BC");
bc.amount = "1,200.00"; // 2. an amount exported as a formatted string

lines.sort((a, b) => (a.supplyDate + a["@id"]).localeCompare(b.supplyDate + b["@id"]));
fs.mkdirSync(SEED, { recursive: true });
fs.writeFileSync(path.join(SEED, "october-2026.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");

// The ERP's rate table, which must agree with @tax/core. The last row is the third deliberate bad
// row: a rate with no effective date.
const rate = (id, j, t, r, from, provision) => ({
  "@id": `${MW}erp/rates/${id}`,
  rate: r,
  effectiveFrom: from,
  taxType: TAX + t,
  jurisdiction: J + j,
  imposedBy: ACTS + provision,
});
const rates = [
  rate("GST-CA", "CA", "GST", 0.05, "2008-01-01", "excise_tax_act_s165"),
  rate("HST-ON", "CA-ON", "HST", 0.13, "2010-07-01", "excise_tax_act_s165"),
  rate("QST-QC", "CA-QC", "QST", 0.09975, "2013-01-01", "quebec_sales_tax_s16"),
  rate("PST-BC", "CA-BC", "PST", 0.07, "2013-04-01", "bc_provincial_sales_tax"),
  rate("ST-NY", "US-NY", "US_SalesTax", 0.04, "2005-06-01", "ny_tax_law_section1105"),
  rate("ST-WA", "US-WA", "US_SalesTax", 0.065, "1983-07-01", "wa_rcw_82_08_020"),
];
const bad = rate("PST-BC-promo", "CA-BC", "PST", 0.05, null, "bc_provincial_sales_tax");
delete bad.effectiveFrom; // 3. a rate with no effective date
rates.push(bad);
fs.writeFileSync(path.join(SEED, "rates.jsonl"), rates.map((r) => JSON.stringify(r)).join("\n") + "\n");

// Maplewood's company profile: registrations, filing periods and deadlines (FilingPeriod is from
// @tax/filing, FilingDeadline from @legal/processes) and trailing sales for the threshold question.
// Registration numbers are fictional. Due-date rules were verified on official pages on 2026-10-16
// (see docs/seed-data.md). Weekend roll-forwards are applied where the authority states the rule.
const FILING = "https://onto.melx.buzz/ns/tax/filing#";
// Deadlines are pure FilingDeadline instances (closed-world); the rule and source for each go in
// deadlineSources, keyed by @id, so the instances validate as they are.
const deadlineSources = {};
const deadline = (id, j, due, rule, url) => {
  deadlineSources[`${MW}deadlines/${id}`] = { rule, sourceUrl: url, verifiedOn: "2026-10-16" };
  return { "@id": `${MW}deadlines/${id}`, dueDate: due, hasJurisdiction: [J + j] };
};
const period = (id, start, end, freq) => ({ "@id": `${MW}periods/${id}`, startDate: start, endDate: end, frequency: [FILING + freq] });
const profile = {
  "@id": `${MW}`,
  name: "Maplewood Software Inc. (fictional)",
  homeJurisdiction: J + "CA-ON",
  registrations: [
    { jurisdiction: J + "CA", taxTypes: [TAX + "GST", TAX + "HST"], authority: TAX + "CRA", number: "999999999RT0001", frequency: "monthly", since: "2019-03-01" },
    { jurisdiction: J + "CA-QC", taxTypes: [TAX + "QST"], authority: TAX + "RevenuQuebec", number: "NR00009999", system: "specified", frequency: "quarterly", since: "2021-07-01" },
    { jurisdiction: J + "CA-BC", taxTypes: [TAX + "PST"], authority: TAX + "BCMinistryOfFinance", number: "PST-9999-9999", frequency: "monthly", since: "2021-04-01" },
    { jurisdiction: J + "US-NY", taxTypes: [TAX + "US_SalesTax"], authority: TAX + "NYDTF", number: "99-9999999", frequency: "quarterly", since: "2022-12-01" },
    { jurisdiction: J + "US-WA", taxTypes: [TAX + "US_SalesTax"], authority: TAX + "WADOR", number: "999-999-999", frequency: "monthly", since: "2026-10-01" },
  ],
  periods: [
    period("CA-2026-10", "2026-10-01", "2026-10-31", "monthly"),
    period("QC-2026-Q4", "2026-10-01", "2026-12-31", "quarterly"),
    period("BC-2026-10", "2026-10-01", "2026-10-31", "monthly"),
    period("NY-2026-SEP-NOV", "2026-09-01", "2026-11-30", "quarterly"),
    period("WA-2026-10", "2026-10-01", "2026-10-31", "monthly"),
  ],
  deadlines: [
    deadline("GST-HST-2026-10", "CA", "2026-11-30", "Monthly filer: one month after the end of the reporting period",
      "https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/file-gst-hst-return/reporting-requirements-deadlines.html"),
    deadline("QST-2026-Q4", "CA-QC", "2027-01-31", "Specified system: last day of the month following the calendar quarter (2027-01-31 is a Sunday; confirm roll-forward, #14)",
      "https://www.revenuquebec.ca/en/businesses/consumption-taxes/gsthst-and-qst/special-cases-gsthst-and-qst/suppliers-outside-quebec/reporting-the-qst/"),
    deadline("PST-2026-10", "CA-BC", "2026-11-30", "Last day of the month after the end of the reporting period",
      "https://www2.gov.bc.ca/gov/content/taxes/sales-taxes/pst/report-pay/pst-return-guide"),
    deadline("ST-NY-2026-SEP-NOV", "US-NY", "2026-12-21", "Quarterly: 20 days after the quarter (2026-12-20 is a Sunday, next business day)",
      "https://www.tax.ny.gov/pubs_and_bulls/tg_bulletins/st/filing_requirements_for_sales_and_use_tax_returns.htm"),
    deadline("ST-WA-2026-10", "US-WA", "2026-11-25", "Monthly: the 25th of the following month",
      "https://dor.wa.gov/file-pay-taxes/filing-frequencies-due-dates/2026-excise-tax-return-due-dates"),
  ],
  deadlineSources,
  // Trailing 12 months to 2026-09-30, by place of supply: amount, number of sales, and the amount to
  // non-registrant consumers (the Quebec specified-system test counts only these).
  trailing12m: {
    "CA-ON": { currency: "CAD", amount: 1840000, sales: 1012 },
    "CA-QC": { currency: "CAD", amount: 512000, sales: 560, toConsumers: 61800 },
    "CA-BC": { currency: "CAD", amount: 318000, sales: 371 },
    "US-NY": { currency: "USD", amount: 604000, sales: 298 },
    "US-WA": { currency: "USD", amount: 108400, sales: 233 },
  },
};
fs.writeFileSync(path.join(SEED, "maplewood.json"), JSON.stringify(profile, null, 2) + "\n");

const by = {};
for (const l of lines) {
  const k = l.placeOfSupply ?? "(missing)";
  by[k] = (by[k] ?? 0) + 1;
}
console.log(`october-2026.jsonl: ${lines.length} lines`, by);
console.log(`rates.jsonl: ${rates.length} rows`);
