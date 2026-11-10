import { deepEqual, equal, ok, throws } from "node:assert/strict";
import test from "node:test";
import {
  applyPlanToDocuments,
  checkDocuments,
  planRename,
  validateRenameConfig,
  verifyPlan,
  type DocumentInput,
  type RenameConfig,
  type RenamePair,
  type RenamePlan,
  type RenameRefusal,
  type Registry,
} from "../src/index.ts";

/**
 * The shipped registry holds only `.tkranm`. The link rules need an owner kind and two plugin
 * kinds, so these tests register placeholder kinds of their own, as the checker's tests do.
 * Nothing here is a real kind.
 */
const TEST_REGISTRY: Registry = [
  { extension: ".tkranm", contract: "animation-clip" },
  { extension: ".tkract", contract: "actor" },
  { extension: ".tkrwth", contract: "actor-weather" },
  { extension: ".tkrrai", contract: "actor-rain" },
  { extension: ".tkrscn", contract: "scene" },
];
const config: RenameConfig = { registry: TEST_REGISTRY, ownerField: "owner", pluginsField: "plugins" };

const doc = (path: string, ...lines: string[]): DocumentInput => ({ path, text: `${lines.join("\n")}\n` });

/** The fixture project: a clip, an owner, and two plugin documents linked both ways. Comments and odd spacing are deliberate. */
const CLIP = doc("clips/walk.tkranm", "contract: animation-clip", "version: 1.0.0-pre.1", "canvas: {width: 32, height: 32}", "delay: 0.15", "frames:", "  - image: tiles/village.tst14");
const OWNER = doc(
  "actors/guard.tkract",
  "# The guard. Keep this comment.",
  "contract: actor",
  "version: 1.0.0",
  "",
  "plugins:",
  "  - actors/guard.tkrwth   # weather rules",
  "  - actors/guard.tkrrai",
  'notes: "keep actors/guard.tkract out of this"   # not a reference field',
);
const WEATHER = doc("actors/guard.tkrwth", "contract: actor-weather", "version: 1.0.0", 'owner: "actors/guard.tkract"   # back-link', "rain: heavy");
/** CRLF line endings, a plain scalar and a trailing comment: only the reference may change. */
const RAIN: DocumentInput = {
  path: "actors/guard.tkrrai",
  text: ["contract: actor-rain", "version: 1.0.0", "owner: actors/guard.tkract  # back-link", "mm: 12", ""].join("\r\n"),
};
const PROJECT = [CLIP, OWNER, WEATHER, RAIN];

function text(input: DocumentInput): string {
  if (!("text" in input)) throw new Error("expected a text document");
  return input.text;
}

function plan(documents: readonly DocumentInput[], pairs: readonly RenamePair[], cfg: RenameConfig = config): RenamePlan {
  const result = planRename(documents, pairs, cfg);
  if (!result.ok) throw new Error(`expected a plan, got: ${result.refusals.map((refusal) => refusal.message).join(" | ")}`);
  return result.plan;
}

function refusals(documents: readonly DocumentInput[], pairs: readonly RenamePair[], cfg: RenameConfig = config): readonly RenameRefusal[] {
  const result = planRename(documents, pairs, cfg);
  if (result.ok) throw new Error("expected a refusal, got a plan");
  return result.refusals;
}

const clean = (documents: readonly DocumentInput[], cfg: RenameConfig = config) => deepEqual(checkDocuments(documents, cfg), []);

void test("the fixture project is checker-clean before any rename", () => {
  clean(PROJECT);
});

