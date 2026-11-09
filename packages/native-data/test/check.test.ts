import { deepEqual, equal, throws } from "node:assert/strict";
import test from "node:test";
import {
  checkDocuments,
  documentId,
  formatReport,
  REPORT_CLASSES,
  type CheckConfig,
  type CheckReport,
  type DocumentInput,
  type Registry,
} from "../src/index.ts";

/**
 * The shipped registry holds only `.tkranm`. The link rules need an owner kind and two plugin
 * kinds, so these tests register placeholder kinds of their own. Nothing here is a real kind.
 */
const TEST_REGISTRY: Registry = [
  { extension: ".tkranm", contract: "animation-clip" },
  { extension: ".tkract", contract: "actor" },
  { extension: ".tkrwth", contract: "actor-weather" },
  { extension: ".tkrrai", contract: "actor-rain" },
];
const config: CheckConfig = { registry: TEST_REGISTRY, ownerField: "owner", pluginsField: "plugins" };
/** The shipped registry, for the rules that are about it. */
const shipped: CheckConfig = { ownerField: "owner", pluginsField: "plugins" };

const doc = (path: string, contract: string, ...lines: string[]): DocumentInput => ({
  path,
  text: [`contract: ${contract}`, "version: 1.0.0", ...lines, ""].join("\n"),
});
const owner = (path: string, ...plugins: string[]) => doc(path, "actor", `plugins: [${plugins.join(", ")}]`);
const plugin = (path: string, ownerId: string) => doc(path, "actor-weather", `owner: ${ownerId}`);
const rain = (path: string, ownerId: string) => doc(path, "actor-rain", `owner: ${ownerId}`);
const check = (...documents: DocumentInput[]): CheckReport[] => checkDocuments(documents, config);

void test("a linked owner and plugin document, even with IDs written in another case, report nothing", () => {
  deepEqual(check(owner("actors/guard.tkract", "actors/guard.tkrwth"), plugin("actors/guard.tkrwth", "actors/guard.tkract")), []);
  deepEqual(check(owner("actors/guard.tkract", "Actors/Guard.TKRWTH"), plugin("actors/guard.tkrwth", "ACTORS/GUARD.TKRACT")), []);
});

void test("a plugin document whose owner does not exist names the document and the owner ID", () => {
  const reports = check(plugin("actors/guard.tkrwth", "actors/ghost.tkract"));
  deepEqual(reports, [
    {
      class: "plugin-no-owner",
      path: "actors/guard.tkrwth",
      id: "actors/guard.tkrwth",
      owner: "actors/ghost.tkract",
      reason: "no document has this ID",
      fix: null,
    },
  ]);
  deepEqual(
    formatReport(reports[0]!),
    "actors/guard.tkrwth: plugin document `actors/guard.tkrwth` names the owner `actors/ghost.tkract`, but no document has this ID.",
  );
});

void test("an owner link that the plugin document does not return names the owner and the plugin document", () => {
  const withoutLink = check(owner("actors/guard.tkract", "actors/guard.tkrwth"), doc("actors/guard.tkrwth", "actor-weather"));
  deepEqual(withoutLink, [
    {
      class: "owner-no-back-link",
      owner: { path: "actors/guard.tkract", id: "actors/guard.tkract" },
      plugin: { named: "actors/guard.tkrwth", path: "actors/guard.tkrwth" },
      reason: "`actors/guard.tkrwth` names no owner",
      fix: "plugin",
    },
  ]);
  const withoutDocument = check(owner("actors/guard.tkract", "actors/guard.tkrwth"));
  deepEqual(withoutDocument, [
    {
      class: "owner-no-back-link",
      owner: { path: "actors/guard.tkract", id: "actors/guard.tkract" },
      plugin: { named: "actors/guard.tkrwth", path: null },
      reason: "no document has this ID, so it cannot name the owner back",
      fix: "owner",
    },
  ]);
});

void test("a plugin document that names an owner which names a different plugin document is a mismatch, and the plugin side is to fix", () => {
  const reports = check(
    owner("actors/guard.tkract", "actors/guard.tkrwth"),
    plugin("actors/guard.tkrwth", "actors/guard.tkract"),
    rain("actors/guard.tkrrai", "actors/guard.tkract"),
  );
  deepEqual(reports, [
    {
      class: "mismatched-link",
      ends: [
        { role: "plugin", path: "actors/guard.tkrrai", id: "actors/guard.tkrrai", names: ["actors/guard.tkract"] },
        { role: "owner", path: "actors/guard.tkract", id: "actors/guard.tkract", names: ["actors/guard.tkrwth"] },
      ],
      reason: "`actors/guard.tkrrai` names the owner `actors/guard.tkract`, which names other plugin documents but not this one",
      fix: "plugin",
    },
  ]);
});

