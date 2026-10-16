#!/usr/bin/env node
// Capture one take of the 3-minute cut (beats 4, 5 and 6) for the FilmCraft edit (#17).
//
//   node recording/capture.mjs [take]        # raw footage → .recording/raw/<take>/
//
// No screen recording: the terminal is the real session, recorded by asciinema inside a detached tmux
// pane at a fixed size (agent/run.sh, interactive, exactly as on stage). The browser segments are
// recorded by Playwright with the installed Chrome and a clean profile (logged out, public pages only).
// Staging is fresh for every take, and the scripted versions go to staging only (D3).
//
// Needs: tmux, asciinema, Chrome, and Playwright from PLAYWRIGHT_FROM (any project that has it installed).

import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const take = process.argv[2] ?? "take1";
const OUT = path.join(root, ".recording/raw", take);
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const require = createRequire(path.join(process.env.PLAYWRIGHT_FROM ?? "/Volumes/T7/Projects/player-pathways", "package.json"));
const { chromium } = require("playwright");

// The camera's working copy: a worktree at a neutral path, so no local path of the presenter's is ever on
// screen (Claude Code prints its cwd and tool paths). Its .staging is a symlink to this repo's.
const DEMO = process.env.DEMO_ROOT ?? "/Users/Shared/maplewood-demo";
if (!fs.existsSync(path.join(DEMO, "agent/run.sh")) || !fs.existsSync(path.join(DEMO, ".staging/state.json")) && !fs.existsSync(path.join(DEMO, ".staging"))) {
  throw new Error(`no demo worktree at ${DEMO}: git worktree add --detach ${DEMO} HEAD && ln -s ${path.join(root, ".staging")} ${DEMO}/.staging`);
}
const COLS = 140;
const ROWS = 34;
const STAGE = "http://127.0.0.1:3299";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const timeline = []; // segment name → wall-clock start/end, for the edit notes
const prompts = Object.fromEntries(
  [...fs.readFileSync(path.join(root, "agent/prompts/beats.md"), "utf8").matchAll(/^(\d)\. \*\*[^*]+\*\*[^"\n]*"([^"]+)"/gm)].map((m) => [m[1], m[2]]),
);

// --- tmux + asciinema ----------------------------------------------------------------------------------
const tmux = (...a) => execFileSync("tmux", a, { encoding: "utf8" });
const pane = () => tmux("capture-pane", "-p", "-t", "rec");

async function record(name, command, cwd, body) {
  const cast = path.join(OUT, `${name}.cast`);
  spawnSync("tmux", ["kill-session", "-t", "rec"]);
  tmux("new-session", "-d", "-s", "rec", "-x", String(COLS), "-y", String(ROWS), "-c", cwd,
    `asciinema rec --overwrite -q --window-size ${COLS}x${ROWS} -c ${JSON.stringify(command)} ${JSON.stringify(cast)}`);
  const t0 = Date.now();
  log(`● ${name}`);
  await body();
  for (let i = 0; i < 40 && spawnSync("tmux", ["has-session", "-t", "rec"]).status === 0; i++) await sleep(250);
  spawnSync("tmux", ["kill-session", "-t", "rec"]);
  timeline.push({ name, kind: "terminal", seconds: Math.round((Date.now() - t0) / 1000) });
}

/** Type like a person: a few characters at a time. */
async function type(text, cps = 45) {
  for (const ch of text) {
    tmux("send-keys", "-t", "rec", "-l", ch);
    await sleep(1000 / cps);
  }
}
const enter = () => tmux("send-keys", "-t", "rec", "Enter");

async function waitFor(re, timeoutS = 120) {
  for (let i = 0; i < timeoutS * 4; i++) {
    if (re.test(pane())) return;
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${re}\n${pane()}`);
}

/** Claude Code is working while its status line says "esc to interrupt"; idle once that's gone for 4 s. */
async function waitAgentIdle(timeoutS = 600) {
  await waitFor(/esc to interrupt/, 60);
  let quiet = 0;
  for (let i = 0; i < timeoutS * 2; i++) {
    quiet = /esc to interrupt/.test(pane()) ? 0 : quiet + 1;
    if (quiet >= 8) return;
    await sleep(500);
  }
  throw new Error("agent did not finish");
}

const SHELL = "env BASH_SILENCE_DEPRECATION_WARNING=1 PS1='$ ' bash --norc --noprofile";
async function shell(name, commands) {
  await record(name, SHELL, DEMO, async () => {
    await sleep(800);
    for (const c of commands) {
      await type(c);
      await sleep(300);
      enter();
      await waitFor(/as expected|✘ expected/, 120);
      await sleep(2500);
    }
    await type("exit");
    enter();
  });
}

// The agent exactly as on stage, minus the presenter's editor connection (it would show their open file).
const AGENT = "env CLAUDE_CODE_AUTO_CONNECT_IDE=false ./run.sh --permission-mode default";
async function agent(name, asks) {
  await record(name, AGENT, path.join(DEMO, "agent"), async () => {
    await waitFor(/❯/, 60);
    await sleep(1500);
    for (const ask of asks) {
      await type(ask);
      await sleep(500);
      enter();
      await waitAgentIdle();
      await sleep(3000); // hold on the answer
    }
    await type("/exit");
    await sleep(300);
    enter();
  });
}

// --- Playwright ----------------------------------------------------------------------------------------
let browser;
async function film(name, url, script) {
  log(`● ${name} ${url}`);
  const dir = path.join(OUT, `${name}.video`);
  // 1477 CSS px wide, upscaled to 1080p by render.mjs, so text reads at 130% (Playwright's video ignores
  // deviceScaleFactor, and CSS zoom misplaces scrolling).
  // Headless Chrome's video leaves the bottom ~11% of the viewport unpainted (a grey band), so the
  // viewport is 940 px tall and render.mjs crops the top 831 back out.
  const ctx = await browser.newContext({ viewport: { width: 1477, height: 940 }, recordVideo: { dir, size: { width: 1477, height: 940 } }, colorScheme: "light", locale: "en-CA" });
  const page = await ctx.newPage();
  const t0 = Date.now();
  await page.goto(url, { waitUntil: "networkidle" });
  await sleep(1200);
  await script(page);
  await ctx.close();
  const [webm] = fs.readdirSync(dir).filter((f) => f.endsWith(".webm"));
  fs.renameSync(path.join(dir, webm), path.join(OUT, `${name}.webm`));
  fs.rmSync(dir, { recursive: true });
  timeline.push({ name, kind: "browser", url, seconds: Math.round((Date.now() - t0) / 1000) });
}

/** Scroll a selector's element into the middle of the viewport, smoothly. */
async function glide(page, selectorOrY, ms = 1800) {
  const target = typeof selectorOrY === "number" ? selectorOrY
    : await page.evaluate((s) => { const el = s.startsWith("text=") ? [...document.querySelectorAll("h1,h2,h3,h4,strong,span,div")].find((e) => e.childElementCount === 0 && e.textContent.trim() === s.slice(5)) : document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return window.scrollY + r.top - 140; }, selectorOrY);
  if (target == null) throw new Error(`not found: ${selectorOrY}`);
  await page.evaluate(([y, d]) => new Promise((res) => {
    const y0 = window.scrollY; const t0 = performance.now();
    const step = (t) => { const k = Math.min(1, (t - t0) / d); const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2; window.scrollTo(0, y0 + (y - y0) * e); k < 1 ? requestAnimationFrame(step) : res(); };
    requestAnimationFrame(step);
  }), [target, ms]);
}

// --- staging -------------------------------------------------------------------------------------------
spawnSync("pkill", ["-INT", "-f", "scripts/stage.mjs"]);
await sleep(2000);
const stageLog = path.join(OUT, "stage.log");
const stage = spawn(process.execPath, [path.join(root, "scripts/stage.mjs")], { stdio: ["ignore", fs.openSync(stageLog, "w"), fs.openSync(stageLog, "a")] });
for (let i = 0; !fs.readFileSync(stageLog, "utf8").includes("ready."); i++) {
  if (i > 300 || stage.exitCode !== null) throw new Error("staging did not start");
  await sleep(1000);
}
if (/^\s+! /m.test(fs.readFileSync(stageLog, "utf8"))) throw new Error("staging mirror incomplete; see stage.log");
log("staging ready");
browser = await chromium.launch({ channel: "chrome", headless: true });
const beats = (n) => spawnSync(path.join(root, "scripts/beats.sh"), [String(n)], { encoding: "utf8" });

try {
  // Beat 4: the law changes. Publish the rate change, show the registry's diff, ask the agent.
  await shell("b4-publish", ["scripts/beats.sh 1"]);
  await film("b4-diff", `${STAGE}/package/@tax/core/diff?from=3.0.0&to=3.1.0`, async (page) => {
    await sleep(2500);
    await glide(page, 450, 2200);
    await sleep(3500);
  });
  await agent("b4-agent", [prompts[4]]);
  if (beats(2).status !== 0) throw new Error("beats.sh 2 failed"); // the cosmetic 3.1.1, off camera

  // Beat 5: the model changes. CI on the PR, and the same gate on staging.
  await film("b5-pr", "https://github.com/bdot-real/demo-ontology/pull/21", async (page) => {
    await sleep(2000);
    await glide(page, "text=onto semantic diff", 2600);
    await sleep(7000);
    await glide(page, "text=Some checks were not successful", 2200).catch(() => glide(page, "text=All checks have failed", 2200)).catch(() => {});
    await sleep(3500);
  });
  const job = execFileSync("gh", ["pr", "checks", "21", "--repo", "bdot-real/demo-ontology", "--json", "link", "-q", ".[0].link"], { encoding: "utf8" }).trim();
  await film("b5-job", job, async () => {
    await sleep(6000);
  });
  await shell("b5-publish", ["scripts/beats.sh 3"]);

  // Beat 6: nobody broke. Publish the major, show its diff, ask the agent, re-run the position.
  await shell("b6-publish", ["scripts/beats.sh 4"]);
  await film("b6-diff", `${STAGE}/package/@tax/indirect/diff?from=1.0.1&to=2.0.0`, async (page) => {
    await sleep(2500);
    await glide(page, 450, 2200);
    await sleep(4000);
  });
  await agent("b6-agent", [prompts[6], "Re-run October's filing check."]);
} finally {
  await browser.close();
  stage.kill("SIGINT");
  fs.writeFileSync(path.join(OUT, "timeline.json"), JSON.stringify(timeline, null, 2));
}
log(`done → ${OUT}`);
