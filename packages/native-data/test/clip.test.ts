import { deepEqual, equal, ok } from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  checkClip,
  checkDocuments,
  CLIP_CONTRACT,
  CLIP_VERSION,
  formatClipProblems,
  readClip,
  removeClipProperty,
  setClipProperty,
  writeClip,
  type Clip,
  type ClipProblem,
} from "../src/index.ts";

const examples = fileURLToPath(new URL("../../../docs/spec/examples/native/animation-clip/", import.meta.url));
const swordSwing = readFileSync(fileURLToPath(new URL("./fixtures/sword-swing.tkranm", import.meta.url)), "utf8");
const STAMP = "contract: animation-clip\nversion: 1.0.0-pre.1\n";
const BODY = "canvas:\n  width: 32\n  height: 32\ndelay: 0.5\nframes:\n  - image: a.png\n";

function refused(text: string): readonly ClipProblem[] {
  const result = readClip(text);
  if (result.ok) throw new Error("expected the reader to refuse the document");
  return result.problems;
}

function accepted(text: string): Clip {
  const result = readClip(text);
  if (!result.ok) throw new Error(`expected the reader to accept the document:\n${formatClipProblems(result.problems)}`);
  return result.clip;
}

/** The 0-based numbers of the lines that differ, for two texts of the same line count. */
function changedLines(before: string, after: string): number[] {
  const left = before.split("\n");
  const right = after.split("\n");
  equal(right.length, left.length, "the edit kept the number of lines");
  return left.flatMap((line, index) => (line === right[index] ? [] : [index]));
}

const comments = (text: string): string[] => text.split("\n").flatMap((line) => (line.includes("#") ? [line.slice(line.indexOf("#"))] : []));

// ---------------------------------------------------------------- the contract's examples

void test("the contract's valid examples read, and the checker finds the extension and stamp in agreement", () => {
  const files = readdirSync(`${examples}valid`).sort();
  deepEqual(files, ["sword-swing.tkranm", "torch-minimal.tkranm", "walk-south-imported.tkranm"]);
  const documents = files.map((file) => ({ path: `valid/${file}`, text: readFileSync(`${examples}valid/${file}`, "utf8") }));
  for (const document of documents) accepted(document.text);
  deepEqual(checkDocuments(documents, { ownerField: "owner", pluginsField: "plugins" }), []);
});

void test("a valid example reads into the typed model", () => {
  deepEqual(accepted(swordSwing), {
    contract: "animation-clip",
    version: "1.0.0-pre.1",
    canvas: { width: 64, height: 64 },
    delay: 0.08,
    colourKey: { r: 255, g: 0, b: 255 },
    frames: [
      { image: "bitmap/swing/swing1.png" },
      { image: "bitmap/swing/swing2.png" },
      { image: "bitmap/swing/swing3.png", sound: "media/sword-whoosh.wav" },
      { image: "bitmap/swing/swing4-flash.bmp", colourKey: { r: 0, g: 0, b: 0 } },
    ],
  });
  const imported = accepted(readFileSync(`${examples}valid/walk-south-imported.tkranm`, "utf8"));
  deepEqual(imported.tags, ["imported"]);
  deepEqual(imported.metadata, { source: "hero_walk_s.anm", notes: "Two-frame south walk from the example game; the 49 empty legacy slots are not listed." });
});

