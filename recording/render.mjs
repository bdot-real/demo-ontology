#!/usr/bin/env node
// Turn a take's raw footage into 1920x1080 H.264 clips FilmCraft can import (#17).
//
//   node recording/render.mjs [take]         # .recording/raw/<take>/* → .recording/clips/<take>/*.mp4
//
// Terminal: the asciinema cast is redacted (account plan, local path, login notice: presenter details,
// not demo content), rendered by agg, then fitted to 1080p on the theme's background. Nothing the agent
// says is changed. Browser: Playwright's WebM is re-encoded at 30 fps.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import xterm from "@xterm/headless";

const { Terminal } = xterm;

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const take = process.argv[2] ?? "take1";
const RAW = path.join(root, ".recording/raw", take);
const OUT = path.join(root, ".recording/clips", take);
fs.mkdirSync(OUT, { recursive: true });

const THEME = "monokai";
const BG = "0x272822"; // monokai background, for the letterbox
const FIT = `scale=1920:1080:force_original_aspect_ratio=decrease:flags=lanczos,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=${BG},format=yuv420p`;

// Presenter details in the Claude Code banner. The TUI draws word by word with cursor jumps (ESC[nG), so
// each phrase matches with either a space or a jump between words.
const gap = "(?:\\u001b\\[\\d+G| )+";
const phrase = (...words) => new RegExp(words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(gap), "g");
const REDACT = [
  [new RegExp(`·${gap}Claude${gap}(?:Max|Pro|Team|Enterprise)`, "g"), ""],
  [new RegExp(`⚠${gap}Your${gap}login${gap}expires[^\\r\\n]*?renew`, "g"), ""],
  [phrase("←", "1", "agent"), ""],
  // Claude Code's own promo tips ("Share Claude Code and earn $10…"): not part of the demo.
  [/Tip:(?:[^\r\n]|\u001b\[[0-9;]*[A-Za-z])*?\/passes/g, ""],
];
// Never allowed on any screen, checked by replaying the whole cast in a headless terminal.
const FORBIDDEN = ["/Volumes/", "/Users/bdot", "Claude Max", "login expires", "bdot@", "The.bdot", "earn $10"];

function redact(castIn, castOut) {
  const lines = fs.readFileSync(castIn, "utf8").split("\n");
  const out = [lines[0].replace(/"env":\{[^}]*\}/, '"env":{}')];
  let hits = 0;
  for (const l of lines.slice(1)) {
    if (!l.trim()) continue;
    const ev = JSON.parse(l);
    if (ev[1] === "o") for (const [re, to] of REDACT) ev[2] = ev[2].replace(re, () => (hits++, to));
    out.push(JSON.stringify(ev));
  }
  fs.writeFileSync(castOut, out.join("\n") + "\n");
  return hits;
}

/** Replay the cast and read every screen state (scrollback included) for anything forbidden. */
async function screensClean(cast) {
  const [head, ...evs] = fs.readFileSync(cast, "utf8").trim().split("\n");
  const { cols, rows } = JSON.parse(head).term;
  const term = new Terminal({ cols, rows, scrollback: 5000, allowProposedApi: true });
  const leaks = new Set();
  const scan = () => {
    const b = term.buffer.active;
    for (let y = 0; y < b.length; y++) {
      const t = b.getLine(y)?.translateToString(true) ?? "";
      for (const f of FORBIDDEN) if (t.includes(f)) leaks.add(`${f} :: ${t.trim().slice(0, 100)}`);
    }
  };
  for (const l of evs) {
    const [, kind, data] = JSON.parse(l);
    if (kind === "o") await new Promise((r) => term.write(data, r));
    if (kind === "r") { const [c, rr] = data.split("x").map(Number); term.resize(c, rr); }
    scan();
  }
  return [...leaks];
}

const run = (cmd, args) => execFileSync(cmd, args, { stdio: ["ignore", "ignore", "inherit"] });

for (const f of fs.readdirSync(RAW).sort()) {
  const name = f.replace(/\.(cast|webm)$/, "");
  const mp4 = path.join(OUT, `${name}.mp4`);
  if (f.endsWith(".cast")) {
    const clean = path.join(OUT, `${name}.cast`);
    const hits = redact(path.join(RAW, f), clean);
    const leaks = await screensClean(clean);
    if (leaks.length) throw new Error(`${name}: private details on screen after redaction:\n  ${leaks.join("\n  ")}`);
    const gif = path.join(OUT, `${name}.gif`);
    // Shell segments: cap idle gaps at 1.5 s. Agent segments keep real time; the edit speeds up and labels.
    const idle = name.endsWith("-agent") ? "600" : "1.5";
    run("agg", ["--font-size", "22", "--theme", THEME, "--idle-time-limit", idle, "--last-frame-duration", "3", clean, gif]);
    run("ffmpeg", ["-v", "error", "-y", "-i", gif, "-vf", FIT, "-r", "30", "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-movflags", "+faststart", mp4]);
    fs.rmSync(gif);
    console.log(`✔ ${name}.mp4 (terminal, ${hits} redactions)`);
  } else if (f.endsWith(".webm")) {
    run("ffmpeg", ["-v", "error", "-y", "-i", path.join(RAW, f), "-vf", `crop=1476:830:0:0,${FIT.replace("lanczos", "lanczos+accurate_rnd")}`, "-r", "30", "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-movflags", "+faststart", mp4]);
    console.log(`✔ ${name}.mp4 (browser)`);
  } else continue;
  const d = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", mp4], { encoding: "utf8" }).trim();
  console.log(`    ${Number(d).toFixed(1)} s`);
}

// Beat 6's re-run answer outgrows the terminal; add the scroll-back shot of it (recording/scrollback.mjs).
if (fs.existsSync(path.join(OUT, "b6-agent.cast"))) {
  execFileSync(process.execPath, [path.join(root, "recording/scrollback.mjs"), take, "b6-agent", "Re-run October's filing check.", "For demonstration, not tax advice."], { stdio: "inherit" });
}
