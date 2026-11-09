import { deepEqual, equal, throws } from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { classifyExtension, extensionOf, lookupExtension, REGISTRY, validateRegistry, type Registry } from "../src/index.ts";

const spec = fileURLToPath(new URL("../../../docs/spec/formats/native-contracts.md", import.meta.url));

void test("the shipped registry holds only the animation clip, and passes its own rules", () => {
  deepEqual(REGISTRY, [{ extension: ".tkranm", contract: "animation-clip" }]);
  validateRegistry(REGISTRY);
});

void test("no registered extension is a classic legacy one, so a legacy file and a native document never share an extension", () => {
  const legacy = [".anm", ".brd", ".tem", ".itm", ".ene", ".tst"];
  for (const entry of REGISTRY) {
    equal(legacy.includes(entry.extension), false, entry.extension);
    equal(entry.extension.startsWith(".tkr"), true, entry.extension);
  }
});

void test("a registry needs unique extensions and unique contracts, each extension in the .tkr + three letters form", () => {
  const entry = { extension: ".tkrwth", contract: "weather" };
  validateRegistry([entry, { extension: ".tkrrai", contract: "rain" }]);
  throws(() => validateRegistry([entry, { extension: ".tkrwth", contract: "other" }]), /registered twice/);
  throws(() => validateRegistry([entry, { extension: ".tkrrai", contract: "weather" }]), /more than one extension/);
  throws(() => validateRegistry([{ extension: ".tkrwth", contract: " " }]), /no contract name/);
  for (const bad of [".anm", ".yaml", "tkrwth", ".tkr", ".tkrwt", ".tkrweth", ".TKRWTH", ".tkrw1h", ".tkr-th", ".tkrwth "]) {
    throws(() => validateRegistry([{ extension: bad, contract: "weather" }]), RangeError, bad);
  }
});

void test("an extension is found with only A to Z folded", () => {
  deepEqual(lookupExtension(".tkranm"), REGISTRY[0]);
  deepEqual(lookupExtension(".TKRANM"), REGISTRY[0]);
  deepEqual(lookupExtension(".TkrAnm"), REGISTRY[0]);
  equal(lookupExtension(".anm"), undefined);
  equal(lookupExtension("tkranm"), undefined);
  // Full-width capitals are not A to Z, so they do not fold into the registered spelling.
  equal(lookupExtension(".ＴＫＲＡＮＭ"), undefined);
  const other: Registry = [{ extension: ".tkrwth", contract: "weather" }];
  deepEqual(lookupExtension(".TKRWTH", other), other[0]);
  equal(lookupExtension(".tkranm", other), undefined);
});

void test("the extension of a path is the text from the last dot of its last part", () => {
  equal(extensionOf("clips/walk.tkranm"), ".tkranm");
  equal(extensionOf("walk.tkranm"), ".tkranm");
  equal(extensionOf("a.b/walk.tkranm"), ".tkranm");
  equal(extensionOf("clips/guard.weather.tkranm"), ".tkranm");
  equal(extensionOf("Clips/Walk.TKRANM"), ".TKRANM");
  equal(extensionOf("a.b/walk"), null);
  equal(extensionOf("clips/.tkranm"), null);
  equal(extensionOf(".tkranm"), null);
  equal(extensionOf("clips/walk"), null);
  equal(extensionOf(""), null);
});

void test("an extension is a registered native one or another, and every classic legacy extension is another", () => {
  equal(classifyExtension(".tkranm"), "native-registered");
  equal(classifyExtension(".TKRANM"), "native-registered");
  for (const legacy of [".anm", ".brd", ".tem", ".itm", ".ene", ".tst", ".ANM"]) equal(classifyExtension(legacy), "other", legacy);
  // Not registered is not native, a tkr spelling included: the registry decides.
  equal(classifyExtension(".tkrxyz"), "other");
  equal(classifyExtension(".yaml"), "other");
  equal(classifyExtension(null), "other");
  equal(classifyExtension(extensionOf("clips/walk.anm")), "other");
  equal(classifyExtension(extensionOf("clips/walk.tkranm")), "native-registered");
});

void test("the registry table in the spec is the registry", () => {
  const text = readFileSync(spec, "utf8");
  const start = text.indexOf("\n## File names\n");
  if (start < 0) throw new Error("the spec has no File names section");
  const next = text.indexOf("\n## ", start + 1);
  const section = text.slice(start, next < 0 ? undefined : next);
  const rows = [...section.matchAll(/^\| `(\.[^`]+)` \| `([^`]+)` \|/gm)].map((row) => ({ extension: row[1]!, contract: row[2]! }));
  deepEqual(rows, REGISTRY);
});