void test("the contract's invalid examples are refused, each for the defect its comment names", () => {
  const expected: Record<string, { kind: ClipProblem["kind"]; path: string; message: RegExp }[]> = {
    "frame-without-image.tkranm": [{ kind: "shape", path: "frames[1]", message: /`image` is required/ }],
    "malformed-version.tkranm": [{ kind: "stamp", path: "version", message: /stamp malformed: patch is missing/ }],
    "missing-stamp.tkranm": [
      { kind: "stamp", path: "contract", message: /stamp missing: the document has no `contract` key/ },
      { kind: "stamp", path: "version", message: /stamp missing: the document has no `version` key/ },
    ],
    "unknown-frame-key.tkranm": [{ kind: "shape", path: "frames[0].duration", message: /`duration` is not a key of a frame/ }],
    "unknown-key.tkranm": [{ kind: "shape", path: "loop", message: /`loop` is not a key of the animation clip contract/ }],
  };
  const files = readdirSync(`${examples}invalid`).sort();
  deepEqual(files, Object.keys(expected).sort());
  for (const file of files) {
    const problems = refused(readFileSync(`${examples}invalid/${file}`, "utf8"));
    deepEqual(
      problems.map((problem) => ({ kind: problem.kind, path: problem.path, message: problem.message })),
      expected[file]!.map((want) => ({ kind: want.kind, path: want.path, message: problems.find((problem) => want.message.test(problem.message))?.message })),
      file,
    );
  }
});

// ---------------------------------------------------------------- the stamp

void test("a document with no stamp is refused and nothing else is judged", () => {
  const problems = refused("canvas:\n  width: 0\ndelay: -1\n");
  deepEqual(
    problems.map((problem) => [problem.kind, problem.path]),
    [
      ["stamp", "contract"],
      ["stamp", "version"],
    ],
  );
  equal(refused("version: 1.0.0-pre.1\n" + BODY)[0]!.message, "stamp missing: the document has no `contract` key");
  equal(refused(BODY).length, 2);
  equal(refused("").length, 2);
});

void test("a malformed version, a repeated key and a stamp not first are refused with the reason", () => {
  const malformed = refused("contract: animation-clip\nversion: 1.0\n" + BODY)[0]!;
  deepEqual([malformed.kind, malformed.path, malformed.line], ["stamp", "version", 2]);
  ok(malformed.message.includes("patch is missing"), malformed.message);
  ok(refused("contract: animation-clip\nversion: v1.0.0-pre.1\n" + BODY)[0]!.message.includes("a prefix is not part of the version"));
  ok(refused("contract: animation-clip\nversion: 01.0.0-pre.1\n" + BODY)[0]!.message.includes("leading zero"));
  ok(refused("contract: animation-clip\nversion: 1.0.0-pre.1\nversion: 1.0.0-pre.1\n" + BODY)[0]!.message.includes("appears 2 times"));
  ok(refused("canvas:\n  width: 32\n  height: 32\n" + STAMP + "delay: 1\nframes:\n  - image: a.png\n")[0]!.message.includes("must be the first two keys"));
  equal(refused("- not\n- a mapping\n")[0]!.kind, "stamp");
  equal(refused("contract: [unclosed\n")[0]!.kind, "stamp");
});

void test("a well-formed stamp that is not this contract or version is refused by name", () => {
  const wrongContract = refused("contract: actor\nversion: 1.0.0-pre.1\n" + BODY);
  deepEqual(wrongContract.map((problem) => [problem.path, problem.message]), [["contract", "must be `animation-clip`"]]);
  ok(refused("contract: animation-clip\nversion: 1.1.0\n" + BODY)[0]!.message.includes("not a version this reader knows"));
  ok(refused("contract: animation-clip\nversion: 1.0.0-pre.2\n" + BODY)[0]!.message.includes("not a version this reader knows"));
  equal(accepted("contract: animation-clip\nversion: 1.0.0-pre.1+debug.4\n" + BODY).version, "1.0.0-pre.1+debug.4");
});

// ---------------------------------------------------------------- the rules

