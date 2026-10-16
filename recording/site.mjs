#!/usr/bin/env node
// A quick tour of onto.melx.buzz for the intro of the cut (#17): one continuous take in a logged-out
// Chrome (public pages only, nothing is changed on the site). Headless video has no pointer, so a drawn
// cursor shows where each click lands. Marks (seconds into the take) go to site.json for the captions.
//
//   node recording/site.mjs [take]        # → .recording/raw/<take>/site.webm + site.json

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const take = process.argv[2] ?? "take5";
const OUT = path.join(root, ".recording/raw", take);
fs.mkdirSync(OUT, { recursive: true });
const require = createRequire(path.join(process.env.PLAYWRIGHT_FROM ?? "/Volumes/T7/Projects/player-pathways", "package.json"));
const { chromium } = require("playwright");
const SITE = "https://onto.melx.buzz";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CURSOR = `
  addEventListener("DOMContentLoaded", () => {
    const c = document.createElement("div");
    c.id = "__cursor";
    c.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M3 2l7.5 19 2.6-7.7L21 10.6z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, { position: "fixed", left: (window.__cx ?? 700) + "px", top: (window.__cy ?? 400) + "px", zIndex: 2147483647, pointerEvents: "none", transform: "translate(-3px,-2px)" });
    document.documentElement.appendChild(c);
    addEventListener("mousemove", (e) => { c.style.left = e.clientX + "px"; c.style.top = e.clientY + "px"; }, true);
    addEventListener("mousedown", (e) => {
      const r = document.createElement("div");
      Object.assign(r.style, { position: "fixed", left: e.clientX - 18 + "px", top: e.clientY - 18 + "px", width: "36px", height: "36px", borderRadius: "50%", background: "rgba(108,92,231,.35)", zIndex: 2147483646, pointerEvents: "none", transition: "transform .45s, opacity .45s" });
      document.documentElement.appendChild(r);
      requestAnimationFrame(() => { r.style.transform = "scale(1.8)"; r.style.opacity = "0"; });
      setTimeout(() => r.remove(), 600);
    }, true);
  });`;

const browser = await chromium.launch({ channel: "chrome", headless: true });
const dir = path.join(OUT, "site.video");
// Same framing as the other browser shots: 1477 px wide (130% after upscaling), recorded 940 tall and
// cropped to 831 by render.mjs because headless video leaves the bottom unpainted.
const ctx = await browser.newContext({ viewport: { width: 1477, height: 940 }, recordVideo: { dir, size: { width: 1477, height: 940 } }, colorScheme: "light", locale: "en-CA" });
await ctx.addInitScript(CURSOR);
const page = await ctx.newPage();
const t0 = Date.now();
const marks = {};
const mark = (k) => (marks[k] = (Date.now() - t0) / 1000);
let pos = { x: 700, y: 420 };
async function moveTo(x, y, steps = 28) {
  await page.mouse.move(x, y, { steps });
  pos = { x, y };
  await page.evaluate(([a, b]) => { window.__cx = a; window.__cy = b; }, [x, y]);
}
async function moveToEl(locator, dx = 0.5, dy = 0.5) {
  const b = await locator.boundingBox();
  if (!b) throw new Error(`not visible: ${locator}`);
  await moveTo(b.x + b.width * dx, b.y + b.height * dy);
  return b;
}
async function glideTo(locator, top = 110, ms = 1600) {
  const y = await locator.evaluate((el, t) => window.scrollY + el.getBoundingClientRect().top - t, top);
  await page.evaluate(([to, d]) => new Promise((res) => {
    const y0 = window.scrollY; const s = performance.now();
    const step = (t) => { const k = Math.min(1, (t - s) / d); const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2; window.scrollTo(0, y0 + (to - y0) * e); k < 1 ? requestAnimationFrame(step) : res(); };
    requestAnimationFrame(step);
  }), [y, ms]);
}
const settle = async () => { await page.waitForLoadState("load"); await sleep(700); await page.mouse.move(pos.x, pos.y); };

// 1. Home: what onto is, then the MCP endpoint.
await page.goto(SITE, { waitUntil: "load" });
await settle();
mark("home");
await sleep(2600);
await moveToEl(page.getByRole("heading", { level: 1 }), 0.3, 0.6);
await sleep(600);
mark("mcp");
await glideTo(page.getByRole("heading", { name: /Plug your agent/ }), 90);
await moveToEl(page.getByText("https://onto.melx.buzz/mcp").first(), 0.5, 0.5);
await sleep(3000);

// 2. Search reaches into data values: "s.165" finds the HST provision by its citation.
await glideTo(page.locator("body"), 0, 900);
const box = page.getByPlaceholder(/Search ontologies, terms and values/);
await moveToEl(box, 0.25, 0.5);
mark("search");
await box.click();
await box.pressSequentially("s.165", { delay: 140 });
await sleep(300);
await box.press("Enter");
await settle();
await moveToEl(page.getByText("Excise Tax Act s.165(2)").first(), 0.5, 0.5);
await sleep(3200);

// 3. A package: versions, checks, coverage and its connections.
const pkg = page.getByRole("link", { name: "@tax/core" }).first();
await moveToEl(pkg);
await sleep(300);
await pkg.click();
await settle();
mark("package");
await sleep(1800);
await moveToEl(page.getByRole("heading", { name: "Connections" }).first(), 0.5, 3.2);
await sleep(2400);

// 4. A term: content-hashed, with its history across versions.
await page.goto(`${SITE}/package/@tax/core/term?iri=${encodeURIComponent("https://onto.melx.buzz/ns/tax/core#rate-HST-ON")}`, { waitUntil: "load" });
await settle();
mark("term");
await sleep(1200);
await moveToEl(page.getByRole("heading", { name: "History" }), 0.5, 2.4);
await sleep(2800);

// 5. A diff between versions, classified change by change.
await page.goto(`${SITE}/package/@tax/core/diff?from=2.0.0&to=3.0.0`, { waitUntil: "load" });
await settle();
mark("diff");
await sleep(1200);
await moveToEl(page.getByText(/breaking changes/).first(), 0.2, 0.5);
await sleep(3200);
mark("end");

await ctx.close();
await browser.close();
const [webm] = fs.readdirSync(dir).filter((f) => f.endsWith(".webm"));
fs.renameSync(path.join(dir, webm), path.join(OUT, "site.webm"));
fs.rmSync(dir, { recursive: true });
fs.writeFileSync(path.join(OUT, "site.json"), JSON.stringify(marks, null, 2));
console.log(`✔ site.webm`, marks);
