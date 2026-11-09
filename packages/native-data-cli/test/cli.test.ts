import { deepEqual, equal, ok } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runCli } from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string => join(here, "fixtures", name);
const FIELDS = ["--owner-field", "owner", "--plugins-field", "plugins"];
/**
 * Documents with an extension the registry does not hold, and with contracts it does not know
 * (placeholder actors and plugin documents), are read through the `--ext` override. The
 * registry holds only `.tkranm`.
 */
const PLACEHOLDER = [...FIELDS, "--ext", ".yaml"];

/** Run the checker over a fixture folder; the JSON result is the contract, the text is its rendering. */
function check(
  name: string,
  args: readonly string[] = FIELDS,
): { readonly exitCode: number; readonly text: string; readonly reports: unknown[]; readonly documents: number } {
  const text = runCli([...args, fixture(name)]);
  const json = runCli([...args, "--json", fixture(name)]);
  equal(text.exitCode, json.exitCode);
  const parsed = JSON.parse(json.stdout) as { schema: string; documents: number; problems: number; reports: unknown[] };
  equal(parsed.schema, "tkr-native-check/1");
  equal(parsed.problems, parsed.reports.length);
  return { exitCode: text.exitCode, text: text.stdout, reports: parsed.reports, documents: parsed.documents };
}

/** A fingerprint of everything observable about a folder: names, bytes, modes and times. */
function fingerprint(root: string): string {
  const hash = createHash("sha256");
  const visit = (folder: string, prefix: string): void => {
    for (const name of readdirSync(folder).sort()) {
      const path = join(folder, name);
      const stat = statSync(path);
      hash.update(`${prefix}${name}\0${stat.isDirectory() ? "d" : "f"}\0${stat.mode}\0${stat.mtimeMs}\0${stat.size}\0`);
      if (stat.isDirectory()) visit(path, `${prefix}${name}/`);
      else hash.update(readFileSync(path));
    }
  };
  visit(root, "");
  return hash.digest("hex");
}

void test("the clean folder reports nothing", () => {
  const result = check("clean", PLACEHOLDER);
  deepEqual([result.exitCode, result.documents, result.reports], [0, 2, []]);
  equal(result.text, "2 documents checked, 0 problems found\n");
});

void test("by default a native document is a file with a registered extension, matched without regard to A-Z case", () => {
  const result = check("native-clean");
  deepEqual([result.exitCode, result.documents, result.reports], [0, 2, []]);
  equal(result.text, "2 documents checked, 0 problems found\n");
});

void test("missing or malformed stamps are reported with the path, the key and the text found", () => {
  const result = check("stamp", PLACEHOLDER);
  equal(result.exitCode, 1);
  equal(
    result.text,
    [
      "missing-version.yaml: stamp key `version` is missing",
      'not-first.yaml:3: stamp key `version` is not among the first two keys: `version` is key 3, but `contract` and `version` must be the first two keys; found "name", "contract" first',
      'number-version.yaml:2: stamp key `version` is malformed: patch is missing (YAML reads it as a number, not as text); found "1.0"',
      'prefixed-version.yaml:2: stamp key `version` is malformed: a prefix is not part of the version; found "v1.2.3"',
      'repeated-contract.yaml:3: stamp key `contract` is repeated: `contract` appears 2 times; it must appear once; found "animation-clip", "actor"',
      "unreadable.yaml:2: stamp cannot be read: YAML error: Flow sequence in block collection must be sufficiently indented and end with a ] at line 2, column 1",
      "7 documents checked, 6 problems found",
      "",
    ].join("\n"),
  );
  const stamp = (path: string, key: string | null, problem: string, found: string[], reason: string, line: number | null) => ({ class: "stamp", path, key, problem, found, reason, line });
  deepEqual(result.reports, [
    stamp("missing-version.yaml", "version", "missing", [], "the document has no `version` key", null),
    stamp("not-first.yaml", "version", "not-first", ["name", "contract"], "`version` is key 3, but `contract` and `version` must be the first two keys", 3),
    stamp("number-version.yaml", "version", "malformed", ["1.0"], "patch is missing (YAML reads it as a number, not as text)", 2),
    stamp("prefixed-version.yaml", "version", "malformed", ["v1.2.3"], "a prefix is not part of the version", 2),
    stamp("repeated-contract.yaml", "contract", "repeated", ["animation-clip", "actor"], "`contract` appears 2 times; it must appear once", 3),
    stamp("unreadable.yaml", null, "unreadable", [], "YAML error: Flow sequence in block collection must be sufficiently indented and end with a ] at line 2, column 1", 2),
  ]);
});