void test("renaming an owner moves it and rewrites only the lines that name it, in the plugin documents", () => {
  const result = plan(PROJECT, [{ from: "actors/guard.tkract", to: "actors/knight.tkract" }]);
  deepEqual(result.moves, [{ from: "actors/guard.tkract", to: "actors/knight.tkract" }]);
  deepEqual(
    result.edits.map((edit) => edit.path),
    ["actors/guard.tkrrai", "actors/guard.tkrwth"],
  );
  // The exact change: one line each. The quote style, the spacing before the trailing comment
  // and the CRLF line endings are as written; no other byte differs.
  deepEqual(result.edits[0]!.changes, [
    { line: 3, before: "owner: actors/guard.tkract  # back-link", after: "owner: actors/knight.tkract  # back-link" },
  ]);
  deepEqual(result.edits[1]!.changes, [
    { line: 3, before: 'owner: "actors/guard.tkract"   # back-link', after: 'owner: "actors/knight.tkract"   # back-link' },
  ]);
  equal(result.edits[0]!.after, text(RAIN).replace("owner: actors/guard.tkract  #", "owner: actors/knight.tkract  #"));
  equal(result.edits[1]!.after, text(WEATHER).replace('owner: "actors/guard.tkract"   #', 'owner: "actors/knight.tkract"   #'));
  // The owner's own text is untouched, and so is the clip: the `notes` text that holds the old ID is not a reference.
  ok(!result.edits.some((edit) => edit.path === "actors/guard.tkract" || edit.path === "clips/walk.tkranm"));
  clean(applyPlanToDocuments(PROJECT, result));
});

void test("renaming a plugin document rewrites the owner's plugins-list entry and keeps the list's comments", () => {
  const result = plan(PROJECT, [{ from: "actors/guard.tkrwth", to: "actors/weather/guard.tkrwth" }]);
  deepEqual(result.moves, [{ from: "actors/guard.tkrwth", to: "actors/weather/guard.tkrwth" }]);
  deepEqual(result.edits.map((edit) => edit.path), ["actors/guard.tkract"]);
  deepEqual(result.edits[0]!.changes, [
    { line: 6, before: "  - actors/guard.tkrwth   # weather rules", after: "  - actors/weather/guard.tkrwth   # weather rules" },
  ]);
  equal(result.edits[0]!.after, text(OWNER).replace("  - actors/guard.tkrwth   #", "  - actors/weather/guard.tkrwth   #"));
  clean(applyPlanToDocuments(PROJECT, result));
});

void test("a flow list changes one entry and keeps the rest of its line; two entries on one line are one changed line", () => {
  const owner = doc("actors/guard.tkract", "contract: actor", "version: 1.0.0", "plugins: [ actors/guard.tkrwth ,'actors/guard.tkrrai' ]   # both");
  const weather = doc("actors/guard.tkrwth", "contract: actor-weather", "version: 1.0.0", "owner: actors/guard.tkract");
  const rain = doc("actors/guard.tkrrai", "contract: actor-rain", "version: 1.0.0", "owner: actors/guard.tkract");
  const one = plan([owner, weather, rain], [{ from: "actors/guard.tkrrai", to: "actors/g.tkrrai" }]);
  deepEqual(one.edits[0]!.changes, [
    {
      line: 3,
      before: "plugins: [ actors/guard.tkrwth ,'actors/guard.tkrrai' ]   # both",
      after: "plugins: [ actors/guard.tkrwth ,'actors/g.tkrrai' ]   # both",
    },
  ]);
  const both = plan(
    [owner, weather, rain],
    [
      { from: "actors/guard.tkrwth", to: "actors/w.tkrwth" },
      { from: "actors/guard.tkrrai", to: "actors/r.tkrrai" },
    ],
  );
  deepEqual(both.edits[0]!.changes, [
    {
      line: 3,
      before: "plugins: [ actors/guard.tkrwth ,'actors/guard.tkrrai' ]   # both",
      after: "plugins: [ actors/w.tkrwth ,'actors/r.tkrrai' ]   # both",
    },
  ]);
  clean(applyPlanToDocuments([owner, weather, rain], both));
});

