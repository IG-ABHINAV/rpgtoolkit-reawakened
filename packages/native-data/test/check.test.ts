import { deepEqual, throws } from "node:assert/strict";
import test from "node:test";
import { checkDocuments, formatReport, type CheckConfig, type CheckReport, type DocumentInput } from "../src/index.ts";

const config: CheckConfig = { documentExtensions: [".yaml", ".yml"], ownerField: "owner", pluginsField: "plugins" };

const doc = (path: string, contract: string, ...lines: string[]): DocumentInput => ({
  path,
  text: [`contract: ${contract}`, "version: 1.0.0", ...lines, ""].join("\n"),
});
const owner = (path: string, ...plugins: string[]) => doc(path, "actor", `plugins: [${plugins.join(", ")}]`);
const plugin = (path: string, ownerId: string) => doc(path, "actor-weather", `owner: ${ownerId}`);
const check = (...documents: DocumentInput[]): CheckReport[] => checkDocuments(documents, config);

void test("a linked owner and plugin document, even with IDs written in another case, report nothing", () => {
  deepEqual(check(owner("actors/guard.yaml", "actors/guard.weather"), plugin("actors/guard.weather.yaml", "actors/guard")), []);
  deepEqual(check(owner("actors/guard.yaml", "Actors/Guard.Weather"), plugin("actors/guard.weather.yaml", "ACTORS/GUARD")), []);
});

void test("a plugin document whose owner does not exist names the document and the owner ID", () => {
  const reports = check(plugin("actors/guard.weather.yaml", "actors/ghost"));
  deepEqual(reports, [
    {
      class: "plugin-no-owner",
      path: "actors/guard.weather.yaml",
      id: "actors/guard.weather",
      owner: "actors/ghost",
      reason: "no document has this ID",
      fix: null,
    },
  ]);
  deepEqual(formatReport(reports[0]!), "actors/guard.weather.yaml: plugin document `actors/guard.weather` names the owner `actors/ghost`, but no document has this ID.");
});

void test("an owner link that the plugin document does not return names the owner and the plugin document", () => {
  const withoutLink = check(owner("actors/guard.yaml", "actors/guard.weather"), doc("actors/guard.weather.yaml", "actor-weather"));
  deepEqual(withoutLink, [
    {
      class: "owner-no-back-link",
      owner: { path: "actors/guard.yaml", id: "actors/guard" },
      plugin: { named: "actors/guard.weather", path: "actors/guard.weather.yaml" },
      reason: "`actors/guard.weather.yaml` names no owner",
      fix: "plugin",
    },
  ]);
  const withoutDocument = check(owner("actors/guard.yaml", "actors/guard.weather"));
  deepEqual(withoutDocument, [
    {
      class: "owner-no-back-link",
      owner: { path: "actors/guard.yaml", id: "actors/guard" },
      plugin: { named: "actors/guard.weather", path: null },
      reason: "no document has this ID, so it cannot name the owner back",
      fix: "owner",
    },
  ]);
});

void test("a plugin document that names an owner which names a different plugin document is a mismatch, and the plugin side is to fix", () => {
  const reports = check(
    owner("actors/guard.yaml", "actors/guard.weather"),
    plugin("actors/guard.weather.yaml", "actors/guard"),
    plugin("actors/guard.rain.yaml", "actors/guard"),
  );
  deepEqual(reports, [
    {
      class: "mismatched-link",
      ends: [
        { role: "plugin", path: "actors/guard.rain.yaml", id: "actors/guard.rain", names: ["actors/guard"] },
        { role: "owner", path: "actors/guard.yaml", id: "actors/guard", names: ["actors/guard.weather"] },
      ],
      reason: "`actors/guard.rain.yaml` names the owner `actors/guard`, which names other plugin documents but not this one",
      fix: "plugin",
    },
  ]);
});

