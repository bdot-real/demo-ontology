#!/usr/bin/env node
// Generic MCP bridge for onto's per-version tool manifests (decision D6).
//
// The registry generates an MCP tool manifest and a JSON Schema for every package version, but serves
// them as static artifacts. This server loads them for the packages pinned in pins.json and exposes them
// as live tools. No tool is written by hand: the tool set, names, descriptions and validation shapes all
// come from the manifest of the resolved version, so a new package version changes the tools with no
// code change. Packages that are not yet published are skipped.
//
//   ONTO_REGISTRY=https://onto.melx.buzz node agent/onto-tools.mjs     (stdio MCP server)
//
// Tools: <pkg>__search_terms, <pkg>__describe_term, <pkg>__list_subclasses and <pkg>__validate_<class>
// from each manifest (prefixed so packages don't collide), plus two package-agnostic helpers:
// onto_pins (which version each range resolved to) and onto_validate_batch (validate a seed file).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const here = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY = (process.env.ONTO_REGISTRY ?? "https://onto.melx.buzz").replace(/\/$/, "");
const PINS = JSON.parse(fs.readFileSync(process.env.ONTO_PINS ?? path.join(here, "pins.json"), "utf8"));
const SEED = path.resolve(here, "../seed");

const slug = (name) => name.replace(/^@/, "").replace(/[^a-z0-9]+/gi, "_").toLowerCase();

// --- SemVer: enough for the ^ and ~ ranges in pins.json, plus exact versions -----------------------
const parse = (v) => v.split("-")[0].split(".").map(Number);
function satisfies(v, range) {
  if (v.includes("-")) return false;
  const [a, b, c] = parse(v);
  const op = /^[\^~]/.test(range) ? range[0] : "=";
  const [x, y, z] = parse(range.replace(/^[\^~=]/, ""));
  const gte = a > x || (a === x && (b > y || (b === y && c >= z)));
  if (op === "=") return a === x && b === y && c === z;
  if (op === "~") return gte && a === x && b === y;
  return gte && (x > 0 ? a === x : y > 0 ? a === 0 && b === y : a === 0 && b === 0 && c === z);
}
const cmp = (p, q) => parse(p).reduce((d, n, i) => d || n - parse(q)[i], 0);

