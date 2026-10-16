#!/usr/bin/env node
// Edit the 3-minute cut of beats 4, 5 and 6 in FilmCraft, driven through its MCP server (headless), and
// export it (#17). Re-runnable: it builds the project from scratch from one take's clips.
//
//   node recording/edit.mjs [take]      # .recording/clips/<take>/*.mp4 → .recording/maplewood-beats-4-6.mp4
//
// Honesty rules for the cut (the video is public):
//   - Every terminal and browser shot is the real session, unedited apart from cuts.
//   - Wherever the agent's working time is sped up, a caption says so and by how much.
//   - The 2027 QST rate is labelled hypothetical wherever it is on screen.
//   - Opening and closing cards say "For demonstration, not tax advice".

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import xterm from "@xterm/headless";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const take = process.argv[2] ?? "take3";
const CLIPS = path.join(root, ".recording/clips", take);
const PROJECT = path.join(root, ".recording", `maplewood-${take}.fcproj`);
const OUT = path.join(root, ".recording", "maplewood-beats-4-6.mp4");
const FILMCRAFT = process.env.FILMCRAFT_CLI ?? "/Volumes/T7/Projects/filmcraft/target/release/filmcraft-cli";
const TPS = 254016000000; // FilmCraft ticks per second
const ticks = (s) => Math.round(s * TPS);

// --- FilmCraft MCP client (newline-delimited JSON-RPC on stdio) ----------------------------------------
const fc = spawn(FILMCRAFT, ["mcp"], { stdio: ["pipe", "pipe", "inherit"] });
const pending = new Map();
let nextId = 1;
readline.createInterface({ input: fc.stdout }).on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.id != null && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});
const rpc = (method, params) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, (m) => (m.error ? reject(new Error(`${method}: ${JSON.stringify(m.error)}`)) : resolve(m.result)));
    fc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