void test("an owner whose plugin document names a third document is one mismatch; the third side decides which end to fix", () => {
  // The knight's plugin document names the squire, and the squire does not name it back: nobody to blame.
  const unclear = check(owner("actors/knight.yaml", "actors/knight.weather"), plugin("actors/knight.weather.yaml", "actors/squire"), doc("actors/squire.yaml", "actor"));
  deepEqual(unclear.map((report) => [report.class, "fix" in report ? report.fix : undefined]), [["mismatched-link", null]]);
  // When the third document does name the plugin document, the first owner is the odd one out.
  const clear = check(
    owner("actors/knight.yaml", "actors/knight.weather"),
    plugin("actors/knight.weather.yaml", "actors/squire"),
    owner("actors/squire.yaml", "actors/knight.weather"),
  );
  deepEqual(clear.length, 1);
  deepEqual(clear[0], {
    class: "mismatched-link",
    ends: [
      { role: "owner", path: "actors/knight.yaml", id: "actors/knight", names: ["actors/knight.weather"] },
      { role: "plugin", path: "actors/knight.weather.yaml", id: "actors/knight.weather", names: ["actors/squire"] },
    ],
    reason: "`actors/knight.yaml` names `actors/knight.weather.yaml`, which names `actors/squire.yaml` as its owner instead",
    fix: "owner",
  });
});

void test("a one-way link from the plugin document to an owner that names nothing is a mismatch with nothing named on one end", () => {
  deepEqual(check(plugin("actors/guard.weather.yaml", "actors/guard"), doc("actors/guard.yaml", "actor")), [
    {
      class: "mismatched-link",
      ends: [
        { role: "plugin", path: "actors/guard.weather.yaml", id: "actors/guard.weather", names: ["actors/guard"] },
        { role: "owner", path: "actors/guard.yaml", id: "actors/guard", names: [] },
      ],
      reason: "`actors/guard.weather.yaml` names the owner `actors/guard`, which does not name it back",
      fix: null,
    },
  ]);
});

void test("a link field that cannot be read as an ID is reported where it is, with the text found", () => {
  deepEqual(check(doc("actors/guard.weather.yaml", "actor-weather", "owner: [a, b]")), [
    {
      class: "plugin-no-owner",
      path: "actors/guard.weather.yaml",
      id: "actors/guard.weather",
      owner: "[a, b]",
      reason: "`owner` must be one ID",
      fix: "plugin",
    },
  ]);
  deepEqual(check(doc("actors/guard.yaml", "actor", "plugins: actors/guard.weather")), [
    {
      class: "owner-no-back-link",
      owner: { path: "actors/guard.yaml", id: "actors/guard" },
      plugin: { named: "actors/guard.weather", path: null },
      reason: "`plugins` must be a list of IDs",
      fix: "owner",
    },
  ]);
});

void test("a duplicate ID or a fold collision is reported once and adds no link report", () => {
  const reports = check(
    owner("actors/guard.yaml", "actors/guard.weather"),
    plugin("actors/guard.weather.yaml", "actors/guard"),
    plugin("actors/guard.weather.yml", "actors/guard"),
  );
  deepEqual(reports, [{ class: "duplicate-id", id: "actors/guard.weather", paths: ["actors/guard.weather.yaml", "actors/guard.weather.yml"] }]);
});

void test("reports come in class order, then path order, whatever order the documents arrive in", () => {
  const reports = check(
    plugin("b.yaml", "ghost"),
    doc("a.yaml", "actor", "plugins: [nothing]"),
    { path: "z.yaml", text: "version: 1.0.0\n" },
    { path: "dup.yaml", text: "contract: a\nversion: 1.0.0\n" },
    { path: "dup.yml", text: "contract: a\nversion: 1.0.0\n" },
  );
  deepEqual(reports.map((report) => report.class), ["stamp", "duplicate-id", "plugin-no-owner", "owner-no-back-link"]);
});

void test("the configuration must name usable fields and extensions", () => {
  throws(() => checkDocuments([], { ...config, ownerField: "" }), RangeError);
  throws(() => checkDocuments([], { ...config, pluginsField: "owner" }), RangeError);
  throws(() => checkDocuments([], { ...config, ownerField: "version" }), RangeError);
  throws(() => checkDocuments([], { ...config, documentExtensions: [] }), RangeError);
});