void test("a clip and an actor with one name are two IDs because the ID includes the extension", () => {
  const result = check("same-stem", [...FIELDS, "--ext", ".tkranm", "--ext", ".tkract"]);
  deepEqual([result.exitCode, result.documents, result.reports], [0, 2, []]);
});

void test("an extension that names a different contract than the stamp is reported with the path, the extension and both contracts", () => {
  const result = check("extension-mismatch");
  equal(result.exitCode, 1);
  deepEqual(result.reports, [
    { class: "extension-contract-mismatch", path: "clips/walk.tkranm", extension: ".tkranm", registered: "animation-clip", stamp: "actor" },
  ]);
  equal(
    result.text,
    "clips/walk.tkranm: the extension `.tkranm` is registered for the contract `animation-clip`, but the stamp names `actor`. Either the extension or the stamp is wrong; the checker cannot tell which.\n1 document checked, 1 problem found\n",
  );
});

void test("a plugin document with no owner is reported with the document and the owner ID it names", () => {
  const result = check("no-owner", PLACEHOLDER);
  equal(result.exitCode, 1);
  deepEqual(result.reports, [
    {
      class: "plugin-no-owner",
      path: "actors/guard.weather.yaml",
      id: "actors/guard.weather.yaml",
      owner: "actors/ghost.yaml",
      reason: "no document has this ID",
      fix: null,
    },
  ]);
  equal(
    result.text,
    "actors/guard.weather.yaml: plugin document `actors/guard.weather.yaml` names the owner `actors/ghost.yaml`, but no document has this ID.\n2 documents checked, 1 problem found\n",
  );
});

void test("an owner link with no back-link is reported with the owner and the plugin document it names", () => {
  const result = check("no-back-link", PLACEHOLDER);
  equal(result.exitCode, 1);
  deepEqual(result.reports, [
    {
      class: "owner-no-back-link",
      owner: { path: "actors/guard.yaml", id: "actors/guard.yaml" },
      plugin: { named: "actors/guard.weather.yaml", path: "actors/guard.weather.yaml" },
      reason: "`actors/guard.weather.yaml` names no owner",
      fix: "plugin",
    },
  ]);
  equal(
    result.text,
    "actors/guard.yaml: owner `actors/guard.yaml` names the plugin document `actors/guard.weather.yaml` (`actors/guard.weather.yaml`), but `actors/guard.weather.yaml` names no owner. Fix the plugin document.\n2 documents checked, 1 problem found\n",
  );
});

void test("a mismatched link is reported with both ends and what each names", () => {
  const result = check("mismatched-link", PLACEHOLDER);
  equal(result.exitCode, 1);
  deepEqual(result.reports, [
    {
      class: "mismatched-link",
      ends: [
        { role: "plugin", path: "actors/guard.rain.yaml", id: "actors/guard.rain.yaml", names: ["actors/guard.yaml"] },
        { role: "owner", path: "actors/guard.yaml", id: "actors/guard.yaml", names: ["actors/guard.weather.yaml"] },
      ],
      reason: "`actors/guard.rain.yaml` names the owner `actors/guard.yaml`, which names other plugin documents but not this one",
      fix: "plugin",
    },
    {
      class: "mismatched-link",
      ends: [
        { role: "owner", path: "actors/knight.yaml", id: "actors/knight.yaml", names: ["actors/knight.weather.yaml"] },
        { role: "plugin", path: "actors/knight.weather.yaml", id: "actors/knight.weather.yaml", names: ["actors/squire.yaml"] },
      ],
      reason: "`actors/knight.yaml` names `actors/knight.weather.yaml`, which names `actors/squire.yaml` as its owner instead",
      fix: null,
    },
  ]);
  equal(
    result.text,
    [
      "mismatched link: plugin `actors/guard.rain.yaml` (actors/guard.rain.yaml) names `actors/guard.yaml`; owner `actors/guard.yaml` (actors/guard.yaml) names `actors/guard.weather.yaml`: `actors/guard.rain.yaml` names the owner `actors/guard.yaml`, which names other plugin documents but not this one. Fix the plugin document.",
      "mismatched link: owner `actors/knight.yaml` (actors/knight.yaml) names `actors/knight.weather.yaml`; plugin `actors/knight.weather.yaml` (actors/knight.weather.yaml) names `actors/squire.yaml`: `actors/knight.yaml` names `actors/knight.weather.yaml`, which names `actors/squire.yaml` as its owner instead.",
      "6 documents checked, 2 problems found",
      "",
    ].join("\n"),
  );
});

