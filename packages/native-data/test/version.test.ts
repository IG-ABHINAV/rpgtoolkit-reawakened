import { deepEqual, equal } from "node:assert/strict";
import test from "node:test";
import { parseVersion } from "../src/index.ts";

/**
 * The version grammar, from the valid and invalid examples on
 * docs/spec/formats/native-contracts.md#versions (the table under "The form of a
 * version string"). Each invalid row also pins the rule it fails.
 */
const valid = ["1.0.0", "1.2.3", "1.0.0-pre.12", "1.0.0+debug.7", "1.0.0-pre.12+build.5"];

const invalid: readonly (readonly [text: string, reason: string])[] = [
  ["1.0", "patch is missing"],
  ["v1.2.3", "a prefix is not part of the version"],
  ["1.0.0-", "the pre-release after `-` is empty"],
  ["1.0.0+", "the build suffix after `+` is empty"],
  ["01.0.0", "major `01` has a leading zero"],
];

void test("every valid example from the spec page parses", () => {
  for (const text of valid) equal(parseVersion(text).ok, true, text);
});

void test("every invalid example from the spec page fails for the stated reason", () => {
  for (const [text, reason] of invalid) deepEqual(parseVersion(text), { ok: false, reason }, text);
});

void test("the parts are kept as written, and the build suffix is only carried", () => {
  deepEqual(parseVersion("2.10.7-pre.12+build.5"), { ok: true, major: "2", minor: "10", patch: "7", pre: "12", build: "build.5" });
  deepEqual(parseVersion("1.0.0"), { ok: true, major: "1", minor: "0", patch: "0", pre: null, build: null });
});

void test("other near misses are refused", () => {
  const refused: readonly (readonly [string, string])[] = [
    ["", "the version is empty"],
    ["1", "minor and patch are missing"],
    ["1.0.0.0", "a version has exactly three numeric parts"],
    ["1.x.0", "minor `x` is not a whole number"],
    ["1.0.00", "patch `00` has a leading zero"],
    ["1.0.0-rc.1", "the pre-release `rc.1` is not `pre.N`"],
    ["1.0.0-pre", "the pre-release `pre` is not `pre.N`"],
    ["1.0.0-pre.07", "the pre-release number `07` has a leading zero"],
    ["1.0.0+a..b", "the build suffix has an empty identifier"],
    ["1.0.0+a_b", "the build suffix identifier `a_b` may hold only letters, digits and hyphens"],
    [" 1.0.0", "major ` 1` is not a whole number"],
  ];
  for (const [text, reason] of refused) deepEqual(parseVersion(text), { ok: false, reason }, JSON.stringify(text));
});
