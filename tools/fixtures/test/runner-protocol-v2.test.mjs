import { test } from "node:test";
import { deepEqual, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { check } from "../runner-protocol/generate-v2.mjs";
import { schemaErrors, schemaProblems } from "../runner-protocol/schema.mjs";

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
  vectors.vectors = vectors.vectors.filter((vector) => !(vector.valid && vector.family === "input" && vector.record.event.kind === "action"));
  const problems = await check({ vectors });
  ok(problems.some((problem) => problem.includes('vector kit covers input kind "action"')));
});

test("host snapshot schema accepts precisely ascending unique device sequences", () => {
  const schema = JSON.parse(readFileSync("packages/runner-harness/schema/runner-protocol-v2.schema.json", "utf8"));
  const definition = schema.$defs.hostGamepadsInput;
  const checkSequence = (devices) => {
    const event = { kind: "host.gamepads", devices: devices.map((device) => ({ device, axes: { x: 0, y: 0 }, buttons: 0 })) };
    const expected = devices.every((device, index) => index === 0 || devices[index - 1] < device);
    deepEqual(schemaErrors(schema, event, definition).length === 0, expected, JSON.stringify(devices));
    if (devices.length < 4) for (let device = 0; device < 4; device += 1) checkSequence([...devices, device]);
  };
  checkSequence([]);
});

test("schema evaluator checks prefixItems and array-length keywords", () => {
  const schema = JSON.parse(readFileSync("packages/runner-harness/schema/runner-protocol-v2.schema.json", "utf8"));
  const rule = { prefixItems: [{ const: 0 }], minItems: 1, maxItems: 2, items: { const: 1 } };
  deepEqual(schemaErrors(schema, [0, 1], rule), []);
  for (const value of [[], [1], [0, 2], [0, 1, 1]]) ok(schemaErrors(schema, value, rule).length > 0);
  for (const [keyword, invalid] of [["prefixItems", []], ["minItems", -1], ["maxItems", 1.5]]) {
    const broken = structuredClone(schema);
    broken.$defs.hostGamepadsInput.properties.devices[keyword] = invalid;
    ok(schemaProblems(broken).some((problem) => problem.includes(keyword)));
  }
});
