import { test } from "node:test";
import { deepEqual } from "node:assert/strict";
import { check } from "../runner-protocol/generate.mjs";

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
