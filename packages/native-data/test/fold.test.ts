import { deepEqual, equal } from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { checkDocuments, foldId, type CheckConfig, type DocumentInput } from "../src/index.ts";

/** `.tkract` is not in the shipped registry; naming it here makes these actor documents readable without a contract to agree with. */
const config: CheckConfig = { documentExtensions: [".tkract"], ownerField: "owner", pluginsField: "plugins" };

void test("folding changes only the letters A to Z", () => {
  equal(foldId("Actors/Guard"), "actors/guard");
  equal(foldId("ABCDEFGHIJKLMNOPQRSTUVWXYZ"), "abcdefghijklmnopqrstuvwxyz");
  equal(foldId("a-z_0-9/.@"), "a-z_0-9/.@");
});

void test("a non-ASCII letter compares as written, so it does not fold with its lowercase", () => {
  for (const letter of ["É", "Ä", "Σ", "İ", "ẞ", "Ａ"]) {
    // Each of these would change under `toLowerCase`, so this proves the fold does not use it.
    equal(letter.toLowerCase() === letter, false, `${letter} changes under toLowerCase`);
    equal(foldId(letter), letter, `${letter} must stay as written`);
    equal(foldId(`Guard${letter}`), `guard${letter}`);
  }
});

void test("Éclair and éclair are two IDs, while Guard and guard are one", () => {
  const documents: DocumentInput[] = [
    { path: "Éclair.tkract", text: "contract: actor\nversion: 1.0.0\n" },
    { path: "éclair.tkract", text: "contract: actor\nversion: 1.0.0\n" },
    { path: "Guard.tkract", text: "contract: actor\nversion: 1.0.0\n" },
    { path: "guard.tkract", text: "contract: actor\nversion: 1.0.0\n" },
  ];
  deepEqual(checkDocuments(documents, config), [
    { class: "fold-collision", foldedId: "guard.tkract", paths: ["Guard.tkract", "guard.tkract"] },
  ]);
});

/**
 * Two paths that fold to one ID cannot be authored as files on a case-insensitive
 * file system (git would keep only one), so this fixture lists the documents instead of
 * putting them on disk. The rule is on the paths, and the checker is handed no file system.
 */
void test("two paths that fold to one ID are reported with both paths and the folded ID", () => {
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/fold-collision.json", import.meta.url), "utf8")) as {
    readonly documents: readonly DocumentInput[];
  };
  deepEqual(checkDocuments(fixture.documents, config), [
    { class: "fold-collision", foldedId: "actors/guard.tkract", paths: ["Actors/Guard.tkract", "actors/guard.tkract"] },
  ]);
});