void test("an owner whose plugin document names a third document is one mismatch; the third side decides which end to fix", () => {
  // The knight's plugin document names the squire, and the squire does not name it back: nobody to blame.
  const unclear = check(
    owner("actors/knight.tkract", "actors/knight.tkrwth"),
    plugin("actors/knight.tkrwth", "actors/squire.tkract"),
    doc("actors/squire.tkract", "actor"),
  );
  deepEqual(unclear.map((report) => [report.class, "fix" in report ? report.fix : undefined]), [["mismatched-link", null]]);
  // When the third document does name the plugin document, the first owner is the odd one out.
  const clear = check(
    owner("actors/knight.tkract", "actors/knight.tkrwth"),
    plugin("actors/knight.tkrwth", "actors/squire.tkract"),
    owner("actors/squire.tkract", "actors/knight.tkrwth"),
  );
  deepEqual(clear.length, 1);
  deepEqual(clear[0], {
    class: "mismatched-link",
    ends: [
      { role: "owner", path: "actors/knight.tkract", id: "actors/knight.tkract", names: ["actors/knight.tkrwth"] },
      { role: "plugin", path: "actors/knight.tkrwth", id: "actors/knight.tkrwth", names: ["actors/squire.tkract"] },
    ],
    reason: "`actors/knight.tkract` names `actors/knight.tkrwth`, which names `actors/squire.tkract` as its owner instead",
    fix: "owner",
  });
});

void test("a one-way link from the plugin document to an owner that names nothing is a mismatch with nothing named on one end", () => {
  deepEqual(check(plugin("actors/guard.tkrwth", "actors/guard.tkract"), doc("actors/guard.tkract", "actor")), [
    {
      class: "mismatched-link",
      ends: [
        { role: "plugin", path: "actors/guard.tkrwth", id: "actors/guard.tkrwth", names: ["actors/guard.tkract"] },
        { role: "owner", path: "actors/guard.tkract", id: "actors/guard.tkract", names: [] },
      ],
      reason: "`actors/guard.tkrwth` names the owner `actors/guard.tkract`, which does not name it back",
      fix: null,
    },
  ]);
});

void test("a link field that cannot be read as an ID is reported where it is, with the text found", () => {
  deepEqual(check(doc("actors/guard.tkrwth", "actor-weather", "owner: [a, b]")), [
    {
      class: "plugin-no-owner",
      path: "actors/guard.tkrwth",
      id: "actors/guard.tkrwth",
      owner: "[a, b]",
      reason: "`owner` must be one ID",
      fix: "plugin",
    },
  ]);
  deepEqual(check(doc("actors/guard.tkract", "actor", "plugins: actors/guard.tkrwth")), [
    {
      class: "owner-no-back-link",
      owner: { path: "actors/guard.tkract", id: "actors/guard.tkract" },
      plugin: { named: "actors/guard.tkrwth", path: null },
      reason: "`plugins` must be a list of IDs",
      fix: "owner",
    },
  ]);
});

void test("a duplicate ID is reported once and adds no link report", () => {
  const reports = check(
    owner("actors/guard.tkract", "actors/guard.tkrwth"),
    plugin("actors/guard.tkrwth", "actors/guard.tkract"),
    plugin("actors/guard.tkrwth", "actors/guard.tkract"),
  );
  deepEqual(reports, [{ class: "duplicate-id", id: "actors/guard.tkrwth", paths: ["actors/guard.tkrwth", "actors/guard.tkrwth"] }]);
});

void test("a clip and an actor with one name are two IDs, so they do not clash", () => {
  const reports = check(doc("guard.tkranm", "animation-clip"), doc("guard.tkract", "actor"));
  deepEqual(reports, []);
  equal(documentId("guard.tkranm") === documentId("guard.tkract"), false);
  // The same name with the same extension in two folders is two IDs as well.
  deepEqual(check(doc("a/guard.tkract", "actor"), doc("b/guard.tkract", "actor")), []);
});

