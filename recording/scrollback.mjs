#!/usr/bin/env node
// "Scroll back" shot for a terminal clip (#17). The agent's final answer is longer than the 34-row terminal,
// so by the time it settles, the position table has scrolled off screen. This replays the redacted cast
// in a headless terminal, takes the agent's last answer verbatim (colours included) from the scrollback,
// and films a slow scroll through it, styled like the recorded terminal.
//
//   node recording/scrollback.mjs <take> <clip> <from-text> <to-text>
//   e.g. node recording/scrollback.mjs take4 b6-agent "Re-run October's filing check." "For demonstration, not tax advice."

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import xterm from "@xterm/headless";
import serialize from "@xterm/addon-serialize";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const [take, clip, fromText, toText] = process.argv.slice(2);
const DIR = path.join(root, ".recording/clips", take);
const require = createRequire(path.join(process.env.PLAYWRIGHT_FROM ?? "/Volumes/T7/Projects/player-pathways", "package.json"));
const { chromium } = require("playwright");

const [head, ...evs] = fs.readFileSync(path.join(DIR, `${clip}.cast`), "utf8").trim().split("\n");
const { cols, rows } = JSON.parse(head).term;
const term = new xterm.Terminal({ cols, rows, scrollback: 10000, allowProposedApi: true });
const ser = new serialize.SerializeAddon();
term.loadAddon(ser);
for (const l of evs) {
  const [, kind, data] = JSON.parse(l);
  if (kind === "o") await new Promise((r) => term.write(data, r));
}

// The last occurrence of the prompt line, through the end marker after it.
const b = term.buffer.active;
const lines = Array.from({ length: b.length }, (_, y) => b.getLine(y)?.translateToString(true) ?? "");
// The prompt as submitted: the input line starts with ❯.
const start = lines.findLastIndex((t) => /^\s*❯/.test(t) && t.includes(fromText));
const end = lines.findIndex((t, y) => y > start && t.includes(toText));
if (start < 0 || end < 0) throw new Error(`markers not found (start ${start}, end ${end})`);
// serializeAsHTML ignores its range option (5.5 / 0.13), so take the whole buffer, one <div> per row, and slice.
const html = ser.serializeAsHTML({ includeGlobalBackground: false });
const rowsHtml = html.match(/<div><span[\s\S]*?<\/div>/g);
if (rowsHtml.length !== lines.length) throw new Error(`serialized ${rowsHtml.length} rows, buffer has ${lines.length}`);
const body = `<pre>${rowsHtml.slice(start, end + 1).join("")}</pre>`;
const page = `<!doctype html><meta charset="utf-8"><style>
  html,body{margin:0;background:#272822;color:#f8f8f2}
  body{padding:28px 34px 400px;font:22px/1.38 "DejaVu Sans Mono","Menlo",monospace}
  body div, body pre{font-family:inherit!important;font-size:inherit!important;background-color:transparent!important;color:#f8f8f2}
  body span{font-family:inherit!important;font-size:inherit!important}
  pre{margin:0;white-space:pre}
</style><body>${body}</body>`;
const htmlPath = path.join(DIR, `${clip}-scroll.html`);
fs.writeFileSync(htmlPath, page);

// Film it: hold on the top, scroll at reading speed, hold on the bottom.
const browser = await chromium.launch({ channel: "chrome", headless: true });
const dir = path.join(DIR, `${clip}-scroll.video`);
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1220 }, recordVideo: { dir, size: { width: 1920, height: 1220 } } });
const p = await ctx.newPage();
await p.goto(`file://${htmlPath}`);
await p.waitForTimeout(2500);
const total = await p.evaluate(() => document.body.scrollHeight - 1080);
const secs = Number(process.env.SCROLL_SECONDS ?? Math.max(6, total / 160)); // ~160 px (5 lines) a second
await p.evaluate(([y, d]) => new Promise((res) => {
  const t0 = performance.now();
  const step = (t) => { const k = Math.min(1, (t - t0) / d); window.scrollTo(0, y * (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2)); k < 1 ? requestAnimationFrame(step) : res(); };
  requestAnimationFrame(step);
}), [Math.max(0, total), secs * 1000]);
await p.waitForTimeout(3000);
await ctx.close();
await browser.close();
const [webm] = fs.readdirSync(dir).filter((f) => f.endsWith(".webm"));
execFileSync("ffmpeg", ["-v", "error", "-y", "-i", path.join(dir, webm), "-vf", "crop=1920:1080:0:0,format=yuv420p", "-r", "30", "-c:v", "libx264", "-crf", "16", "-movflags", "+faststart", path.join(DIR, `${clip}-scroll.mp4`)]);
fs.rmSync(dir, { recursive: true });
console.log(`✔ ${clip}-scroll.mp4 (${end - start + 1} lines, ${secs.toFixed(1)} s scroll)`);
