import { deepEqual, equal, ok } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runCli as check } from "@tk-reawakened/native-data-cli";
import { HELP, RESULT_SCHEMA, runCli } from "../src/index.ts";
import { faultyFs, fingerprint, FIELD_ARGS, listFiles, OWNER, PROJECT, read, WEATHER, withProject } from "./helpers.ts";

const here = dirname(fileURLToPath(import.meta.url));

const DRY_RUN_TEXT = [
  "dry run: nothing is written",
  "move actors/guard.tkract -> actors/knight.tkract",
  "edit actors/guard.tkrrai",
  "  line 3:",
  "    - owner: actors/guard.tkract  # back-link",
  "    + owner: actors/knight.tkract  # back-link",
  "edit actors/guard.tkrwth",
  "  line 3:",
  '    - owner: "actors/guard.tkract"   # back-link',
  '    + owner: "actors/knight.tkract"   # back-link',
  "would change: 1 document moved, 2 documents edited (2 lines changed)",
  "",
].join("\n");

const rename = (root: string, ...args: string[]) => runCli([...FIELD_ARGS, ...args, root, "actors/guard.tkract=actors/knight.tkract"]);

void test("a dry run prints the plan, exactly, and writes nothing", () => {
  withProject(PROJECT, (root) => {
    const before = fingerprint(root);
    const result = rename(root, "--dry-run");
    deepEqual(result, { exitCode: 0, stdout: DRY_RUN_TEXT, stderr: "" });
    equal(fingerprint(root), before);
    const json = runCli([...FIELD_ARGS, "--dry-run", "--json", root, "actors/guard.tkract=actors/knight.tkract"]);
    equal(json.exitCode, 0);
    deepEqual(JSON.parse(json.stdout), {
      schema: RESULT_SCHEMA,
      result: "dry-run",
      plan: {
        moves: [{ from: "actors/guard.tkract", to: "actors/knight.tkract" }],
        edits: [
          { path: "actors/guard.tkrrai", changes: [{ line: 3, before: "owner: actors/guard.tkract  # back-link", after: "owner: actors/knight.tkract  # back-link" }] },
          { path: "actors/guard.tkrwth", changes: [{ line: 3, before: 'owner: "actors/guard.tkract"   # back-link', after: 'owner: "actors/knight.tkract"   # back-link' }] },
        ],
      },
    });
    equal(fingerprint(root), before);
  });
});

void test("a dry run also reports what the file system would refuse, and still writes nothing", () => {
  withProject(PROJECT, (root) => {
    mkdirSync(join(root, "actors/knight.tkract"));
    const before = fingerprint(root);
    deepEqual(rename(root, "--dry-run"), {
      exitCode: 1,
      stdout: "",
      stderr: "tkr-native-rename: cannot rename: actors/knight.tkract already exists, so actors/guard.tkract cannot be moved there\nnothing was changed\n",
    });
    equal(fingerprint(root), before);
  });
});

void test("a rename prints the plan and a summary, changes the project, and the checker reports nothing", () => {
  withProject(PROJECT, (root) => {
    const result = rename(root);
    deepEqual(result, { exitCode: 0, stdout: `${DRY_RUN_TEXT.replace("dry run: nothing is written\n", "").replace("would change:", "done:")}`, stderr: "" });
    equal(read(root, "actors/knight.tkract"), OWNER);
    equal(read(root, "actors/guard.tkrwth"), WEATHER.replace('"actors/guard.tkract"', '"actors/knight.tkract"'));
    deepEqual(check([...FIELD_ARGS, root]), { exitCode: 0, stdout: "4 documents checked, 0 problems found\n", stderr: "" });
    // A second run of the same rename has nothing to rename.
    const again = rename(root);
    equal(again.exitCode, 1);
    equal(again.stderr, "tkr-native-rename: cannot rename: no document has the ID `actors/guard.tkract`, so there is nothing to rename\nnothing was changed\n");
  });
});

void test("several OLD=NEW pairs are one transaction: an owner and its plugin documents move together and the checker reports nothing", () => {
  withProject(PROJECT, (root) => {
    const result = runCli([
      ...FIELD_ARGS,
      root,
      "actors/guard.tkract=knights/guard.tkract",
      "actors/guard.tkrwth=knights/guard.tkrwth",
      "actors/guard.tkrrai=knights/guard.tkrrai",
    ]);
    equal(result.exitCode, 0, result.stderr);
    ok(result.stdout.endsWith("done: 3 documents moved, 3 documents edited (4 lines changed)\n"), result.stdout);
    deepEqual(listFiles(root), ["clips/walk.tkranm", "knights/guard.tkract", "knights/guard.tkrrai", "knights/guard.tkrwth", "legacy/walk.anm", "notes.txt"]);
    deepEqual(check([...FIELD_ARGS, root]), { exitCode: 0, stdout: "4 documents checked, 0 problems found\n", stderr: "" });
  });
});

