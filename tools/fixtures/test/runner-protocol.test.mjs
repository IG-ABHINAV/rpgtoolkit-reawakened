import { test } from "node:test";
import { deepEqual, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { check } from "../runner-protocol/generate.mjs";
import { schemaErrors } from "../runner-protocol/schema.mjs";

test("runner protocol vectors are reproducible in check mode", () => {
  deepEqual(check(), []);
});

test("v1 protocol validation remains independent of later core input-event kinds", () => {
  deepEqual(check({
    sources: {
      "packages/core/src/ports/input.ts": (text) => text.replace(
        'readonly kind: "action";',
        'readonly kind: "future.action";',
      ),
    },
  }), []);
});

test("v1 checker rejects a schema that admits the published v2 action", () => {
  const v1 = JSON.parse(readFileSync(new URL("../../../packages/runner-harness/schema/runner-protocol-v1.schema.json", import.meta.url), "utf8"));
  const v2 = JSON.parse(readFileSync(new URL("../../../packages/runner-harness/schema/runner-protocol-v2.schema.json", import.meta.url), "utf8"));
  const action = { tick: 12, event: { kind: "action", action: "confirm", down: true, source: "runner.fallback", modalId: null } };
  ok(schemaErrors(v1, action).length > 0, "published v1 refuses the action");
  deepEqual(schemaErrors(v2, action), [], "published v2 accepts the action");
  const widened = structuredClone(v1);
  widened.$defs.actionInput = v2.$defs.actionInput;
  widened.$defs.inputEvent.oneOf.push({ $ref: "#/$defs/actionInput" });
  deepEqual(schemaErrors(widened, action), [], "the mutation admits the action");
  ok(check({ schema: widened }).includes("v1 schema must reject semantic action input"));
});
