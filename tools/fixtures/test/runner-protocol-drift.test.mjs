// Perturbation tests for the runner protocol drift check (docs/spec/engine/runners.md#drift-check).
//
// Each test mutates exactly one of the three contract surfaces — the schema, the TypeScript types or
// the vector kit — and asserts that `check()` reports a problem. Restoring the mutation is automatic
// because the check receives the mutated values as in-memory overrides and never writes to disk.

import { test } from "node:test";
import { ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { check as checkV2 } from "../runner-protocol/generate-v2.mjs";

const schemaPath = "packages/runner-harness/schema/runner-protocol-v2.schema.json";
const drawPath = "packages/core/src/ports/draw.ts";
const requestsPath = "packages/core/src/ports/requests.ts";
const inputPath = "packages/core/src/ports/input.ts";
const vectorsPath = "tools/fixtures/runner-protocol/vectors-v2.json";

const loadSchema = () => JSON.parse(readFileSync(schemaPath, "utf8"));
const loadVectors = () => JSON.parse(readFileSync(vectorsPath, "utf8"));

async function run({ schema, vectors, sources, expect }) {
  const kit = vectors ?? loadVectors();
  const problems = await checkV2({
    schema: schema ?? loadSchema(),
    vectors: kit,
    sources: sources ?? {},
  });
  return problems.some((problem) => problem.includes(expect));
}

test("schema-only change to a nested enum is caught", async () => {
  const schema = loadSchema();
  schema.$defs.blit.properties.blend.enum.push("multiply");
  ok(await run({ schema, expect: 'the schema allows "multiply"' }));
});

test("schema-only change adding a nested key is caught", async () => {
  const schema = loadSchema();
  schema.$defs.fontRef.properties.weight = { type: "integer" };
  ok(await run({ schema, expect: 'schema definition fontRef has key "weight"' }));
});

test("schema-only change widening a request enum is caught", async () => {
  const schema = loadSchema();
  schema.$defs.playVideoRequest.properties.presentation.enum.push("hidden");
  ok(await run({ schema, expect: 'the schema allows "hidden"' }));
});

test("TypeScript-only change to a nested enum is caught", async () => {
  ok(await run({
    sources: { [drawPath]: (text) => text.replace('"normal" | "additive" | "translucent"', '"normal" | "additive" | "translucent" | "multiply"') },
    expect: 'TypeScript allows "multiply"',
  }));
});

test("TypeScript-only change adding a nested key is caught", async () => {
  ok(await run({
    sources: { [drawPath]: (text) => text.replace('readonly italic: boolean;\n};', 'readonly italic: boolean;\n  readonly weight?: number;\n};') },
    expect: 'TypeScript has key "weight" that schema definition fontRef lacks',
  }));
});

test("TypeScript-only change widening a request enum is caught", async () => {
  ok(await run({
    sources: { [requestsPath]: (text) => text.replace('"full" | "small"', '"full" | "small" | "hidden"') },
    expect: 'TypeScript allows "hidden"',
  }));
});

test("TypeScript-only change adding a required top-level key is caught", async () => {
  ok(await run({
    sources: { [drawPath]: (text) => text.replace('readonly iso2d: boolean;\n};', 'readonly iso2d: boolean;\n  readonly extra: number;\n};') },
    expect: 'TypeScript has key "extra" that schema definition blit lacks',
  }));
});

test("vector-only change that makes a valid record invalid is caught", async () => {
  const kit = loadVectors();
  kit.vectors.find((vector) => vector.id === "draw-blit-texture").record.commands[0].alpha = 999;
  ok(await run({ vectors: kit, expect: "vector draw-blit-texture: should be valid but" }));
});

test("vector-only change that breaks reproducibility is caught", async () => {
  const kit = loadVectors();
  kit.vectors[0].record.tick = 999;
  const problems = await checkV2({
    schema: loadSchema(),
    vectors: kit,
    committedVectors: readFileSync(vectorsPath, "utf8"),
  });
  ok(problems.some((problem) => problem.includes("differs")));
});
test("v2 action drift uses the active v2 input union while v1 stays historical", async () => {
  const problems = await checkV2({
    schema: loadSchema(),
    vectors: loadVectors(),
    sources: { [inputPath]: (text) => text.replace("  | ActionInput\n", "") },
  });
  ok(problems.some((problem) => problem.includes("InputRecord.event: the schema allows object")));
});

test("published ordering refusals catch removal of the schema ordering guard", async () => {
  const schema = loadSchema();
  delete schema.$defs.hostGamepadsInput.properties.devices.oneOf;
  ok(await run({ schema, expect: "vector host-gamepads-order-descending: should be refused" }));
  ok(await run({ schema, expect: "vector host-gamepads-order-duplicate: should be refused" }));
});