void test("a case-only rename, Guard.tkract to guard.tkract, works from the command line", () => {
  withProject(
    {
      "Actors/Guard.tkract": "contract: actor\nversion: 1.0.0\nplugins: [Actors/Guard.tkrwth]\n",
      "Actors/Guard.tkrwth": "contract: actor-weather\nversion: 1.0.0\nowner: Actors/Guard.tkract\n",
    },
    (root) => {
      const result = runCli([...FIELD_ARGS, root, "Actors/Guard.tkract=Actors/guard.tkract"]);
      equal(result.exitCode, 0, result.stderr);
      deepEqual(listFiles(root), ["Actors/Guard.tkrwth", "Actors/guard.tkract"]);
      deepEqual(check([...FIELD_ARGS, root]), { exitCode: 0, stdout: "2 documents checked, 0 problems found\n", stderr: "" });
    },
  );
});

void test("a further reference field is kept up to date when it is named with --ref-field", () => {
  const scene = "contract: scene\nversion: 1.0.0\nboss: actors/guard.tkract # the boss\ncast:\n  - actors/guard.tkract\n";
  withProject({ ...PROJECT, "scenes/town.tkrscn": scene }, (root) => {
    const args = [...FIELD_ARGS, "--ext", ".tkrscn", "--ref-field", "boss", "--ref-field", "cast"];
    const result = runCli([...args, root, "actors/guard.tkract=actors/knight.tkract"]);
    equal(result.exitCode, 0, result.stderr);
    equal(read(root, "scenes/town.tkrscn"), scene.replaceAll("actors/guard.tkract", "actors/knight.tkract"));
    deepEqual(check([...FIELD_ARGS, "--ext", ".tkrscn", root]), { exitCode: 0, stdout: "5 documents checked, 0 problems found\n", stderr: "" });
  });
});

// ------------------------------------------------------------------ refusals, exit 1

void test("a refusal names every reason, writes nothing, and exits 1", () => {
  withProject(PROJECT, (root) => {
    const before = fingerprint(root);
    const result = runCli([...FIELD_ARGS, root, "actors/guard.tkract=actors/knight", "actors/ghost.tkrwth=actors/ghost2.tkrwth"]);
    deepEqual(result, {
      exitCode: 1,
      stdout: "",
      stderr: [
        "tkr-native-rename: cannot rename: the new ID `actors/knight` is not a valid ID: it has no extension, and an ID is a file name with its extension, such as `clips/walk.tkranm`",
        "tkr-native-rename: cannot rename: no document has the ID `actors/ghost.tkrwth`, so there is nothing to rename",
        "nothing was changed",
        "",
      ].join("\n"),
    });
    equal(fingerprint(root), before);
    const json = JSON.parse(runCli([...FIELD_ARGS, "--json", root, "actors/guard.tkract=actors/knight"]).stdout) as { schema: string; result: string; refusals: unknown[]; plan: unknown };
    deepEqual(json, {
      schema: RESULT_SCHEMA,
      result: "refused",
      refusals: [
        {
          code: "invalid-id",
          message: "the new ID `actors/knight` is not a valid ID: it has no extension, and an ID is a file name with its extension, such as `clips/walk.tkranm`",
        },
      ],
      plan: null,
    });
  });
});

void test("a project the checker does not find clean is not renamed: the reports come back as the reasons", () => {
  withProject({ ...PROJECT, "actors/ghost.tkrwth": "contract: actor-weather\nversion: 1.0.0\nowner: actors/nobody.tkract\n" }, (root) => {
    const before = fingerprint(root);
    const result = rename(root);
    equal(result.exitCode, 1);
    equal(
      result.stderr,
      "tkr-native-rename: cannot rename: the project is not clean before the rename: actors/ghost.tkrwth: plugin document `actors/ghost.tkrwth` names the owner `actors/nobody.tkract`, but no document has this ID.\nnothing was changed\n",
    );
    equal(fingerprint(root), before);
  });
});

void test("a new extension that is registered for another kind is refused with the reason", () => {
  withProject(PROJECT, (root) => {
    const before = fingerprint(root);
    deepEqual(runCli([...FIELD_ARGS, root, "actors/guard.tkract=actors/guard.tkranm"]).stderr.split("\n"), [
      "tkr-native-rename: cannot rename: renaming `actors/guard.tkract` to `actors/guard.tkranm` would give it the extension `.tkranm`, which is registered for the contract `animation-clip`, but its stamp names `actor`: changing the kind of a document is not a rename",
      "nothing was changed",
      "",
    ]);
    equal(fingerprint(root), before);
  });
});

// ------------------------------------------------------------------ usage, exit 2 and 3