void test("each rule of the contract page refuses what it says", () => {
  const cases: [string, string, string][] = [
    ["canvas width 0", "canvas:\n  width: 0\n  height: 32\ndelay: 0.5\nframes:\n  - image: a.png\n", "canvas.width"],
    ["canvas height fractional", "canvas:\n  width: 32\n  height: 1.5\ndelay: 0.5\nframes:\n  - image: a.png\n", "canvas.height"],
    ["negative delay", "canvas:\n  width: 32\n  height: 32\ndelay: -0.1\nframes:\n  - image: a.png\n", "delay"],
    ["infinite delay", "canvas:\n  width: 32\n  height: 32\ndelay: .inf\nframes:\n  - image: a.png\n", "delay"],
    ["delay as text", "canvas:\n  width: 32\n  height: 32\ndelay: '0.5'\nframes:\n  - image: a.png\n", "delay"],
    ["no canvas", "delay: 0.5\nframes:\n  - image: a.png\n", "(document)"],
    ["empty frames", "canvas:\n  width: 32\n  height: 32\ndelay: 0.5\nframes: []\n", "frames"],
    ["null frames", "canvas:\n  width: 32\n  height: 32\ndelay: 0.5\nframes:\n", "frames"],
    ["null image", BODY.replace("a.png", "null"), "frames[0].image"],
    ["empty image", BODY.replace("a.png", "''"), "frames[0].image"],
    ["image with a space at the end", BODY.replace("a.png", "'a.png '"), "frames[0].image"],
    ["image as a number", BODY.replace("a.png", "7"), "frames[0].image"],
    ["empty sound", BODY + "    sound: ''\n", "frames[0].sound"],
    ["null sound", BODY + "    sound: null\n", "frames[0].sound"],
    ["colour part 256", BODY + "    colourKey: {r: 256, g: 0, b: 0}\n", "frames[0].colourKey.r"],
    ["colour missing a part", "colourKey: {r: 1, g: 2}\n" + BODY, "colourKey"],
    ["colour with alpha", "colourKey: {r: 1, g: 2, b: 3, a: 4}\n" + BODY, "colourKey.a"],
    ["mistyped colorKey", "colorKey: {r: 1, g: 2, b: 3}\n" + BODY, "colorKey"],
    ["null colour key", "colourKey: null\n" + BODY, "colourKey"],
    ["empty tag", "tags: ['']\n" + BODY, "tags[0]"],
    ["null tag", "tags: [~]\n" + BODY, "tags[0]"],
    ["tags as text", "tags: imported\n" + BODY, "tags"],
    ["null metadata", "metadata:\n" + BODY, "metadata"],
    ["metadata as a list", "metadata: [a]\n" + BODY, "metadata"],
    ["a repeated key", "delay: 1\n" + BODY, "(document)"],
  ];
  for (const [name, body, path] of cases) {
    const problems = refused(STAMP + body);
    ok(
      problems.some((problem) => problem.path === path),
      `${name}: expected a problem at ${path}, got ${formatClipProblems(problems)}`,
    );
  }
});

void test("what the contract allows is read: delay 0, free tags and metadata, nulls inside metadata, capitals and spaces in a name", () => {
  const clip = accepted(`${STAMP}tags: [a, b]\nmetadata:\n  anything: [1, {x: null}]\n  n: 0\n${BODY.replace("delay: 0.5", "delay: 0").replace("a.png", "'Bitmap/My Pic.PNG'")}`);
  equal(clip.delay, 0);
  deepEqual(clip.tags, ["a", "b"]);
  deepEqual(clip.metadata, { anything: [1, { x: null }], n: 0 });
  equal(clip.frames[0]!.image, "Bitmap/My Pic.PNG");
});

void test("a problem names its line", () => {
  const problems = refused(`${STAMP}${BODY.replace("delay: 0.5", "delay: -1")}`);
  deepEqual(
    problems.map((problem) => [problem.path, problem.line]),
    [["delay", 6]],
  );
});

// ---------------------------------------------------------------- writing

const rich: Clip = {
  contract: CLIP_CONTRACT,
  version: CLIP_VERSION,
  tags: ["imported", "two words"],
  metadata: { source: "hero_walk_s.anm", nested: { list: [1, "a", null, true], text: "a: b # c" } },
  canvas: { width: 64, height: 32 },
  delay: 0.0666666666666667,
  colourKey: { r: 255, g: 0, b: 255 },
  frames: [{ image: "bitmap/a.png" }, { image: "tiles/village.tst14", sound: "media/x.wav", colourKey: { r: 0, g: 0, b: 0 } }],
};

