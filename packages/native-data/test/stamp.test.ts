import { deepEqual } from "node:assert/strict";
import test from "node:test";
import { readDocument, type StampReport } from "../src/index.ts";

const stampOf = (text: string): readonly StampReport[] => readDocument({ path: "doc.yaml", text }, []).stampReports;
const report = (key: StampReport["key"], problem: StampReport["problem"], found: readonly string[], reason: string, line: number | null): StampReport => ({
  class: "stamp",
  path: "doc.yaml",
  key,
  problem,
  found,
  reason,
  line,
});

void test("a good stamp reports nothing, with comments, a document marker and either order of the two keys", () => {
  deepEqual(stampOf("contract: animation-clip\nversion: 1.0.0-pre.3\ntags: [imported]\nmetadata:\n  source: start_s.anm\n"), []);
  deepEqual(stampOf("# a comment first\n---\nversion: 1.0.0\ncontract: actor\nname: x\n"), []);
  deepEqual(stampOf("contract: actor\nversion: '1.0.0+debug.7'\n"), []);
});

void test("a missing key is named, and an empty file misses both", () => {
  deepEqual(stampOf("contract: actor\nname: x\n"), [report("version", "missing", [], "the document has no `version` key", null)]);
  deepEqual(stampOf(""), [
    report("contract", "missing", [], "the document has no `contract` key", null),
    report("version", "missing", [], "the document has no `version` key", null),
  ]);
});

void test("a repeated key names every value found and the line of the second", () => {
  deepEqual(stampOf("contract: actor\nversion: 1.0.0\nversion: 2.0.0\n"), [
    report("version", "repeated", ["1.0.0", "2.0.0"], "`version` appears 2 times; it must appear once", 3),
  ]);
});

void test("a malformed version names the text found and the grammar rule it fails", () => {
  deepEqual(stampOf("contract: actor\nversion: 1.0\n"), [
    report("version", "malformed", ["1.0"], "patch is missing (YAML reads it as a number, not as text)", 2),
  ]);
  deepEqual(stampOf('contract: actor\nversion: "1.0"\n'), [report("version", "malformed", ["1.0"], "patch is missing", 2)]);
  deepEqual(stampOf("contract: actor\nversion: v1.2.3\n"), [report("version", "malformed", ["v1.2.3"], "a prefix is not part of the version", 2)]);
  deepEqual(stampOf("contract: actor\nversion:\n"), [report("version", "malformed", [""], "the version is empty (YAML reads it as empty, not as text)", 2)]);
  deepEqual(stampOf("contract: actor\nversion: [1, 0, 0]\n"), [report("version", "malformed", ["[1, 0, 0]"], "`version` must be a single text value", 2)]);
});

void test("a malformed contract names the text found", () => {
  deepEqual(stampOf('contract: ""\nversion: 1.0.0\n'), [report("contract", "malformed", [""], "the contract name is empty", 1)]);
  deepEqual(stampOf("contract: 5\nversion: 1.0.0\n"), [report("contract", "malformed", ["5"], "YAML reads it as a number, not as text", 1)]);
});

void test("stamp keys that are not the first two keys name the keys that are", () => {
  deepEqual(stampOf("name: Guard\ncontract: actor\nversion: 1.0.0\n"), [
    report("version", "not-first", ["name", "contract"], "`version` is key 3, but `contract` and `version` must be the first two keys", 3),
  ]);
});

void test("a document that cannot be read as one mapping is reported, never guessed at", () => {
  deepEqual(stampOf("contract: actor\nversion: 1.0.0\n---\ncontract: actor\nversion: 1.0.0\n"), [
    report(null, "unreadable", [], "the file holds 2 YAML documents; a native document is one", null),
  ]);
  deepEqual(stampOf("- contract\n- version\n"), [report(null, "unreadable", ["- contract - version"], "the document is not a mapping of keys to values", 1)]);
  deepEqual(readDocument({ path: "doc.yaml", unreadable: "the file is not valid UTF-8 text" }, []).stampReports, [
    report(null, "unreadable", [], "the file is not valid UTF-8 text", null),
  ]);
  const broken = stampOf("contract: [actor\nversion: 1.0.0\n");
  deepEqual(broken.length, 1);
  deepEqual([broken[0]!.key, broken[0]!.problem], [null, "unreadable"]);
});