void test("an owner and its plugin documents renamed in one transaction leave a clean project", () => {
  const pairs: RenamePair[] = [
    { from: "actors/guard.tkract", to: "knights/guard.tkract" },
    { from: "actors/guard.tkrwth", to: "knights/guard.tkrwth" },
    { from: "actors/guard.tkrrai", to: "knights/guard.tkrrai" },
  ];
  const result = plan(PROJECT, pairs);
  deepEqual(result.moves.map((move) => `${move.from} -> ${move.to}`), [
    "actors/guard.tkract -> knights/guard.tkract",
    "actors/guard.tkrrai -> knights/guard.tkrrai",
    "actors/guard.tkrwth -> knights/guard.tkrwth",
  ]);
  deepEqual(result.edits.map((edit) => edit.path), ["actors/guard.tkract", "actors/guard.tkrrai", "actors/guard.tkrwth"]);
  const after = applyPlanToDocuments(PROJECT, result);
  clean(after);
  deepEqual(after.map((input) => input.path).sort(), ["clips/walk.tkranm", "knights/guard.tkract", "knights/guard.tkrrai", "knights/guard.tkrwth"]);
  equal(
    text(after.find((input) => input.path === "knights/guard.tkract")!),
    text(OWNER).replace("  - actors/guard.tkrwth   #", "  - knights/guard.tkrwth   #").replace("  - actors/guard.tkrrai", "  - knights/guard.tkrrai"),
  );
});

void test("two documents can swap names in one transaction: each reference follows its document", () => {
  const guard = doc("actors/guard.tkract", "contract: actor", "version: 1.0.0", "plugins: [actors/guard.tkrwth]");
  const guardWeather = doc("actors/guard.tkrwth", "contract: actor-weather", "version: 1.0.0", "owner: actors/guard.tkract");
  const knight = doc("actors/knight.tkract", "contract: actor", "version: 1.0.0", "plugins: [actors/knight.tkrwth]");
  const knightWeather = doc("actors/knight.tkrwth", "contract: actor-weather", "version: 1.0.0", "owner: actors/knight.tkract");
  const project = [guard, guardWeather, knight, knightWeather];
  const result = plan(project, [
    { from: "actors/guard.tkract", to: "actors/knight.tkract" },
    { from: "actors/knight.tkract", to: "actors/guard.tkract" },
  ]);
  const after = applyPlanToDocuments(project, result);
  clean(after);
  const byPath = new Map(after.map((input) => [input.path, text(input)]));
  // The document that was guard is now at knight's path, and the plugin document that named it names its new path.
  equal(byPath.get("actors/knight.tkract"), text(guard));
  equal(byPath.get("actors/guard.tkrwth"), text(guardWeather).replace("owner: actors/guard.tkract", "owner: actors/knight.tkract"));
  equal(byPath.get("actors/knight.tkrwth"), text(knightWeather).replace("owner: actors/knight.tkract", "owner: actors/guard.tkract"));
});

void test("a rename into the old ID of a document that is renamed away in the same transaction is allowed", () => {
  const a = doc("a.tkract", "contract: actor", "version: 1.0.0");
  const b = doc("b.tkract", "contract: actor", "version: 1.0.0");
  const result = plan([a, b], [
    { from: "b.tkract", to: "c.tkract" },
    { from: "a.tkract", to: "b.tkract" },
  ]);
  deepEqual(result.moves, [
    { from: "a.tkract", to: "b.tkract" },
    { from: "b.tkract", to: "c.tkract" },
  ]);
});

void test("a case-only rename is allowed and rewrites the references that spell the old case", () => {
  const owner = doc("Actors/Guard.tkract", "contract: actor", "version: 1.0.0", "plugins: [Actors/Guard.tkrwth]");
  const weather = doc("Actors/Guard.tkrwth", "contract: actor-weather", "version: 1.0.0", "owner: Actors/Guard.tkract");
  const result = plan([owner, weather], [{ from: "Actors/Guard.tkract", to: "actors/guard.tkract" }]);
  deepEqual(result.moves, [{ from: "Actors/Guard.tkract", to: "actors/guard.tkract" }]);
  deepEqual(result.edits.map((edit) => [edit.path, edit.changes]), [
    ["Actors/Guard.tkrwth", [{ line: 3, before: "owner: Actors/Guard.tkract", after: "owner: actors/guard.tkract" }]],
  ]);
  clean(applyPlanToDocuments([owner, weather], result));
  // The file name alone changing case is the same rule.
  const fileOnly = plan([owner, weather], [{ from: "Actors/Guard.tkract", to: "Actors/guard.tkract" }]);
  deepEqual(fileOnly.moves, [{ from: "Actors/Guard.tkract", to: "Actors/guard.tkract" }]);
  clean(applyPlanToDocuments([owner, weather], fileOnly));
});

