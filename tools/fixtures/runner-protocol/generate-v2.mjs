// Strict runner boundary protocol v2 draw-list vectors (docs/spec/engine/display-input-audio.md#reawakened-author-touch-hud).
//
//   node tools/fixtures/runner-protocol/generate-v2.mjs          # write schema and vectors
//   node tools/fixtures/runner-protocol/generate-v2.mjs --check   # validate committed schema and vectors
//
// V2 is an atomic cutover: it copies the unchanged v1 record families, upgrades every DrawList to the
// required two-plane shape, and leaves the v1 schema/vector files untouched.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isEntryPoint } from "../fetch.mjs";
import { schemaErrors, schemaProblems, refName } from "./schema.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../..");
const oldSchemaPath = join(repo, "packages/runner-harness/schema/runner-protocol-v1.schema.json");
const schemaPath = join(repo, "packages/runner-harness/schema/runner-protocol-v2.schema.json");
const oldVectorsPath = join(here, "vectors.json");
const vectorsPath = join(here, "vectors-v2.json");
const command = { kind: "fill", rgb: { r: 10, g: 20, b: 30 } };
const hashInput = { tick: 12, width: 640, height: 480, commands: [], marginCommands: [] };
const hashWithMargin = { ...hashInput, marginCommands: [command] };

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function drawHash(value) {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(canonical(value))) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

function createSchema() {
  const schema = JSON.parse(readFileSync(oldSchemaPath, "utf8"));
  schema.$id = "https://tk-reawakened.dev/schema/runner-protocol-v2.schema.json";
  schema.title = "TK Reawakened runner boundary protocol v2";
  schema.description = `${schema.description} V2 DrawList records require both ordered command planes.`;
  schema.$defs.drawList.required = ["tick", "width", "height", "commands", "marginCommands"];
  schema.$defs.drawList.properties.marginCommands = { type: "array", items: { $ref: "#/$defs/drawCommand" } };
  schema.$defs.actionInput = {
    type: "object",
    additionalProperties: false,
    required: ["kind", "action", "down", "source", "modalId"],
    properties: {
      kind: { const: "action" },
      action: { type: "string", minLength: 1 },
      down: { type: "boolean" },
      source: { type: "string", minLength: 1 },
      modalId: { oneOf: [{ type: "integer", minimum: 1, maximum: 9007199254740991 }, { type: "null" }] },
    },
  };
  schema.$defs.inputEvent.oneOf.push({ $ref: "#/$defs/actionInput" });
  return schema;
}

function createVectors() {
  const old = JSON.parse(readFileSync(oldVectorsPath, "utf8"));
  const rows = old.vectors.map((vector) => {
    if (vector.family !== "draw") return structuredClone(vector);
    return { ...structuredClone(vector), record: { ...vector.record, marginCommands: [] } };
  });
  rows.push(
    { id: "draw-empty-margin-plane", family: "draw", valid: true, record: { tick: 12, width: 640, height: 480, commands: [], marginCommands: [] } },
    { id: "draw-nonempty-margin-plane", family: "draw", valid: true, record: { tick: 12, width: 640, height: 480, commands: [], marginCommands: [command] } },
    { id: "refuse-draw-missing-margin-plane", family: "draw", valid: false, why: "v2 requires marginCommands, even when empty", record: { tick: 12, width: 640, height: 480, commands: [] } },
    { id: "refuse-draw-v1-extra-key", family: "draw", valid: false, why: "v2 rejects unknown keys", record: { tick: 12, width: 640, height: 480, commands: [], marginCommands: [], legacy: true } },
    { id: "input-fallback-action-down", family: "input", valid: true, record: { tick: 8, event: { kind: "action", action: "confirm", down: true, source: "runner.fallback", modalId: null } } },
    { id: "input-modal-scoped-confirm", family: "input", valid: true, record: { tick: 8, event: { kind: "action", action: "confirm", down: true, source: "runner.fallback", modalId: 3 } } },
    { id: "refuse-action-missing-source", family: "input", valid: false, why: "semantic action records require a source", record: { tick: 8, event: { kind: "action", action: "confirm", down: true, modalId: null } } },
    { id: "refuse-action-missing-modal-id", family: "input", valid: false, why: "semantic action records require explicit modal scope or null", record: { tick: 8, event: { kind: "action", action: "confirm", down: true, source: "runner.fallback" } } },
  );
  return {
    schema: 2,
    protocol: "runner-protocol-v2",
    note: "V2 is the strict two-plane runner contract: every DrawList is {tick,width,height,commands,marginCommands}; both ordered arrays are required, use AD-3 commands, and participate in the draw hash. The v1 schema and vectors remain unchanged. Validate against packages/runner-harness/schema/runner-protocol-v2.schema.json.",
    counts: {
      draw: rows.filter((vector) => vector.family === "draw").length,
      input: rows.filter((vector) => vector.family === "input").length,
      request: rows.filter((vector) => vector.family === "request").length,
      valid: rows.filter((vector) => vector.valid).length,
      invalid: rows.filter((vector) => !vector.valid).length,
    },
    vectors: rows,
    hashDrawList: [
      { id: "draw-empty-margin-hash", input: hashInput, hash: drawHash(hashInput) },
      { id: "draw-margin-only-change", a: hashInput, b: hashWithMargin, hashA: drawHash(hashInput), hashB: drawHash(hashWithMargin) },
    ],
  };
}

