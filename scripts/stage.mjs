#!/usr/bin/env node
// Staging registry for rehearsals (decision D3): a fresh onto registry on a temp data dir, seeded with
// the production versions the demo depends on. Beats 4 to 6 publish the scripted versions here, never
// to production, so every run starts from the same state.
//
//   node scripts/stage.mjs                 # start fresh staging on :3299, mirror prod, stay in foreground
//   node scripts/stage.mjs --publish DIR   # publish a scripted draft to the running staging registry
//
// Env: ONTO_WEB (registry web/ dir, default .staging/registry/web, built by scripts/stage-setup.sh at
// the commit production runs), STAGE_PORT (3299), ONTO_PROD (https://onto.melx.buzz).

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(process.env.ONTO_WEB ?? path.join(here, "../.staging/registry/web"));
const PORT = process.env.STAGE_PORT ?? "3299";
const STAGE = `http://127.0.0.1:${PORT}`;
const PROD = (process.env.ONTO_PROD ?? "https://onto.melx.buzz").replace(/\/$/, "");
const STATE = path.join(here, "../.staging/state.json");

// Roots the demo needs; their dependencies are mirrored too. Packages not yet on production are skipped.
const ROOTS = process.env.STAGE_ROOTS?.split(",") ?? ["@tax/filing", "@tax/indirect", "@tax/core", "@legal/obligations", "@legal/acts", "@legal/processes", "@legal/jurisdictions"];
// Scripted demo versions: allowed on staging only.
const SCRIPTED = new Set(["@tax/core@1.1.0", "@tax/core@1.1.1", "@tax/core@3.1.0", "@tax/core@3.1.1", "@tax/indirect@1.1.0", "@tax/indirect@2.0.0"]);

// Retries: prod can briefly 404 or 5xx while it redeploys.
async function get(url) {
  for (let i = 0; ; i++) {
    const r = await fetch(url).catch((e) => ({ ok: false, status: e.message }));
    if (r.ok) return r;
    if (i === 4) throw new Error(`${r.status} ${url}`);
    await new Promise((res) => setTimeout(res, 1000 * 2 ** i));
  }
}