void test("a usage mistake is an exit code and the help text, not a crash", () => {
  const help = runCli(["--help"]);
  deepEqual([help.exitCode, help.stdout, help.stderr], [0, HELP, ""]);
  ok(help.stdout.startsWith("tkr-native-rename: rename or move native documents without breaking a link\n\nIn plain words:"));
  const cases: readonly (readonly [string[], string])[] = [
    [["--plugins-field", "plugins", "folder", "a=b"], "--owner-field and --plugins-field are required: the link field names are not decided by the spec"],
    [[...FIELD_ARGS], "give the folder to rename in"],
    [[...FIELD_ARGS, "folder"], "give at least one rename, written OLD=NEW"],
    [[...FIELD_ARGS, "folder", "nothing"], '"nothing" is not a rename: write OLD=NEW'],
    [[...FIELD_ARGS, "folder", "=b"], '"=b" is not a rename: write OLD=NEW'],
    [[...FIELD_ARGS, "folder", "a="], '"a=" is not a rename: write OLD=NEW'],
    [[...FIELD_ARGS, "--bogus", "folder", "a=b"], "unknown option --bogus"],
    [[...FIELD_ARGS, "--ref-field"], "--ref-field needs a value"],
    [["--owner-field", "x", "--plugins-field", "x", "folder", "a=b"], "the owner and plugins link fields must have different names"],
    [[...FIELD_ARGS, "--ref-field", "owner", "folder", "a=b"], "`owner` is a link field already; name only further reference fields"],
    [[...FIELD_ARGS, "--ref-field", "version", "folder", "a=b"], "`version` is a stamp key, not a reference field"],
  ];
  for (const [argv, message] of cases) {
    const result = runCli(argv);
    equal(result.exitCode, 2, argv.join(" "));
    ok(result.stderr.startsWith(`tkr-native-rename: ${message}\n\n${HELP}`), `${argv.join(" ")}: ${result.stderr.split("\n")[0]}`);
  }
  const missing = runCli([...FIELD_ARGS, join(here, "does-not-exist"), "a.tkract=b.tkract"]);
  equal(missing.exitCode, 3);
  ok(missing.stderr.startsWith("tkr-native-rename: cannot read the folder"));
});

// ------------------------------------------------------------- failure, exit 4 and 5

void test("a failure in the middle is exit 4 and says every change was undone; the project is byte-identical", () => {
  withProject(PROJECT, (root) => {
    const before = fingerprint(root);
    const { fs } = faultyFs(8);
    const result = runCli([...FIELD_ARGS, root, "actors/guard.tkract=actors/knight.tkract"], { fs, token: "t" });
    equal(result.exitCode, 4);
    equal(result.stdout, "");
    ok(result.stderr.startsWith("tkr-native-rename: the rename failed: injected failure at operation 8: rename"));
    ok(result.stderr.endsWith("every change was undone: no file in the project has changed\n"));
    equal(fingerprint(root), before);
    const { fs: again } = faultyFs(8);
    const json = JSON.parse(runCli([...FIELD_ARGS, "--json", root, "actors/guard.tkract=actors/knight.tkract"], { fs: again, token: "t" }).stdout) as { result: string; error: string };
    equal(json.result, "restored");
    ok(json.error.startsWith("injected failure at operation 8"));
    equal(fingerprint(root), before);
  });
});

void test("a failure whose undo fails too is exit 5 and names the steps it could not undo", () => {
  withProject(PROJECT, (root) => {
    const { fs } = faultyFs(8, ["rename"]);
    const result = runCli([...FIELD_ARGS, root, "actors/guard.tkract=actors/knight.tkract"], { fs, token: "t" });
    equal(result.exitCode, 5);
    ok(result.stderr.includes("some changes could not be undone, so the project may be partly changed:"));
    ok(result.stderr.includes("  could not put actors/guard.tkract back: injected failure after the first: rename"));
    ok(result.stderr.includes(".NAME.tkr-rename-TOKEN-N.bak"));
  });
});

// ------------------------------------------------------------------- the entry point

void test("the command-line entry point exits 0 on a dry run and 1 on a refusal", () => {
  withProject(PROJECT, (root) => {
    const run = (...args: string[]) => spawnSync(process.execPath, [join(here, "..", "src", "cli.ts"), ...FIELD_ARGS, ...args, root, "actors/guard.tkract=actors/knight.tkract"], { encoding: "utf8" });
    const dry = run("--dry-run");
    deepEqual([dry.status, dry.stdout, dry.stderr], [0, DRY_RUN_TEXT, ""]);
    const applied = run();
    equal(applied.status, 0);
    const refused = run();
    equal(refused.status, 1);
    ok(refused.stderr.includes("no document has the ID `actors/guard.tkract`"));
  });
});