void test("references match as the checker does: exact casing first, then folded; both are rewritten to the new ID", () => {
  const owner = doc("actors/guard.tkract", "contract: actor", "version: 1.0.0", "plugins: [ACTORS/GUARD.TKRWTH]");
  const weather = doc("actors/guard.tkrwth", "contract: actor-weather", "version: 1.0.0", "owner: Actors/Guard.TKRACT");
  clean([owner, weather]);
  const result = plan([owner, weather], [{ from: "actors/guard.tkract", to: "actors/knight.tkract" }]);
  deepEqual(result.edits.map((edit) => edit.changes), [[{ line: 3, before: "owner: Actors/Guard.TKRACT", after: "owner: actors/knight.tkract" }]]);
  // The old ID may be given in another case, too.
  deepEqual(plan([owner, weather], [{ from: "ACTORS/Guard.tkract", to: "actors/knight.tkract" }]).moves, [
    { from: "actors/guard.tkract", to: "actors/knight.tkract" },
  ]);
});

void test("further reference fields, named by the caller, are rewritten too: an ID, or a list of IDs", () => {
  const scene = doc(
    "scenes/town.tkrscn",
    "contract: scene",
    "version: 1.0.0",
    "boss: actors/guard.tkract # the boss",
    "cast:",
    "  - actors/guard.tkract",
    "  - clips/walk.tkranm",
    "other: actors/guard.tkract",
  );
  const project = [...PROJECT, scene];
  const withFields: RenameConfig = { ...config, referenceFields: ["boss", "cast"] };
  clean(project, withFields);
  const result = plan(project, [{ from: "actors/guard.tkract", to: "actors/knight.tkract" }], withFields);
  const edit = result.edits.find((candidate) => candidate.path === "scenes/town.tkrscn")!;
  deepEqual(edit.changes, [
    { line: 3, before: "boss: actors/guard.tkract # the boss", after: "boss: actors/knight.tkract # the boss" },
    { line: 5, before: "  - actors/guard.tkract", after: "  - actors/knight.tkract" },
  ]);
  // `other` is not named as a reference field, so it is not one.
  ok(edit.after.includes("other: actors/guard.tkract\n"));
});

void test("a reference that needs no change leaves its document out of the plan", () => {
  const result = plan(PROJECT, [{ from: "clips/walk.tkranm", to: "clips/stride.tkranm" }]);
  deepEqual(result, { moves: [{ from: "clips/walk.tkranm", to: "clips/stride.tkranm" }], edits: [] });
});

void test("the plan is a pure value: the inputs are not changed and the same inputs give the same plan", () => {
  const before = JSON.stringify(PROJECT);
  const first = plan(PROJECT, [{ from: "actors/guard.tkract", to: "actors/knight.tkract" }]);
  const second = plan([...PROJECT].reverse(), [{ from: "actors/guard.tkract", to: "actors/knight.tkract" }]);
  equal(JSON.stringify(PROJECT), before);
  deepEqual(first, second);
});

void test("a file that is not a native document is not read, whatever it holds", () => {
  const legacy: DocumentInput = { path: "actors/guard.anm", text: "owner: actors/guard.tkract\n" };
  const result = plan([...PROJECT, legacy], [{ from: "actors/guard.tkract", to: "actors/knight.tkract" }]);
  ok(!result.edits.some((edit) => edit.path === "actors/guard.anm"));
});

// ----------------------------------------------------------------- refusals

const message = (documents: readonly DocumentInput[], pairs: readonly RenamePair[], cfg: RenameConfig = config): string[] =>
  refusals(documents, pairs, cfg).map((refusal) => refusal.message);

void test("refusal: no rename given", () => {
  deepEqual(refusals(PROJECT, []), [{ code: "no-rename", message: "nothing to rename: give at least one old ID and new ID" }]);
});