async function api(method, url, body, token) {
  const r = await fetch(`${STAGE}${url}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { ok: r.ok, status: r.status, json: await r.json().catch(() => ({})) };
}

/** Every published version of a production package with its files, oldest first, so diffs replay. */
async function versions(name) {
  const r = await fetch(`${PROD}/api/packages/${name}`);
  if (r.status === 404) return null;
  const pkg = await r.json();
  const out = [];
  for (const v of Object.keys(pkg.versions)) {
    const meta = await (await get(`${PROD}/api/packages/${name}/${v}`)).json();
    out.push(meta);
  }
  const key = (v) => v.version.split(/[.-]/).map((x) => x.padStart(6, "0")).join(".");
  return out.sort((a, b) => key(a).localeCompare(key(b)));
}

async function payloadFor(meta) {
  const files = [];
  let manifest;
  for (const f of meta.files) {
    const content = await (await get(f.url)).text();
    if (f.path === "onto.yaml") manifest = content;
    else files.push({ path: f.path, content });
  }
  return { manifest, files: [{ path: "onto.yaml", content: manifest }, ...files] };
}

async function mirror(token) {
  const done = new Set();
  const visit = async (name) => {
    if (done.has(name)) return;
    done.add(name);
    const vs = await versions(name);
    if (!vs) return console.log(`  skip ${name} (not on production yet)`);
    for (const dep of Object.keys(vs.at(-1).dependencies ?? {})) await visit(dep);
    for (const meta of vs) {
      if (SCRIPTED.has(`${name}@${meta.version}`)) {
        console.error(`  REFUSING: ${name}@${meta.version} is on production but is a scripted demo version (D3)`);
        continue;
      }
      // Verified mirror: staging stores prod's exact version (same dist.integrity) without re-gating it, so a
      // version published under older classifier rules still replays. Scripted versions never use this.
      const r = await api("PUT", `/api/packages/${name}`, { ...(await payloadFor(meta)), mirror: PROD }, token);
      console.log(`  ${r.ok ? "+" : "!"} ${name}@${meta.version}${r.ok ? (r.json.mirroredFrom ? "" : "  (not mirrored)") : `  ${r.json.error ?? r.status}`}`);
    }
  };
  for (const root of ROOTS) await visit(root);
}

async function start() {
  const next = path.join(WEB, "node_modules/next/dist/bin/next");
  if (!fs.existsSync(path.join(WEB, ".next/BUILD_ID"))) throw new Error(`no registry build in ${WEB}; run scripts/stage-setup.sh`);
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "onto-stage-"));
  const server = spawn(process.execPath, [next, "start", "-p", PORT], {
    cwd: WEB,
    env: { ...process.env, ONTO_DATA_DIR: data, ONTO_MIRROR_FROM: PROD },
    stdio: ["ignore", fs.openSync(path.join(data, "server.log"), "a"), fs.openSync(path.join(data, "server.log"), "a")],
  });
  const stop = () => {
    server.kill();
    fs.rmSync(data, { recursive: true, force: true });
    fs.rmSync(STATE, { force: true });
    process.exit(0);
  };
  process.on("SIGINT", stop).on("SIGTERM", stop);
  for (let i = 0; i < 60; i++) {
    if (await fetch(`${STAGE}/api/search?q=x`).then((r) => r.ok, () => false)) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const s = await api("POST", "/api/auth/signup", { username: "maplewood-demo", password: crypto.randomUUID() });
  if (!s.ok) {
    server.kill();
    throw new Error(`signup failed: ${JSON.stringify(s.json)} (another registry already on :${PORT}? \`lsof -ti tcp:${PORT}\`)`);
  }
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify({ registry: STAGE, token: s.json.token, data }), { mode: 0o600 });
  console.log(`staging registry ${STAGE} (data ${data})\nmirroring production:`);
  try {
    await mirror(s.json.token);
  } catch (e) {
    server.kill(); // don't leave an orphan registry holding the port
    fs.rmSync(data, { recursive: true, force: true });
    throw e;
  }
  console.log(`\nready. MCP: ${STAGE}/mcp   Ctrl-C resets (deletes the data dir).`);
}

// Same file selection as the onto CLI.
function pack(dir) {
  const walk = (d, out = []) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith(".") || ["node_modules", "ontologies"].includes(e.name) || e.name === "onto-lock.json") continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, out);
      else if (/\.(ttl|nt|trig|rdf|rdfs|owl|md|ya?ml|json|rq|sparql|txt)$/i.test(e.name)) out.push(path.relative(dir, p).split(path.sep).join("/"));
    }
    return out.sort();
  };
  const manifest = fs.readFileSync(path.join(dir, "onto.yaml"), "utf8");
  return { manifest, files: walk(dir).map((p) => ({ path: p, content: fs.readFileSync(path.join(dir, p), "utf8") })) };
}

async function publish(dir) {
  const { token, registry } = JSON.parse(fs.readFileSync(STATE, "utf8"));
  if (registry !== STAGE) throw new Error("staging state points elsewhere");
  const payload = pack(dir);
  const name = /^name:\s*["']?([^"'\n]+)/m.exec(payload.manifest)[1];
  const r = await api("PUT", `/api/packages/${name}`, payload, token);
  const res = r.json.details?.check ? r.json.details : r.json;
  console.log(`${r.ok ? "✔ published" : "✘ rejected"} ${name}: ${res.check?.message ?? r.json.error}`);
  for (const ch of res.diff?.changes ?? []) console.log(`  ${ch.class.padEnd(11)} ${ch.label ?? ch.iri}  ${ch.message}`);
  process.exit(r.ok ? 0 : 1);
}

const i = process.argv.indexOf("--publish");
await (i > 0 ? publish(process.argv[i + 1]) : start()).catch((e) => {
  console.error(e.message);
  process.exit(1);
});