async function cmd(id, params = {}) {
  const r = await rpc("tools/call", { name: "command_run", arguments: { id, params } });
  const text = r.content?.map((c) => c.text).join("") ?? "";
  if (r.isError) throw new Error(`${id} ${JSON.stringify(params).slice(0, 200)}: ${text}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "maplewood-edit", version: "1.0.0" } });
fc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

// --- When things happen in a terminal clip: replay its (redacted) cast and read the screen -------------
// Claude Code redraws its status line in fragments, so the raw stream can't be grepped; the screen can.
async function castMarks(name) {
  const [head, ...evs] = fs.readFileSync(path.join(CLIPS, `${name}.cast`), "utf8").trim().split("\n");
  const { cols, rows } = JSON.parse(head).term;
  const term = new xterm.Terminal({ cols, rows, scrollback: 0, allowProposedApi: true });
  const screen = () => Array.from({ length: rows }, (_, y) => term.buffer.active.getLine(term.buffer.active.viewportY + y)?.translateToString(true) ?? "").join("\n");
  let t = 0;
  const busy = [];
  let span = null;
  let exit = null;
  for (const l of evs) {
    const [dt, kind, data] = JSON.parse(l);
    t += dt; // asciinema v3: intervals
    if (kind !== "o") continue;
    await new Promise((r) => term.write(data, r));
    const sc = screen();
    if (exit == null && /❯ \/exit/.test(sc)) exit = t;
    if (exit != null) break; // the session is over; /exit itself shows the busy status briefly
    if (/esc to interrupt/.test(sc)) {
      if (span && t - span[1] <= 8) span[1] = t;
      else busy.push((span = [t, t]));
    }
  }
  return { busy: busy.filter(([a, b]) => b - a > 2), exit: exit ?? t, end: t };
}

// --- Build ----------------------------------------------------------------------------------------------
const seq = await cmd("file.newSequence", { name: "Maplewood: beats 4-6", width: 1920, height: 1080, fps: 30, video: 3, audio: 1 });
const names = fs.readdirSync(CLIPS).filter((f) => f.endsWith(".mp4")).sort();
const imported = await cmd("file.import", { paths: names.map((f) => path.join(CLIPS, f)) });
const item = Object.fromEntries(names.map((f, i) => [f.replace(/\.mp4$/, ""), imported.items[i]]));

const project = JSON.parse((await rpc("tools/call", { name: "project_inspect", arguments: {} })).content[0].text);
const itemDuration = Object.fromEntries(project.root.children.filter((c) => c.type === "Movie").map((c) => [c.item, c.duration / TPS]));

await cmd("captions.newTrack", { format: "Subtitle", name: "Story", language: "en" });
await cmd("captions.setStyle", { track: "C1", font: "Inter", size: 44, color: "#ffffff", background: true, backgroundColor: "#000000c8", align: "center", anchor: "bottom", margin: 0.05 });

let at = 0; // sequence time, seconds
const caption = (text, from, len) => cmd("captions.add", { track: "C1", text, seconds: from, durationSeconds: len });

/** Enlarge a shell clip 120% from its top-left corner: its few lines then read at a glance. */
async function enlarge(clip, pct = 120) {
  await cmd("effects.setParam", { clip, effect: "motion", param: "scale", value: pct });
  await cmd("effects.setParam", { clip, effect: "motion", param: "position", value: [(960 * pct) / 100, (540 * pct) / 100] });
}

/** Place [inS, outS) of a clip at `at`, optionally sped up; returns its length on the timeline. */
async function put(name, inS, outS, speed = 100) {
  const src = item[name];
  const len = Math.min(outS, itemDuration[src]) - inS;
  const r = await cmd("timeline.place", { item: src, track: "V1", seconds: at, sourceIn: ticks(inS), duration: ticks(len), audio: false });
  const clip = r.clips[0];
  if (speed !== 100) await cmd("clip.speedDuration", { clips: [clip], speed, ripple: false });
  const onTimeline = (len * 100) / speed;
  at += onTimeline;
  return { clip, start: at - onTimeline, len: onTimeline };
}

async function hold(clip, seconds) {
  // Freeze the clip's last frame for a few seconds, so the answer can be read.
  await cmd("clip.insertFrameHoldSegment", { clip, time: ticks(at - 1 / 30), seconds });
  at += seconds;
}

async function card(lines, seconds) {
  const matte = await cmd("file.newColorMatte", { color: "#14121f", seconds });
  await cmd("timeline.place", { item: matte.item ?? matte.items?.[0] ?? matte, track: "V1", seconds: at, duration: ticks(seconds) });
  // One graphic on V2 (tracks are 0-based), one text layer per line.
  let y = 430;
  let clip;
  for (const [text, size, color, style] of lines) {
    const g = await cmd("graphics.newText", { text, position: [960, y], size, seconds, fontStyle: style ?? "Regular", ...(clip ? { clip } : { track: 1, time: ticks(at) }) });
    clip = g.clip;
    await cmd("graphics.set", { clip, layer: g.layer, props: { align: "center", fill_color: color ?? "#ffffff" } });
    y += size * 1.6;
  }
  at += seconds;
}

async function title(text, from, seconds) {
  // Top right: the terminal's command line and the pages' headings are top left.
  const g = await cmd("graphics.newText", { text, position: [1860, 84], size: 46, seconds, track: 2, time: ticks(from), fontStyle: "Bold" });
  await cmd("graphics.set", { clip: g.clip, layer: g.layer, props: { align: "right", fill_color: "#ffffff", background: true, shadow: true } });
}

/** An agent clip: typing at real speed, working time sped up (and captioned), then a hold on the answer. */
async function agentShot(name, asks) {
  const m = await castMarks(name);
  if (m.busy.length < asks.length) throw new Error(`${name}: expected ${asks.length} busy spans, found ${m.busy.length}`);
  let cursor = 0;
  let last;
  for (let i = 0; i < asks.length; i++) {
    const [b0, b1] = m.busy[i];
    const { typing, target, note, read } = asks[i];
    const typeFrom = Math.max(cursor, b0 - typing);
    const a = await put(name, typeFrom, b0 + 0.3); // typing the question, real time
    if (note) await caption(note, a.start, a.len);
    const speed = Math.max(100, Math.round(((b1 - b0) / target) * 100));
    const w = await put(name, b0 + 0.3, b1 + 0.8, speed);
    await caption(`${read ? read + " · " : ""}Agent working: sped up ${(speed / 100).toFixed(speed % 100 ? 1 : 0)}×`, w.start, w.len);
    const tail = i + 1 < asks.length ? m.busy[i + 1][0] - asks[i + 1].typing - 0.2 : m.exit - 0.4;
    last = await put(name, b1 + 0.8, Math.min(tail, b1 + 4));
    cursor = Math.min(tail, b1 + 4);
  }
  return last;
}

// 0:00 Opening card
await card(
  [
    ["Maplewood Compliance Agent", 84, "#ffffff", "Bold"],
    ["Beats 4–6: the law changes · the model changes · nobody broke", 40, "#c9c3ff"],
    ["Fictional company · real rates verified 2026-10-16 · For demonstration, not tax advice", 30, "#a7a3b8"],
  ],
  6,
);

// Beat 4: the law changes
let b = at;
let s = await put("b4-publish", 0, 99);
await enlarge(s.clip);
await caption("A data steward publishes @tax/core 3.1.0 to the staging registry: a hypothetical 2027 QST rate", s.start, s.len);
s = await put("b4-diff", 0, 99);
await caption("The registry classifies it: one additive change, so a minor bump is accepted", s.start, s.len);
let last = await agentShot("b4-agent", [{ typing: 4, target: 7, note: "The agent is pinned to @tax/core ^3. Ask it what changed." }]);
await hold(last.clip, 5);
await caption("It reads the diff through typed tools, not OWL: nothing breaks, and it flags that the hypothetical rate has no source", last.start, at - last.start);
await title("4 · The law changes", b, at - b);

// Beat 5: the model changes
b = at;
s = await put("b5-pr", 0, 18);
await caption("A pull request labels a breaking schema change as a minor version (1.1.0)", s.start, 6);
await caption("CI posts the registry's semantic diff: two breaking changes, so it needs 2.0.0", s.start + 6, s.len - 6);
s = await put("b5-job", 0, 99);
await caption("The Gate step fails, so the PR can't merge", s.start, s.len);
s = await put("b5-publish", 0, 99);
await enlarge(s.clip);
await caption("The registry enforces the same rule on publish: rejected", s.start, s.len);
await title("5 · The model changes", b, at - b);

// Beat 6: nobody broke
b = at;
s = await put("b6-publish", 0, 99);
await enlarge(s.clip);
await caption("The schema change ships properly, as @tax/indirect 2.0.0", s.start, s.len);
s = await put("b6-diff", 0, 99);
await caption("placeOfSupply becomes required; claimedOn is deprecated for creditedSupply", s.start, s.len);
last = await agentShot("b6-agent", [
  { typing: 3, target: 8, note: "The agent is pinned to @tax/indirect ^1. Is it affected?" },
  { typing: 2, target: 10, note: "Not affected today: the pin stays on 1.0.1. Now re-run October", read: "Validating 198 invoices, 7 obligations and 7 returns through tools" },
]);
s = await put("b6-agent-scroll", 0, 99);
await caption("Scrolling back through that answer, verbatim from the session", s.start, 4);
await caption("Same October position: every line cites its provision and filing deadline", s.start + 4, s.len - 4);
await title("6 · Nobody broke", b, at - b);

// Closing card
await card(
  [
    ["Pinned, typed, versioned ontologies for agents", 56, "#ffffff", "Bold"],
    ["onto.melx.buzz  ·  github.com/bdot-real/demo-ontology", 40, "#c9c3ff"],
    ["Rates as verified 2026-10-16 · US lines are state rate only · For demonstration, not tax advice", 28, "#a7a3b8"],
  ],
  6,
);

console.log(`timeline: ${at.toFixed(1)} s`);
if (at > 180) throw new Error(`cut is ${at.toFixed(1)} s; the brief asks for 3 minutes`);
await cmd("file.saveAs", { path: PROJECT });
const ex = await cmd("file.exportMedia", { path: OUT, format: "h264", width: 1920, height: 1080, fps: 30, burnCaptions: true, audio: false, crf: 18, bitrateMode: "crf", wait: true });
console.log(JSON.stringify(ex).slice(0, 300));
fc.stdin.end();
fc.kill();
console.log(`✔ ${OUT}`);