void test("refusal: a new ID that is not a valid ID, with the reason", () => {
  const canonical = "an empty or `.` part is dropped from an ID, so it is written `actors/knight.tkract`";
  const noExtension = "it has no extension, and an ID is a file name with its extension, such as `clips/walk.tkranm`";
  const dotDot = "a `..` part is not resolved, so an ID cannot contain one";
  const cases: readonly (readonly [string, string])[] = [
    ["", "it is empty"],
    ["actors/kn\night.tkract", "it contains a control character, and an ID is one line"],
    ["actors\\knight.tkract", "`\\` is not a separator: the parts of an ID are separated by `/`"],
    ["../knight.tkract", dotDot],
    ["actors/../knight.tkract", dotDot],
    [" actors/knight.tkract", "it has a space at one end"],
    ["actors/knight.tkract ", "it has a space at one end"],
    ["./actors/knight.tkract", canonical],
    ["actors//knight.tkract", canonical],
    ["/actors/knight.tkract", canonical],
    ["actors/knight.tkract/", canonical],
    ["actors/knight", noExtension],
    ["actors/.tkract", noExtension],
  ];
  for (const [to, reason] of cases) {
    deepEqual(message(PROJECT, [{ from: "actors/guard.tkract", to }]), [`the new ID \`${to}\` is not a valid ID: ${reason}`], JSON.stringify(to));
  }
});

void test("refusal: an extension that marks no native document, whether registered kinds or not", () => {
  const list = "`.tkranm`, `.tkract`, `.tkrwth`, `.tkrrai` and `.tkrscn`";
  deepEqual(message(PROJECT, [{ from: "actors/guard.tkract", to: "actors/knight.tkrzzz" }]), [
    `the extension \`.tkrzzz\` of the new ID \`actors/knight.tkrzzz\` marks no native document: the document extensions are ${list}`,
  ]);
  deepEqual(message(PROJECT, [{ from: "actors/guard.tkract", to: "actors/knight.yaml" }]), [
    `the extension \`.yaml\` of the new ID \`actors/knight.yaml\` marks no native document: the document extensions are ${list}`,
  ]);
  // A classic legacy extension is not a native document extension either.
  deepEqual(message(PROJECT, [{ from: "actors/guard.tkract", to: "actors/knight.anm" }]), [
    `the extension \`.anm\` of the new ID \`actors/knight.anm\` marks no native document: the document extensions are ${list}`,
  ]);
  // With the document extensions overridden, those are the ones named.
  const placeholder: RenameConfig = { ...config, documentExtensions: [".tkract", ".tkrwth", ".tkrrai", ".tkranm"] };
  deepEqual(message(PROJECT, [{ from: "actors/guard.tkract", to: "actors/knight.yaml" }], placeholder), [
    "the extension `.yaml` of the new ID `actors/knight.yaml` marks no native document: the document extensions are `.tkract`, `.tkrwth`, `.tkrrai` and `.tkranm`",
  ]);
});

void test("refusal: an extension registered for another contract than the document's stamp, a kind change", () => {
  deepEqual(message(PROJECT, [{ from: "actors/guard.tkract", to: "actors/guard.tkranm" }]), [
    "renaming `actors/guard.tkract` to `actors/guard.tkranm` would give it the extension `.tkranm`, which is registered for the contract `animation-clip`, but its stamp names `actor`: changing the kind of a document is not a rename",
  ]);
  deepEqual(message(PROJECT, [{ from: "clips/walk.tkranm", to: "clips/walk.tkract" }]), [
    "renaming `clips/walk.tkranm` to `clips/walk.tkract` would give it the extension `.tkract`, which is registered for the contract `actor`, but its stamp names `animation-clip`: changing the kind of a document is not a rename",
  ]);
  // The same extension, whatever its case, is the same kind.
  deepEqual(plan(PROJECT, [{ from: "clips/walk.tkranm", to: "clips/walk.TKRANM" }]).moves, [{ from: "clips/walk.tkranm", to: "clips/walk.TKRANM" }]);
});