void test("every class is reported, in the order of REPORT_CLASSES, whatever order the documents arrive in", () => {
  const documents: DocumentInput[] = [
    plugin("b.tkrwth", "ghost.tkract"),
    doc("a.tkract", "actor", "plugins: [nothing.tkrwth]"),
    { path: "z.tkranm", text: "version: 1.0.0\n" },
    doc("dup.tkranm", "animation-clip"),
    doc("dup.tkranm", "animation-clip"),
    doc("Fold.tkranm", "animation-clip"),
    doc("fold.tkranm", "animation-clip"),
    owner("g.tkract", "g.tkrwth"),
    plugin("g.tkrwth", "other.tkract"),
    doc("other.tkract", "actor"),
    doc("mismatch.tkranm", "actor"),
  ];
  const reports = check(...documents);
  deepEqual([...new Set(reports.map((report) => report.class))], [...REPORT_CLASSES]);
  deepEqual(
    reports.map((report) => report.class),
    [...reports.map((report) => report.class)].sort((left, right) => REPORT_CLASSES.indexOf(left) - REPORT_CLASSES.indexOf(right)),
  );
  deepEqual(check(...[...documents].reverse()), reports);
});

void test("the configuration must name usable fields, extensions and registry", () => {
  throws(() => checkDocuments([], { ...config, ownerField: "" }), RangeError);
  throws(() => checkDocuments([], { ...config, pluginsField: "owner" }), RangeError);
  throws(() => checkDocuments([], { ...config, ownerField: "version" }), RangeError);
  throws(() => checkDocuments([], { ...config, documentExtensions: [] }), RangeError);
  throws(() => checkDocuments([], { ...config, documentExtensions: [""] }), RangeError);
  throws(() => checkDocuments([], { ...config, registry: [{ extension: ".anm", contract: "animation" }] }), RangeError);
});

// ---------------------------------------------------------------- the ID includes the extension

void test("an ID is the path with its extension and case kept, and an empty or . part is dropped", () => {
  equal(documentId("clips/walk.tkranm"), "clips/walk.tkranm");
  equal(documentId("Clips/Walk.TKRANM"), "Clips/Walk.TKRANM");
  equal(documentId("clips//walk.tkranm"), "clips/walk.tkranm");
  equal(documentId("./clips/./walk.tkranm"), "clips/walk.tkranm");
  equal(documentId("walk.tkranm"), "walk.tkranm");
});

void test("a duplicate ID needs a path listed twice or two spellings of one path", () => {
  // A directory walk lists each path once, in one spelling, so it cannot produce either of these.
  const same = checkDocuments([doc("clips/walk.tkranm", "animation-clip"), doc("clips/walk.tkranm", "animation-clip")], shipped);
  deepEqual(same, [{ class: "duplicate-id", id: "clips/walk.tkranm", paths: ["clips/walk.tkranm", "clips/walk.tkranm"] }]);
  const spellings = checkDocuments(
    [doc("clips/walk.tkranm", "animation-clip"), doc("clips//walk.tkranm", "animation-clip"), doc("./clips/walk.tkranm", "animation-clip")],
    shipped,
  );
  deepEqual(spellings, [{ class: "duplicate-id", id: "clips/walk.tkranm", paths: ["./clips/walk.tkranm", "clips//walk.tkranm", "clips/walk.tkranm"] }]);
  // Spellings that differ in case as well are a fold collision, not a duplicate.
  deepEqual(checkDocuments([doc("clips//Walk.tkranm", "animation-clip"), doc("clips/walk.tkranm", "animation-clip")], shipped), [
    { class: "fold-collision", foldedId: "clips/walk.tkranm", paths: ["clips//Walk.tkranm", "clips/walk.tkranm"] },
  ]);
  // Same stem and different extensions are different IDs: nothing is reported.
  deepEqual(check(doc("clips/walk.tkranm", "animation-clip"), doc("clips/walk.tkract", "actor")), []);
});

void test("the extension folds like the rest of the ID: .TKRANM is .tkranm", () => {
  // As a document: a registered extension in capitals is still registered.
  deepEqual(checkDocuments([doc("clips/Walk.TKRANM", "animation-clip")], shipped), []);
  // As a contract check: the report names the extension as registered and the path as written.
  const reports = checkDocuments([doc("clips/Walk.TKRANM", "actor")], shipped);
  deepEqual(reports, [
    { class: "extension-contract-mismatch", path: "clips/Walk.TKRANM", extension: ".tkranm", registered: "animation-clip", stamp: "actor" },
  ]);
  // As an ID: the two spellings are two paths that fold to one ID.
  deepEqual(checkDocuments([doc("clips/walk.tkranm", "animation-clip"), doc("clips/Walk.TKRANM", "animation-clip")], shipped), [
    { class: "fold-collision", foldedId: "clips/walk.tkranm", paths: ["clips/Walk.TKRANM", "clips/walk.tkranm"] },
  ]);
  // Only A to Z fold: a full-width capital does not make an extension the registered one.
  deepEqual(checkDocuments([doc("clips/walk.ＴＫＲＡＮＭ", "actor")], shipped), []);
});