void test("writing is deterministic and the text is the provisional layout", () => {
  const first = writeClip(rich);
  ok(first.ok);
  if (!first.ok) return;
  deepEqual(writeClip(rich), first);
  equal(
    first.text,
    [
      "contract: animation-clip",
      "version: 1.0.0-pre.1",
      "tags: [imported, two words]",
      "metadata:",
      "  source: hero_walk_s.anm",
      "  nested:",
      "    list:",
      "      - 1",
      "      - a",
      "      - null",
      "      - true",
      "    text: \"a: b # c\"",
      "canvas:",
      "  width: 64",
      "  height: 32",
      "delay: 0.0666666666666667",
      "colourKey: {r: 255, g: 0, b: 255}",
      "frames:",
      "  - image: bitmap/a.png",
      "  - image: tiles/village.tst14",
      "    sound: media/x.wav",
      "    colourKey: {r: 0, g: 0, b: 0}",
      "",
    ].join("\n"),
  );
});

void test("a written clip reads back equal, including awkward text and numbers", () => {
  const awkward = ["true", "123", "1e3", "null", "a: b", "x #y", "- dash", "é ü", "Capital/Path.PNG", "'quoted'", '"double"', "{brace}", "[bracket]", "a\tb"];
  const delays = [0, 1, 0.1, 0.15, 1e-7, 123456789.123, 0.0666666666666667, 1e21];
  for (const delay of delays) {
    const clip: Clip = { ...rich, delay, frames: awkward.map((image) => ({ image, sound: image })), tags: awkward, metadata: { keys: awkward, "a: b": 1 } };
    const written = writeClip(clip);
    if (!written.ok) throw new Error(formatClipProblems(written.problems));
    deepEqual(accepted(written.text), clip, `delay ${delay}`);
    // A second write of what was read is the same text.
    const again = writeClip(accepted(written.text));
    deepEqual(again, written);
  }
  const minimal: Clip = { contract: CLIP_CONTRACT, version: "1.0.0-pre.1+build.7", canvas: { width: 1, height: 1 }, delay: 0, frames: [{ image: "a" }] };
  const text = writeClip(minimal);
  ok(text.ok);
  if (text.ok) deepEqual(accepted(text.text), minimal);
});

void test("the contract's own examples read, write and read again to the same clip", () => {
  for (const file of readdirSync(`${examples}valid`)) {
    const clip = accepted(readFileSync(`${examples}valid/${file}`, "utf8"));
    const written = writeClip(clip);
    if (!written.ok) throw new Error(formatClipProblems(written.problems));
    deepEqual(accepted(written.text), clip, file);
  }
});

void test("a model the contract refuses is not written", () => {
  const bad: unknown[] = [
    { ...rich, delay: -1 },
    { ...rich, delay: Number.NaN },
    { ...rich, frames: [] },
    { ...rich, frames: [{ image: "" }] },
    { ...rich, frames: [{ image: "a.png", sound: undefined }] },
    { ...rich, frames: [{ image: "a.png", sound: null }] },
    { ...rich, canvas: { width: 0, height: 1 } },
    { ...rich, tags: [""] },
    { ...rich, metadata: { when: new Date(0) } },
    { ...rich, metadata: { f: undefined } },
    { ...rich, contract: "actor" },
    { ...rich, version: "1.0" },
    { ...rich, extra: 1 },
    null,
  ];
  for (const model of bad) {
    equal(writeClip(model as Clip).ok, false, JSON.stringify(model));
    ok(checkClip(model).length > 0);
  }
});

// ---------------------------------------------------------------- editing in place