void test("refusal: a new ID that is, or folds to, the ID of another document", () => {
  deepEqual(message(PROJECT, [{ from: "actors/guard.tkract", to: "actors/guard.tkrwth" }]), [
    "renaming `actors/guard.tkract` to `actors/guard.tkrwth` would give it the extension `.tkrwth`, which is registered for the contract `actor-weather`, but its stamp names `actor`: changing the kind of a document is not a rename",
    "the new ID `actors/guard.tkrwth` is already the ID of the document `actors/guard.tkrwth`: a rename never replaces a document",
  ]);
  const twins = [doc("a/x.tkract", "contract: actor", "version: 1.0.0"), doc("a/y.tkract", "contract: actor", "version: 1.0.0")];
  deepEqual(message(twins, [{ from: "a/y.tkract", to: "a/x.tkract" }]), [
    "the new ID `a/x.tkract` is already the ID of the document `a/x.tkract`: a rename never replaces a document",
  ]);
  deepEqual(message(twins, [{ from: "a/y.tkract", to: "A/X.tkract" }]), [
    "the new ID `A/X.tkract` folds to the same ID as the document `a/x.tkract` (`a/x.tkract`): IDs are compared with only A to Z folded to a to z",
  ]);
  deepEqual(message(twins, [{ from: "a/y.tkract", to: "a/X.TKRACT" }]), [
    "the new ID `a/X.TKRACT` folds to the same ID as the document `a/x.tkract` (`a/x.tkract`): IDs are compared with only A to Z folded to a to z",
  ]);
  // A collision with a document that is renamed away in the same transaction is not one.
  deepEqual(plan(twins, [{ from: "a/y.tkract", to: "a/x.tkract" }, { from: "a/x.tkract", to: "a/z.tkract" }]).moves.length, 2);
  // Two new IDs against each other.
  deepEqual(
    message(twins, [
      { from: "a/x.tkract", to: "a/q.tkract" },
      { from: "a/y.tkract", to: "A/Q.tkract" },
    ]),
    ["the new IDs `a/q.tkract` and `A/Q.tkract` are the same ID: IDs are compared with only A to Z folded to a to z"],
  );
});

void test("refusal: an old ID that no document has", () => {
  deepEqual(message(PROJECT, [{ from: "actors/ghost.tkract", to: "actors/knight.tkract" }]), [
    "no document has the ID `actors/ghost.tkract`, so there is nothing to rename",
  ]);
  // A file that is not a native document has no ID here.
  deepEqual(message([...PROJECT, { path: "actors/old.anm", text: "x\n" }], [{ from: "actors/old.anm", to: "actors/new.tkract" }]), [
    "no document has the ID `actors/old.anm`, so there is nothing to rename",
  ]);
});

void test("refusal: the same document named twice, and a rename that changes nothing", () => {
  deepEqual(
    message(PROJECT, [
      { from: "actors/guard.tkract", to: "actors/a.tkract" },
      { from: "Actors/Guard.tkract", to: "actors/b.tkract" },
    ]),
    ["`actors/guard.tkract` and `Actors/Guard.tkract` are the same document (`actors/guard.tkract`): give each document one new ID"],
  );
  deepEqual(message(PROJECT, [{ from: "actors/guard.tkract", to: "actors/guard.tkract" }]), [
    "`actors/guard.tkract` already has the ID `actors/guard.tkract`: nothing to rename",
  ]);
});

void test("refusal: a project that is not checker-clean, with each problem named", () => {
  const broken = [
    ...PROJECT,
    doc("actors/ghost.tkrwth", "contract: actor-weather", "version: 1.0.0", "owner: actors/nobody.tkract"),
    doc("actors/bad.tkract", "contract: actor"),
  ];
  deepEqual(message(broken, [{ from: "actors/guard.tkract", to: "actors/knight.tkract" }]), [
    "the project is not clean before the rename: actors/bad.tkract: stamp key `version` is missing",
    "the project is not clean before the rename: actors/ghost.tkrwth: plugin document `actors/ghost.tkrwth` names the owner `actors/nobody.tkract`, but no document has this ID.",
  ]);
  // A link field the checker cannot read as an ID, or as a list of IDs, is one of those problems.
  const unreadable = [OWNER, doc("actors/guard.tkrwth", "contract: actor-weather", "version: 1.0.0", "owner: [a, b]"), RAIN];
  deepEqual(message(unreadable, [{ from: "actors/guard.tkract", to: "actors/knight.tkract" }]), [
    "the project is not clean before the rename: actors/guard.tkrwth: plugin document `actors/guard.tkrwth` names the owner `[a, b]`, but `owner` must be one ID. Fix the plugin document.",
  ]);
  // Every problem of the pairs themselves is named along with it.
  deepEqual(message(broken, [{ from: "actors/ghost.tkract", to: "knight" }]), [
    "the new ID `knight` is not a valid ID: it has no extension, and an ID is a file name with its extension, such as `clips/walk.tkranm`",
    "no document has the ID `actors/ghost.tkract`, so there is nothing to rename",
    "the project is not clean before the rename: actors/bad.tkract: stamp key `version` is missing",
    "the project is not clean before the rename: actors/ghost.tkrwth: plugin document `actors/ghost.tkrwth` names the owner `actors/nobody.tkract`, but no document has this ID.",
  ]);
});