void test("the checker writes nothing: every fixture folder is byte, mode and time identical after a run", () => {
  const before = fingerprint(join(here, "fixtures"));
  for (const name of readdirSync(join(here, "fixtures"))) {
    for (const args of [FIELDS, PLACEHOLDER]) {
      runCli([...args, fixture(name)]);
      runCli([...args, "--json", fixture(name)]);
    }
  }
  equal(fingerprint(join(here, "fixtures")), before);
});

void test("a file that is not UTF-8 is named as unreadable instead of being guessed at", () => {
  const folder = mkdtempSync(join(tmpdir(), "tkr-native-check-"));
  try {
    writeFileSync(join(folder, "bad.tkranm"), Buffer.from([0x63, 0x6f, 0xff, 0xfe]));
    writeFileSync(join(folder, "notes.txt"), "not a document");
    const result = JSON.parse(runCli([...FIELDS, "--json", folder]).stdout) as { documents: number; reports: unknown[] };
    equal(result.documents, 1);
    deepEqual(result.reports, [
      { class: "stamp", path: "bad.tkranm", key: null, problem: "unreadable", found: [], reason: "the file is not valid UTF-8 text", line: null },
    ]);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

void test("a legacy file beside a native document is skipped unread: only the native document is reported on", () => {
  const folder = mkdtempSync(join(tmpdir(), "tkr-native-check-"));
  try {
    // Legacy binary: not UTF-8, not YAML. If the walk opened it, it would be reported as unreadable.
    writeFileSync(join(folder, "walk.anm"), Buffer.from([0x52, 0x50, 0x47, 0x54, 0xff, 0xfe, 0x00, 0x03]));
    writeFileSync(join(folder, "hero.brd"), Buffer.from([0xff, 0x00, 0x80]));
    // Not registered, so not a native document either: skipped, and not reported.
    writeFileSync(join(folder, "walk.tkrxyz"), "contract: [broken\n");
    writeFileSync(join(folder, "notes.yaml"), "contract: [broken\n");
    writeFileSync(join(folder, "walk.tkranm"), "contract: animation-clip\n");
    const result = JSON.parse(runCli([...FIELDS, "--json", folder]).stdout) as { documents: number; reports: unknown[] };
    equal(result.documents, 1);
    deepEqual(result.reports, [
      {
        class: "stamp",
        path: "walk.tkranm",
        key: "version",
        problem: "missing",
        found: [],
        reason: "the document has no `version` key",
        line: null,
      },
    ]);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

void test("a usage mistake or an unreadable folder is an exit code, not a crash", () => {
  const help = runCli(["--help"]);
  equal(help.exitCode, 0);
  ok(help.stdout.includes("It only reports. It never"));
  const noFields = runCli([fixture("clean")]);
  equal(noFields.exitCode, 2);
  ok(noFields.stderr.includes("--owner-field and --plugins-field are required"));
  equal(runCli([...FIELDS, "--owner-field", "plugins", "--plugins-field", "plugins", fixture("clean")]).exitCode, 2);
  equal(runCli([...FIELDS, "--bogus", fixture("clean")]).exitCode, 2);
  equal(runCli([...FIELDS]).exitCode, 2);
  equal(runCli([...FIELDS, join(here, "fixtures", "does-not-exist")]).exitCode, 3);
});

void test("the command-line entry point exits 0 on a clean folder and 1 on a broken one", () => {
  const run = (name: string) => spawnSync(process.execPath, [join(here, "..", "src", "cli.ts"), ...FIELDS, fixture(name)], { encoding: "utf8" });
  const clean = run("native-clean");
  deepEqual([clean.status, clean.stdout, clean.stderr], [0, "2 documents checked, 0 problems found\n", ""]);
  const broken = run("extension-mismatch");
  equal(broken.status, 1);
  ok(broken.stdout.startsWith("clips/walk.tkranm: the extension `.tkranm` is registered for the contract `animation-clip`"));
});