void test("setting one property of an authored document changes exactly one line and keeps every comment", () => {
  const edits: [string, readonly (string | number)[], string | number, number, string][] = [
    ["delay", ["delay"], 0.1, 6, "delay: 0.1"],
    ["a frame's sound", ["frames", 2, "sound"], "media/x.wav", 12, "    sound: media/x.wav   # plays once, when this frame appears"],
    ["a canvas size", ["canvas", "width"], 128, 4, "  width: 128"],
    ["a frame's image", ["frames", 0, "image"], "bitmap/swing/other.png", 9, "  - image: bitmap/swing/other.png"],
  ];
  for (const [name, path, value, line, expected] of edits) {
    const result = setClipProperty(swordSwing, path, value);
    if (!result.ok) throw new Error(`${name}: ${formatClipProblems(result.problems)}`);
    deepEqual(changedLines(swordSwing, result.text), [line], name);
    equal(result.text.split("\n")[line], expected, name);
    deepEqual(comments(result.text), comments(swordSwing), name);
    equal(readClip(result.text).ok, true);
  }
  ok(comments(swordSwing).length === 4);
});

void test("setting a colour sets its three parts in place, and the spacing before a comment is kept", () => {
  const result = setClipProperty(swordSwing, ["colourKey"], { r: 1, g: 2, b: 3 });
  if (!result.ok) throw new Error(formatClipProblems(result.problems));
  deepEqual(changedLines(swordSwing, result.text), [7]);
  equal(result.text.split("\n")[7], "colourKey: {r: 1, g: 2, b: 3}   # magenta is see-through in every frame that names no key of its own");
});

void test("setting a property that is absent adds exactly one line after the entry before it in the contract's order", () => {
  const withSound = setClipProperty(swordSwing, ["frames", 0, "sound"], "media/y.wav");
  if (!withSound.ok) throw new Error(formatClipProblems(withSound.problems));
  const lines = swordSwing.split("\n");
  deepEqual(withSound.text.split("\n"), [...lines.slice(0, 10), "    sound: media/y.wav", ...lines.slice(10)]);

  const withKey = setClipProperty(swordSwing, ["frames", 2, "colourKey"], { r: 9, g: 8, b: 7 });
  if (!withKey.ok) throw new Error(formatClipProblems(withKey.problems));
  deepEqual(withKey.text.split("\n"), [...lines.slice(0, 13), "    colourKey: {r: 9, g: 8, b: 7}", ...lines.slice(13)]);
});

void test("an absent clip colour key goes between the delay and the frames; the metadata keeps its place", () => {
  const text = `${STAMP}metadata:\n  source: a.anm  # where from\n${BODY}`;
  const result = setClipProperty(text, ["colourKey"], { r: 1, g: 1, b: 1 });
  if (!result.ok) throw new Error(formatClipProblems(result.problems));
  equal(result.text, text.replace("delay: 0.5\n", "delay: 0.5\ncolourKey: {r: 1, g: 1, b: 1}\n"));
  const source = setClipProperty(text, ["metadata", "source"], "b.anm");
  if (!source.ok) throw new Error(formatClipProblems(source.problems));
  equal(source.text, text.replace("a.anm  #", "b.anm  #"));
  const added = setClipProperty(text, ["metadata", "note"], "hi");
  if (!added.ok) throw new Error(formatClipProblems(added.problems));
  equal(added.text, text.replace("# where from\n", "# where from\n  note: hi\n"));
});