async function json(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

/** The registry's own MCP endpoint; used for read tools so answers match the registry exactly. */
async function registryTool(name, args) {
  const r = await fetch(`${REGISTRY}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  const text = await r.text();
  const body = text.startsWith("{") ? JSON.parse(text) : JSON.parse(/^data: (.*)$/m.exec(text)[1]);
  if (body.error) throw new Error(body.error.message);
  return body.result;
}

// --- Load the pinned packages ----------------------------------------------------------------------
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const packages = []; // { name, range, version, tools, validators: Map<toolName, {cls, validate}> }

for (const [name, range] of Object.entries(PINS)) {
  let packument;
  try {
    packument = await json(`${REGISTRY}/api/packages/${name}`);
  } catch {
    packages.push({ name, range, version: null });
    continue;
  }
  const version = Object.keys(packument.versions).filter((v) => satisfies(v, range)).sort(cmp).at(-1);
  if (!version) {
    packages.push({ name, range, version: null });
    continue;
  }
  const base = `${REGISTRY}/api/packages/${name}/${version}/artifacts`;
  const [manifest, schema] = await Promise.all([json(`${base}/mcp`), json(`${base}/jsonschema`)]);
  const validators = new Map();
  for (const t of manifest.tools) {
    if (!t.name.startsWith("validate_")) continue;
    const cls = Object.keys(schema.$defs).find((k) => schema.$defs[k]["x-iri"] === t.inputSchema["x-iri"]) ?? t.inputSchema.title;
    validators.set(t.name, { cls, iri: t.inputSchema["x-iri"], shape: t.inputSchema, validate: ajv.compile(schema.$defs[cls] ?? t.inputSchema) });
  }
  packages.push({ name, range, version, tools: manifest.tools, validators });
}

const loaded = packages.filter((p) => p.version);

// --- Tool list -------------------------------------------------------------------------------------
// validate_* tools take {instance}. The class's real closed-world shape is enforced here on the server
// and summarized in the description. If the client enforced it, a bad row would come back as a client
// argument error instead of the ontology's own rejection, and beat 2 shows the rejection.
function listTools() {
  const tools = [];
  for (const p of loaded) {
    const pfx = `${slug(p.name)}__`;
    for (const t of p.tools) {
      const v = p.validators.get(t.name);
      if (v) {
        const req = (v.shape.required ?? []).filter((r) => r !== "@id");
        tools.push({
          name: pfx + t.name,
          description: `[${p.name}@${p.version}] ${t.description} Required: ${req.join(", ") || "none"}. Allowed properties: ${Object.keys(v.shape.properties ?? {}).join(", ")}. Class IRI: ${v.iri}`,
          inputSchema: { type: "object", properties: { instance: { type: "object", description: `A ${v.cls} instance as JSON, keyed by the properties above` } }, required: ["instance"] },
        });
      } else {
        tools.push({ name: pfx + t.name, description: `[${p.name}@${p.version}] ${t.description}`, inputSchema: t.inputSchema });
      }
    }
  }
  tools.push({
    name: "onto_pins",
    description: "Show each pinned onto package, its SemVer range, and the version it resolved to (null = not published yet).",
    inputSchema: { type: "object", properties: {} },
  });
  tools.push({
    name: "onto_validate_batch",
    description:
      "Validate every row of a seed file (JSON array or JSONL under seed/) against one validate_* tool's closed-world shape. Returns valid/invalid counts and, for each invalid row, its line and the schema errors.",
    inputSchema: {
      type: "object",
      properties: { tool: { type: "string", description: "A validate tool name from this server, e.g. tax_indirect__validate_taxable_supply" }, file: { type: "string", description: "Path relative to seed/" } },
      required: ["tool", "file"],
    },
  });
  return tools;
}

function findValidator(toolName) {
  for (const p of loaded) {
    const pfx = `${slug(p.name)}__`;
    if (toolName.startsWith(pfx)) return { p, v: p.validators.get(toolName.slice(pfx.length)), local: toolName.slice(pfx.length) };
  }
  return {};
}

const fmtErrors = (errs) => (errs ?? []).map((e) => `${e.instancePath || "(root)"} ${e.message}${e.params?.missingProperty ? `: ${e.params.missingProperty}` : e.params?.additionalProperty ? `: ${e.params.additionalProperty}` : ""}`);
const text = (o) => ({ content: [{ type: "text", text: typeof o === "string" ? o : JSON.stringify(o, null, 2) }] });

async function callTool(name, args = {}) {
  if (name === "onto_pins") return text(packages.map(({ name, range, version }) => ({ name, range, version })));

  if (name === "onto_validate_batch") {
    const { p, v } = findValidator(args.tool);
    if (!v) return { ...text(`unknown validate tool: ${args.tool}`), isError: true };
    const file = path.resolve(SEED, args.file);
    if (!file.startsWith(SEED + path.sep)) return { ...text("file must be under seed/"), isError: true };
    const raw = fs.readFileSync(file, "utf8");
    const rows = raw.trimStart().startsWith("[") ? JSON.parse(raw) : raw.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
    const invalid = [];
    rows.forEach((row, i) => {
      if (!v.validate(row)) invalid.push({ line: i + 1, "@id": row["@id"], errors: fmtErrors(v.validate.errors) });
    });
    return text({ package: `${p.name}@${p.version}`, class: v.cls, rows: rows.length, valid: rows.length - invalid.length, invalid: invalid.length, rejected: invalid });
  }

  const { p, v, local } = findValidator(name);
  if (!p) return { ...text(`unknown tool: ${name}`), isError: true };
  if (v) {
    const ok = v.validate(args.instance ?? {});
    return text({ package: `${p.name}@${p.version}`, class: v.cls, valid: ok, errors: ok ? [] : fmtErrors(v.validate.errors) });
  }
  // Read tools: forwarded to the registry, pinned to the resolved version.
  const at = { version: p.version };
  if (local === "search_terms") {
    const all = await registryTool("list_terms", { name: p.name, ...at, kind: args.kind, limit: 500 });
    const { terms } = JSON.parse(all.content[0].text);
    const q = String(args.query ?? "").toLowerCase();
    return text(terms.filter((t) => t.label?.toLowerCase().includes(q) || t.iri.toLowerCase().includes(q)));
  }
  if (local === "describe_term") return registryTool("describe_term", { iri: args.iri, package: p.name, ...at });
  if (local === "list_subclasses") return registryTool("get_hierarchy", { name: p.name, root: args.iri, ...at });
  return { ...text(`${name}: no handler for manifest tool "${local}"`), isError: true };
}

const server = new Server({ name: "onto-tools", version: "1.0.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: listTools() }));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  try {
    return await callTool(req.params.name, req.params.arguments);
  } catch (e) {
    return { ...text(e.message), isError: true };
  }
});
await server.connect(new StdioServerTransport());
console.error(`onto-tools: ${REGISTRY}, ${loaded.length}/${packages.length} pinned packages published`);