void test("refusal: a reference field that cannot be read as an ID or a list of IDs, and one that cannot be edited in place", () => {
  const withFields: RenameConfig = { ...config, referenceFields: ["boss", "cast"] };
  const scene = (...lines: string[]): DocumentInput => doc("scenes/town.tkrscn", "contract: scene", "version: 1.0.0", ...lines);
  const pair = [{ from: "actors/guard.tkract", to: "actors/knight.tkract" }];
  deepEqual(message([...PROJECT, scene("boss: {name: guard}")], pair, withFields), [
    "scenes/town.tkrscn: the field `boss` is not an ID or a list of IDs (it must be an ID or a list of IDs; found {name: guard}), so the rename cannot tell which documents it names",
  ]);
  deepEqual(message([...PROJECT, scene("cast: [actors/guard.tkract, 7]")], pair, withFields), [
    "scenes/town.tkrscn: the field `cast` is not an ID or a list of IDs (it must be an ID or a list of IDs; found [actors/guard.tkract, 7]), so the rename cannot tell which documents it names",
  ]);
  deepEqual(message([...PROJECT, scene("boss: 12")], pair, withFields), [
    "scenes/town.tkrscn: the field `boss` is not an ID or a list of IDs (it must be an ID or a list of IDs; found 12), so the rename cannot tell which documents it names",
  ]);
  deepEqual(message([...PROJECT, scene("boss: a", "boss: b")], pair, withFields), [
    "scenes/town.tkrscn: the field `boss` is not an ID or a list of IDs (it appears 2 times; it must appear once), so the rename cannot tell which documents it names",
  ]);
  // A reference written over several lines cannot be spliced in place.
  const folded = doc("actors/guard.tkrwth", "contract: actor-weather", "version: 1.0.0", "owner: |-", "  actors/guard.tkract");
  clean([OWNER, folded, RAIN]);
  deepEqual(message([OWNER, folded, RAIN], pair), [
    "actors/guard.tkrwth: line 3: the reference `actors/guard.tkract` in `owner` is not written on one line, so it cannot be replaced in place",
  ]);
});

void test("a plan the checker would not find clean is refused, not offered: verifyPlan sees the missing back-link", () => {
  // A hand-made plan that moves the owner but forgets the back-links.
  const incomplete: RenamePlan = { moves: [{ from: "actors/guard.tkract", to: "actors/knight.tkract" }], edits: [] };
  const reports = verifyPlan(PROJECT, incomplete, config);
  deepEqual(reports.map((report) => report.class), ["plugin-no-owner", "plugin-no-owner"]);
  deepEqual(reports.map((report) => "path" in report && report.path), ["actors/guard.tkrrai", "actors/guard.tkrwth"]);
  deepEqual(verifyPlan(PROJECT, { moves: [], edits: [] }, config), []);
});

void test("a bad configuration is a RangeError, as in the checker, and the reference fields are checked", () => {
  throws(() => validateRenameConfig({ ...config, ownerField: "" }), RangeError);
  throws(() => validateRenameConfig({ ...config, referenceFields: [""] }), /must not be empty/);
  throws(() => validateRenameConfig({ ...config, referenceFields: ["version"] }), /stamp key/);
  throws(() => validateRenameConfig({ ...config, referenceFields: ["owner"] }), /link field already/);
  throws(() => validateRenameConfig({ ...config, referenceFields: ["a", "a"] }), /named twice/);
  throws(() => planRename(PROJECT, [{ from: "a", to: "b" }], { ...config, referenceFields: ["plugins"] }), RangeError);
});