void test("a flow mapping, CRLF line ends, a missing final newline and a quoted value are all edited in place", () => {
  const flow = `${STAMP}canvas: {width: 32, height: 32}\ndelay: 0.5\nframes:\n  - {image: a.png}\n  - {image: b.png, sound: s.wav}\n`;
  const sound = setClipProperty(flow, ["frames", 0, "sound"], "x.wav");
  if (!sound.ok) throw new Error(formatClipProblems(sound.problems));
  equal(sound.text, flow.replace("{image: a.png}", "{image: a.png, sound: x.wav}"));
  const gone = removeClipProperty(flow, ["frames", 1, "sound"]);
  if (!gone.ok) throw new Error(formatClipProblems(gone.problems));
  equal(gone.text, flow.replace("{image: b.png, sound: s.wav}", "{image: b.png}"));

  const crlf = swordSwing.replaceAll("\n", "\r\n");
  const added = setClipProperty(crlf, ["frames", 0, "sound"], "media/y.wav");
  if (!added.ok) throw new Error(formatClipProblems(added.problems));
  equal(added.text, crlf.replace("swing1.png\r\n", "swing1.png\r\n    sound: media/y.wav\r\n"));
  const setCrlf = setClipProperty(crlf, ["delay"], 2);
  if (!setCrlf.ok) throw new Error(formatClipProblems(setCrlf.problems));
  equal(setCrlf.text, crlf.replace("delay: 0.08", "delay: 2"));

  const noNewline = swordSwing.trimEnd();
  const last = setClipProperty(noNewline, ["frames", 3, "sound"], "z.wav");
  if (!last.ok) throw new Error(formatClipProblems(last.problems));
  equal(last.text, noNewline.replace("swing4-flash.bmp\n", "swing4-flash.bmp\n    sound: z.wav\n"));
  const tail = `${STAMP}${BODY}`.trimEnd();
  const atEnd = setClipProperty(tail, ["frames", 0, "sound"], "z.wav");
  if (!atEnd.ok) throw new Error(formatClipProblems(atEnd.problems));
  equal(atEnd.text, `${tail}\n    sound: z.wav`);

  const quoted = `${STAMP}canvas:\n  width: 32\n  height: 32\ndelay: 0.5\nframes:\n  - image: "a.png"   # keep\n`;
  const renamed = setClipProperty(quoted, ["frames", 0, "image"], "b.png");
  if (!renamed.ok) throw new Error(formatClipProblems(renamed.problems));
  equal(renamed.text, quoted.replace('"a.png"', '"b.png"'));
});

void test("removing an optional property removes its line, comment included, and nothing else", () => {
  const sound = removeClipProperty(swordSwing, ["frames", 2, "sound"]);
  if (!sound.ok) throw new Error(formatClipProblems(sound.problems));
  const lines = swordSwing.split("\n");
  deepEqual(sound.text.split("\n"), [...lines.slice(0, 12), ...lines.slice(13)]);
  const colour = removeClipProperty(swordSwing, ["colourKey"]);
  if (!colour.ok) throw new Error(formatClipProblems(colour.problems));
  deepEqual(colour.text.split("\n"), [...lines.slice(0, 7), ...lines.slice(8)]);
});

void test("an edit the contract refuses is not made, and a document the reader refuses is not edited", () => {
  const negative = setClipProperty(swordSwing, ["delay"], -1);
  ok(!negative.ok);
  if (!negative.ok) ok(negative.problems[0]!.message.includes("the edit would leave a document the reader refuses"));
  for (const [path, value] of [
    [["delay"], Number.NaN],
    [["canvas", "width"], 0],
    [["frames", 0, "image"], ""],
    [["frames", 0, "image"], "a "],
    [["frames", 9, "sound"], "x.wav"],
    [["nope"], 1],
    [["frames", 0, "loop"], 1],
    [["tags"], "x"],
  ] as const) {
    const result = setClipProperty(swordSwing, path, value);
    equal(result.ok, false, JSON.stringify(path));
  }
  equal(removeClipProperty(swordSwing, ["delay"]).ok, false);
  equal(removeClipProperty(swordSwing, ["frames", 0, "image"]).ok, false);
  equal(removeClipProperty(swordSwing, ["frames", 0, "sound"]).ok, false);

  const noStamp = setClipProperty(swordSwing.replace("contract: animation-clip\n", ""), ["delay"], 1);
  ok(!noStamp.ok);
  if (!noStamp.ok) equal(noStamp.problems[0]!.kind, "stamp");
});
