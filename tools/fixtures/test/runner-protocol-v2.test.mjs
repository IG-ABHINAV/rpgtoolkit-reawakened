import { test } from "node:test";
import { deepEqual } from "node:assert/strict";
import { check } from "../runner-protocol/generate-v2.mjs";

test("runner protocol v2 schema and vectors are reproducible and strictly validated", async () => {
  deepEqual(await check(), []);
});