function documentOf(value) { return JSON.stringify(value, null, 2) + "\n"; }

function kindSetFromOneOf(schema, node) {
  const alternatives = node?.$ref !== undefined ? [schema.$defs[refName(node.$ref)]] : node?.oneOf ?? [];
  const values = alternatives.flatMap((alternative) => {
    const target = alternative?.$ref !== undefined ? schema.$defs[refName(alternative.$ref)] : alternative;
    return target?.properties?.kind?.const === undefined ? [] : [target.properties.kind.const];
  });
  return new Set(values);
}

export async function check({ schema: schemaOverride, committedSchema, vectors: vectorsOverride, committedVectors, sources = {} } = {}) {
  const schema = schemaOverride ?? JSON.parse(readFileSync(schemaPath, "utf8"));
  const vectors = vectorsOverride ?? createVectors();
  const problems = [];
  const expectedSchema = createSchema();
  const schemaText = committedSchema ?? (existsSync(schemaPath) ? readFileSync(schemaPath, "utf8") : null);
  const vectorText = committedVectors ?? (existsSync(vectorsPath) ? readFileSync(vectorsPath, "utf8") : null);
  if (schemaText !== null && schemaText !== documentOf(expectedSchema)) problems.push(`${schemaPath} differs; run node tools/fixtures/runner-protocol/generate-v2.mjs`);
  if (vectorText !== null && vectorText !== documentOf(vectors)) problems.push(`${vectorsPath} differs; run node tools/fixtures/runner-protocol/generate-v2.mjs`);
  problems.push(...schemaProblems(schema));
  for (const vector of vectors.vectors) {
    const errors = schemaErrors(schema, vector.record);
    if (vector.valid && errors.length > 0) problems.push(`vector ${vector.id}: should be valid but ${errors.join("; ")}`);
    else if (!vector.valid && errors.length === 0) problems.push(`vector ${vector.id}: should be refused${vector.why === undefined ? "" : ` (${vector.why})`}`);
  }
  for (const family of ["draw", "input", "request"]) {
    const covered = new Set(vectors.vectors.filter((vector) => vector.family === family && vector.valid).flatMap((vector) => {
      if (family === "draw") return [...vector.record.commands, ...vector.record.marginCommands].map((draw) => draw.kind);
      if (family === "input") return [vector.record.event.kind];
      return [vector.record.kind];
    }));
    const definition = schema.$defs[family === "draw" ? "drawCommand" : family === "input" ? "inputEvent" : "request"];
    for (const kind of kindSetFromOneOf(schema, definition)) {
      if (!covered.has(kind)) problems.push(`vector kit covers ${family} kind "${kind}" defined in the schema`);
    }
  }
  for (const row of vectors.hashDrawList) {
    if (row.id === "draw-margin-only-change" && row.hashA === row.hashB) problems.push("draw-margin-only-change: marginCommands must affect the draw hash");
  }
  const { typeProblems } = await import("./types.mjs");
  problems.push(...typeProblems(schema, { sources, inputAlias: "InputRecord" }));
  return problems;
}


if (isEntryPoint(import.meta.url)) {
  if (process.argv.includes("--check")) {
    const problems = await check();
    if (problems.length > 0) { console.error(problems.join("\n")); process.exitCode = 1; }
  } else {
    writeFileSync(schemaPath, documentOf(createSchema()));
    writeFileSync(vectorsPath, documentOf(createVectors()));
  }
}
