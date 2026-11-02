// Perturbation tests for the runner protocol drift check (docs/spec/engine/runners.md#drift-check).
//
// Each test mutates exactly one of the three contract surfaces — the schema, the TypeScript types or
// the vector kit — and asserts that `check()` reports a problem. Restoring the mutation is automatic
// because the check receives the mutated values as in-memory overrides and never writes to disk.

import { test } from "node:test";
import { ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { check, documentOf } from "../runner-protocol/generate.mjs";

const schemaPath = "packages/runner-harness/schema/runner-protocol-v1.schema.json";
const drawPath = "packages/core/src/ports/draw.ts";
const requestsPath = "packages/core/src/ports/requests.ts";
const vectorsPath = "tools/fixtures/runner-protocol/vectors.json";

const loadSchema = () => JSON.parse(readFileSync(schemaPath, "utf8"));
const loadVectors = () => JSON.parse(readFileSync(vectorsPath, "utf8"));

function run({ schema, vectors, sources, expect }) {
  const kit = vectors ?? loadVectors();
  const list = kit.vectors ?? kit;
  return check({
    schema: schema ?? loadSchema(),
    committed: documentOf(list),
    vectors: list,
    sources: sources ?? {},
  }).some((problem) => problem.includes(expect));
}

test("schema-only change to a nested enum is caught", () => {
  const schema = loadSchema();
  schema.$defs.blit.properties.blend.enum.push("multiply");
  ok(run({ schema, expect: 'the schema allows "multiply"' }));
});

test("schema-only change adding a nested key is caught", () => {
  const schema = loadSchema();
  schema.$defs.fontRef.properties.weight = { type: "integer" };
  ok(run({ schema, expect: 'schema definition fontRef has key "weight"' }));
});

test("schema-only change widening a request enum is caught", () => {
  const schema = loadSchema();
  schema.$defs.playVideoRequest.properties.presentation.enum.push("hidden");
  ok(run({ schema, expect: 'the schema allows "hidden"' }));
});

test("TypeScript-only change to a nested enum is caught", () => {
  ok(run({
    sources: { [drawPath]: (text) => text.replace('"normal" | "additive" | "translucent"', '"normal" | "additive" | "translucent" | "multiply"') },
    expect: 'TypeScript allows "multiply"',
  }));
});

test("TypeScript-only change adding a nested key is caught", () => {
  ok(run({
    sources: { [drawPath]: (text) => text.replace('readonly italic: boolean;\n};', 'readonly italic: boolean;\n  readonly weight?: number;\n};') },
    expect: 'TypeScript has key "weight" that schema definition fontRef lacks',
  }));
});

test("TypeScript-only change widening a request enum is caught", () => {
  ok(run({
    sources: { [requestsPath]: (text) => text.replace('"full" | "small"', '"full" | "small" | "hidden"') },
    expect: 'TypeScript allows "hidden"',
  }));
});

test("TypeScript-only change adding a required top-level key is caught", () => {
  ok(run({
    sources: { [drawPath]: (text) => text.replace('readonly iso2d: boolean;\n};', 'readonly iso2d: boolean;\n  readonly extra: number;\n};') },
    expect: 'TypeScript has key "extra" that schema definition blit lacks',
  }));
});

test("vector-only change that makes a valid record invalid is caught", () => {
  const kit = loadVectors();
  kit.vectors.find((vector) => vector.id === "draw-blit-texture").record.commands[0].alpha = 999;
  ok(run({ vectors: kit, expect: "vector draw-blit-texture: should be valid but" }));
});

test("vector-only change that breaks reproducibility is caught", () => {
  const kit = loadVectors();
  const list = kit.vectors;
  const committed = documentOf(list);
  list[0].record.tick = 999;
  const problems = check({ schema: loadSchema(), committed, vectors: list, sources: {} });
  ok(problems.some((problem) => problem.includes("differs")));
});
