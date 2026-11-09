import { deepEqual, equal, ok } from "node:assert/strict";
import { chmodSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { runCli as check } from "@tk-reawakened/native-data-cli";
import { applyPlan, checkApplicable } from "../src/index.ts";
import { CLIP, CONFIG, faultyFs, fingerprint, FIELD_ARGS, listFiles, OWNER, planOf, PROJECT, RAIN, read, WEATHER, withProject } from "./helpers.ts";

/** The real checker over a folder: clean means exit 0 and no problem. */
function checkerSays(root: string, documents: number): void {
  const result = check([...FIELD_ARGS, root]);
  deepEqual([result.exitCode, result.stdout], [0, `${documents} documents checked, 0 problems found\n`]);
}

const OWNER_TO_KNIGHT = [{ from: "actors/guard.tkract", to: "actors/knight.tkract" }];
const weatherAfter = WEATHER.replace('owner: "actors/guard.tkract"', 'owner: "actors/knight.tkract"');
const rainAfter = RAIN.replace("owner: actors/guard.tkract", "owner: actors/knight.tkract");

void test("a rename lands on disk: the owner moves as the same file, each plugin document changes by one line, and the checker reports nothing", () => {
  withProject(PROJECT, (root) => {
    const ownerStat = statSync(join(root, "actors/guard.tkract"));
    const { documents, plan } = planOf(root, OWNER_TO_KNIGHT);
    deepEqual(applyPlan(root, documents, plan), { status: "applied", moved: 1, edited: 2, leftovers: [] });
    // No temporary name and no set-aside original is left behind; files that are not native documents are untouched.
    deepEqual(listFiles(root), [
      "actors/guard.tkrrai",
      "actors/guard.tkrwth",
      "actors/knight.tkract",
      "clips/walk.tkranm",
      "legacy/walk.anm",
      "notes.txt",
    ]);
    equal(read(root, "actors/knight.tkract"), OWNER);
    equal(read(root, "actors/guard.tkrwth"), weatherAfter);
    equal(read(root, "actors/guard.tkrrai"), rainAfter);
    equal(read(root, "clips/walk.tkranm"), CLIP);
    equal(read(root, "notes.txt"), PROJECT["notes.txt"]);
    equal(read(root, "legacy/walk.anm"), PROJECT["legacy/walk.anm"]);
    // A moved document that needs no edit is its own file, renamed: same bytes, same modification time.
    const moved = statSync(join(root, "actors/knight.tkract"));
    deepEqual([moved.ino, moved.mtimeMs, moved.mode], [ownerStat.ino, ownerStat.mtimeMs, ownerStat.mode]);
    checkerSays(root, 4);
  });
});

void test("an owner and its plugin documents move together into new folders in one transaction, and the checker reports nothing", () => {
  withProject(PROJECT, (root) => {
    const { documents, plan } = planOf(root, [
      { from: "actors/guard.tkract", to: "knights/guard.tkract" },
      { from: "actors/guard.tkrwth", to: "knights/deep/guard.tkrwth" },
      { from: "actors/guard.tkrrai", to: "knights/guard.tkrrai" },
    ]);
    deepEqual(applyPlan(root, documents, plan), { status: "applied", moved: 3, edited: 3, leftovers: [] });
    deepEqual(listFiles(root), [
      "clips/walk.tkranm",
      "knights/deep/guard.tkrwth",
      "knights/guard.tkract",
      "knights/guard.tkrrai",
      "legacy/walk.anm",
      "notes.txt",
    ]);
    equal(
      read(root, "knights/guard.tkract"),
      OWNER.replace("  - actors/guard.tkrwth   #", "  - knights/deep/guard.tkrwth   #").replace("  - actors/guard.tkrrai", "  - knights/guard.tkrrai"),
    );
    equal(read(root, "knights/deep/guard.tkrwth"), WEATHER.replace('"actors/guard.tkract"', '"knights/guard.tkract"'));
    equal(read(root, "knights/guard.tkrrai"), RAIN.replace("owner: actors/guard.tkract", "owner: knights/guard.tkract"));
    // A folder a move leaves empty is left in place.
    deepEqual(readdirSync(join(root, "actors")), []);
    checkerSays(root, 4);
  });
});

const CASE_PROJECT = {
  "Actors/Guard.tkract": "contract: actor\nversion: 1.0.0\nplugins: [Actors/Guard.tkrwth]\n",
  "Actors/Guard.tkrwth": "contract: actor-weather\nversion: 1.0.0\nowner: Actors/Guard.tkract\n",
};

void test("a case-only rename works on any file system: the document is renamed through a free name, and the links follow", () => {
  withProject(CASE_PROJECT, (root) => {
    const { documents, plan } = planOf(root, [{ from: "Actors/Guard.tkract", to: "Actors/guard.tkract" }]);
    deepEqual(applyPlan(root, documents, plan), { status: "applied", moved: 1, edited: 1, leftovers: [] });
    // The directory listing shows the new case, not the old one.
    deepEqual(readdirSync(join(root, "Actors")).sort(), ["Guard.tkrwth", "guard.tkract"]);
    equal(read(root, "Actors/Guard.tkrwth"), "contract: actor-weather\nversion: 1.0.0\nowner: Actors/guard.tkract\n");
    checkerSays(root, 2);
  });
});

void test("a rename that changes the case of a folder is judged on the new ID, whether the file system folds case or not", () => {
  withProject(CASE_PROJECT, (root) => {
    const { documents, plan } = planOf(root, [{ from: "Actors/Guard.tkract", to: "actors/guard.tkract" }]);
    deepEqual(applyPlan(root, documents, plan), { status: "applied", moved: 1, edited: 1, leftovers: [] });
    equal(read(root, "Actors/Guard.tkrwth"), "contract: actor-weather\nversion: 1.0.0\nowner: actors/guard.tkract\n");
    checkerSays(root, 2);
  });
});

void test("two documents swap names in one transaction: each name is free before the other takes it", () => {
  const guard = "contract: actor\nversion: 1.0.0\nplugins: [actors/guard.tkrwth]\n";
  const guardWeather = "contract: actor-weather\nversion: 1.0.0\nowner: actors/guard.tkract\n";
  const knight = "contract: actor\nversion: 1.0.0\nplugins: [actors/knight.tkrwth]\n";
  const knightWeather = "contract: actor-weather\nversion: 1.0.0\nowner: actors/knight.tkract\n";
  withProject(
    { "actors/guard.tkract": guard, "actors/guard.tkrwth": guardWeather, "actors/knight.tkract": knight, "actors/knight.tkrwth": knightWeather },
    (root) => {
      const { documents, plan } = planOf(root, [
        { from: "actors/guard.tkract", to: "actors/knight.tkract" },
        { from: "actors/knight.tkract", to: "actors/guard.tkract" },
      ]);
      deepEqual(applyPlan(root, documents, plan), { status: "applied", moved: 2, edited: 2, leftovers: [] });
      equal(read(root, "actors/knight.tkract"), guard);
      equal(read(root, "actors/guard.tkract"), knight);
      equal(read(root, "actors/guard.tkrwth"), guardWeather.replace("owner: actors/guard.tkract", "owner: actors/knight.tkract"));
      equal(read(root, "actors/knight.tkrwth"), knightWeather.replace("owner: actors/knight.tkract", "owner: actors/guard.tkract"));
      checkerSays(root, 4);
    },
  );
});

void test("an edited document keeps its byte order mark, its CRLF line endings and its permission bits", () => {
  const bom = Uint8Array.from([0xef, 0xbb, 0xbf]);
  const bytes = Buffer.concat([bom, Buffer.from(RAIN, "utf8")]);
  withProject({ ...PROJECT, "actors/guard.tkrrai": bytes }, (root) => {
    chmodSync(join(root, "actors/guard.tkrrai"), 0o640);
    const { documents, plan } = planOf(root, OWNER_TO_KNIGHT);
    deepEqual(applyPlan(root, documents, plan), { status: "applied", moved: 1, edited: 2, leftovers: [] });
    deepEqual(readFileSync(join(root, "actors/guard.tkrrai")), Buffer.concat([bom, Buffer.from(rainAfter, "utf8")]));
    if (process.platform !== "win32") equal(statSync(join(root, "actors/guard.tkrrai")).mode & 0o777, 0o640);
    checkerSays(root, 4);
  });
});

// ------------------------------------------------- a failure leaves nothing changed

const TWO_FOLDERS = [
  { from: "actors/guard.tkract", to: "knights/guard.tkract" },
  { from: "actors/guard.tkrwth", to: "knights/deep/guard.tkrwth" },
];

void test("the apply is folders, staged files, then renames, then cleanup: the operations in order", () => {
  withProject(PROJECT, (root) => {
    const { documents, plan } = planOf(root, TWO_FOLDERS);
    const { fs, operations } = faultyFs(null);
    deepEqual(applyPlan(root, documents, plan, { fs, token: "t" }), { status: "applied", moved: 2, edited: 3, leftovers: [] });
    deepEqual(
      operations.map((operation) => operation.kind),
      [
        "makeFolder", "makeFolder", // knights, knights/deep
        "create", "create", "create", // the new text of the three edited documents, next to their places
        "rename", "rename", "rename", // every original steps aside
        "rename", "rename", "rename", // every new file takes its place
        "remove", "remove", "remove", // the set-aside originals of the edited documents go
      ],
    );
  });
});

void test("any operation of the apply can fail, and a failure before the cleanup leaves every file, name and folder byte-identical", () => {
  const counting = withProject(PROJECT, (root) => {
    const { documents, plan } = planOf(root, TWO_FOLDERS);
    const probe = faultyFs(null);
    applyPlan(root, documents, plan, { fs: probe.fs, token: "t" });
    return probe.operations;
  });
  equal(counting.length, 14);
  for (let failAt = 1; failAt <= counting.length; failAt += 1) {
    withProject(PROJECT, (root) => {
      const before = fingerprint(root);
      const { documents, plan } = planOf(root, TWO_FOLDERS);
      const { fs } = faultyFs(failAt);
      const outcome = applyPlan(root, documents, plan, { fs, token: "t" });
      const label = `failing operation ${failAt} (${counting[failAt - 1]!.kind})`;
      if (counting[failAt - 1]!.kind === "remove") {
        // The cleanup comes after the last rename: the rename is complete, and the one set-aside original left is reported.
        equal(outcome.status, "applied", label);
        ok(outcome.status === "applied" && outcome.leftovers.length === 1 && outcome.leftovers[0]!.includes(".tkr-rename-t-"), label);
        checkerSays(root, 4);
      } else {
        equal(outcome.status, "restored", label);
        ok(outcome.status === "restored" && outcome.error.startsWith(`injected failure at operation ${failAt}:`), label);
        equal(fingerprint(root), before, label);
      }
    });
  }
});

void test("a real file system failure in the middle of staging is undone: a name already taken leaves the project byte-identical", () => {
  withProject(PROJECT, (root) => {
    // Staging the second edited document needs this name, and a folder is already there: a real EEXIST, not an injected one.
    mkdirSync(join(root, "actors/.guard.tkrrai.tkr-rename-t-1.new"));
    const before = fingerprint(root);
    const { documents, plan } = planOf(root, TWO_FOLDERS);
    const outcome = applyPlan(root, documents, plan, { token: "t" });
    equal(outcome.status, "restored");
    ok(outcome.status === "restored" && outcome.error.includes("EEXIST"), JSON.stringify(outcome));
    equal(fingerprint(root), before);
    ok(!listFiles(root).some((file) => file.includes("knights")));
  });
});

void test("when the undo fails too, the result says which steps it could not undo", () => {
  withProject(PROJECT, (root) => {
    const { documents, plan } = planOf(root, TWO_FOLDERS);
    // The second new file takes its place (operation 10), and from then on every rename fails, the undo's included.
    const { fs } = faultyFs(10, ["rename"]);
    const outcome = applyPlan(root, documents, plan, { fs, token: "t" });
    equal(outcome.status, "unrestored");
    if (outcome.status !== "unrestored") throw new Error("expected unrestored");
    ok(outcome.error.startsWith("injected failure at operation 10:"));
    ok(outcome.problems.some((problem) => problem.startsWith("could not put actors/guard.tkract back: injected failure after the first: rename")));
    ok(outcome.problems.some((problem) => problem.startsWith("could not take knights/guard.tkract out again: injected failure after the first: rename")));
    // What it could undo it did: the staged files that were never placed are gone.
    ok(!listFiles(root).some((file) => file.endsWith(".new") && file.includes("guard.tkrrai")));
  });
});

// ------------------------------------------------------------ refused, nothing written

void test("a file that changed after the plan was made is refused before anything is written", () => {
  withProject(PROJECT, (root) => {
    const { documents, plan } = planOf(root, OWNER_TO_KNIGHT);
    writeFileSync(join(root, "actors/guard.tkrwth"), `${WEATHER}added: later\n`);
    const before = fingerprint(root);
    deepEqual(applyPlan(root, documents, plan), {
      status: "refused",
      reasons: ["actors/guard.tkrwth changed after it was read, so the rename was not applied"],
    });
    equal(fingerprint(root), before);
  });
});

void test("a file that is gone after the plan was made is refused before anything is written", () => {
  withProject(PROJECT, (root) => {
    const { documents, plan } = planOf(root, OWNER_TO_KNIGHT);
    rmSync(join(root, "actors/guard.tkract"));
    const before = fingerprint(root);
    deepEqual(applyPlan(root, documents, plan), { status: "refused", reasons: ["actors/guard.tkract is no longer a file, so the rename was not applied"] });
    equal(fingerprint(root), before);
  });
});

void test("a target that exists on disk, a folder in the way and a name next to a source are refused before anything is written", () => {
  withProject(PROJECT, (root) => {
    const { documents, plan } = planOf(root, OWNER_TO_KNIGHT);
    // Not a native document, so the planner cannot know it: a folder already has the new name.
    mkdirSync(join(root, "actors/knight.tkract"));
    const before = fingerprint(root);
    deepEqual(applyPlan(root, documents, plan), {
      status: "refused",
      reasons: ["actors/knight.tkract already exists, so actors/guard.tkract cannot be moved there"],
    });
    equal(fingerprint(root), before);
    deepEqual(checkApplicable(root, documents, plan), ["actors/knight.tkract already exists, so actors/guard.tkract cannot be moved there"]);
  });
  withProject(PROJECT, (root) => {
    // A file where a folder is needed.
    const { documents, plan } = planOf(root, [{ from: "actors/guard.tkract", to: "notes.txt/knight.tkract" }]);
    deepEqual(applyPlan(root, documents, plan), {
      status: "refused",
      reasons: ["notes.txt is not a folder, so actors/guard.tkract cannot be moved to notes.txt/knight.tkract"],
    });
  });
  withProject(PROJECT, (root) => {
    // The name the set-aside original would take is taken.
    const { documents, plan } = planOf(root, OWNER_TO_KNIGHT);
    writeFileSync(join(root, "actors/.guard.tkract.tkr-rename-t-0.bak"), "x");
    deepEqual(applyPlan(root, documents, plan, { token: "t" }), {
      status: "refused",
      reasons: [".guard.tkract.tkr-rename-t-0.bak already exists next to actors/guard.tkract, so the rename was not applied"],
    });
  });
});

void test("a plan that moves nothing and edits nothing applies as a no-op", () => {
  withProject(PROJECT, (root) => {
    const before = fingerprint(root);
    const { documents } = planOf(root, OWNER_TO_KNIGHT);
    deepEqual(applyPlan(root, documents, { moves: [], edits: [] }), { status: "applied", moved: 0, edited: 0, leftovers: [] });
    equal(fingerprint(root), before);
  });
});