// ---------------------------------------------------------------- the extension and the stamp agree

void test("an extension and a stamp that name different contracts are reported with the path, the extension and both contracts", () => {
  const reports = checkDocuments([doc("clips/walk.tkranm", "actor")], shipped);
  deepEqual(reports, [
    { class: "extension-contract-mismatch", path: "clips/walk.tkranm", extension: ".tkranm", registered: "animation-clip", stamp: "actor" },
  ]);
  equal(
    formatReport(reports[0]!),
    "clips/walk.tkranm: the extension `.tkranm` is registered for the contract `animation-clip`, but the stamp names `actor`. Either the extension or the stamp is wrong; the checker cannot tell which.",
  );
  // The test registry holds more kinds, and each is held to its own contract.
  deepEqual(
    check(doc("a.tkract", "animation-clip"), doc("b.tkranm", "actor"), doc("c.tkract", "actor")).map((report) => [report.class, "path" in report ? report.path : ""]),
    [
      ["extension-contract-mismatch", "a.tkract"],
      ["extension-contract-mismatch", "b.tkranm"],
    ],
  );
});

void test("an extension is compared with the stamp only when the stamp names one contract as text", () => {
  const classes = (text: string): string[] => checkDocuments([{ path: "x.tkranm", text }], shipped).map((report) => report.class);
  deepEqual(classes("version: 1.0.0\n"), ["stamp"]);
  deepEqual(classes("contract: actor\nversion: 1.0.0\ncontract: animation-clip\n"), ["stamp"]);
  deepEqual(classes("contract: [actor]\nversion: 1.0.0\n"), ["stamp"]);
  deepEqual(classes('contract: ""\nversion: 1.0.0\n'), ["stamp"]);
  // A bad version is a stamp problem, and a wrong contract is one as well: both are said.
  deepEqual(classes("contract: actor\nversion: 1.0\n"), ["stamp", "extension-contract-mismatch"]);
});

void test("an extension the registry does not hold has no contract to disagree with", () => {
  deepEqual(checkDocuments([doc("notes.yaml", "anything")], { ...shipped, documentExtensions: [".yaml"] }), []);
});

// ---------------------------------------------------------------- legacy files are not native documents

void test("a legacy file beside a native document is neither read nor reported", () => {
  const reports = checkDocuments(
    [
      // Not UTF-8 and not YAML: if the checker opened it, it would be reported as unreadable.
      { path: "clips/walk.anm", unreadable: "the file is not valid UTF-8 text" },
      { path: "scenes/start.brd", text: "contract: [broken\n" },
      { path: "tiles/village.tst", text: "contract: actor\n" },
      { path: "clips/walk.tkranm", text: "contract: animation-clip\n" },
    ],
    shipped,
  );
  deepEqual(reports, [
    {
      class: "stamp",
      path: "clips/walk.tkranm",
      key: "version",
      problem: "missing",
      found: [],
      reason: "the document has no `version` key",
      line: null,
    },
  ]);
  // The legacy file and the native document have the same stem and nothing clashes.
  deepEqual(checkDocuments([{ path: "clips/walk.anm", unreadable: "binary" }, doc("clips/walk.tkranm", "animation-clip")], shipped), []);
});

void test("a file whose extension the registry does not hold is not a native document, a tkr extension included", () => {
  deepEqual(checkDocuments([{ path: "clips/walk.tkrxyz", text: "contract: [broken\n" }, { path: "walk", text: "x: [" }], shipped), []);
});

void test("documentExtensions replaces the registry's list of document extensions", () => {
  const only = { ...shipped, documentExtensions: [".YAML"] };
  deepEqual(checkDocuments([doc("a.yaml", "anything", "plugins: [b.yaml]"), doc("b.yaml", "anything")], only).map((report) => report.class), ["owner-no-back-link"]);
  // `.tkranm` is no longer a document extension, so a broken one is not read.
  deepEqual(checkDocuments([{ path: "a.tkranm", text: "x: [" }], only), []);
});
