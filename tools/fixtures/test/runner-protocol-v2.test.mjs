import { test } from "node:test";
import { deepEqual, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { check } from "../runner-protocol/generate-v2.mjs";

test("runner protocol v2 schema and vectors are reproducible and strictly validated", async () => {
  deepEqual(await check(), []);
});

test("invalid records without marginCommands do not enter valid-kind coverage", async () => {
  const vectors = JSON.parse(readFileSync("tools/fixtures/runner-protocol/vectors-v2.json", "utf8"));
  vectors.vectors.push({
    id: "refuse-draw-missing-margin-regression",
    family: "draw",
    valid: false,
    record: { tick: 1, width: 2, height: 2, commands: [] },
  });
  const problems = await check({ vectors });
  ok(problems.some((problem) => problem.includes("vectors-v2.json differs")));
});

test("kind coverage resolves referenced union alternatives", async () => {
  const vectors = JSON.parse(readFileSync("tools/fixtures/runner-protocol/vectors-v2.json", "utf8"));
  vectors.vectors = vectors.vectors.filter((vector) => vector.id !== "input-fallback-action-down");
  const problems = await check({ vectors });
  ok(problems.some((problem) => problem.includes('vector kit covers input kind "action"')));
});
