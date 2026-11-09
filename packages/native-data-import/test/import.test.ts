import { deepEqual, equal, ok } from "node:assert/strict";
import test from "node:test";
import { BinaryWriter, ANIMATION_MAGIC, BinaryReader, readAnimation, type Animation, type AnimationFrame } from "@tk-reawakened/core";
import { formatClipProblems, readClip, writeClip, type Clip } from "@tk-reawakened/native-data";
import { importAnimation, imageId, soundId } from "../src/index.ts";
import { corpus } from "./corpus.ts";
import { clipEqualsOracle, oracleOf } from "./oracle.ts";

const WHITE = { r: 255, g: 255, b: 255 };
const slot = (image: string, sound = "", transparent = WHITE): AnimationFrame => ({ image, transparent, sound });
const EMPTY = slot("");

/** A legacy animation of 51 slots: the given frames first, the rest empty, as the old editor wrote them. */
function legacy(frames: readonly AnimationFrame[], extra: Partial<Animation> = {}): Animation {
  return {
    magic: ANIMATION_MAGIC,
    major: 2,
    minor: 3,
    width: 32,
    height: 32,
    frames: [...frames, ...Array.from({ length: 51 - frames.length }, () => EMPTY)],
    delay: 0.15,
    residue: new Uint8Array(0),
    ...extra,
  };
}

function imported(animation: Animation, name = "x.anm"): Clip {
  const result = importAnimation(animation, name);
  if (!result.ok) throw new Error(formatClipProblems(result.problems));
  return result.clip;
}

/** Write the clip, read the text back, and return what the reader makes of it. */
function viaText(clip: Clip): Clip {
  const written = writeClip(clip);
  if (!written.ok) throw new Error(formatClipProblems(written.problems));
  const read = readClip(written.text);
  if (!read.ok) throw new Error(formatClipProblems(read.problems));
  return read.clip;
}

// ---------------------------------------------------------------- the corpus

void test("every decoded legacy .anm imports, writes and reads to a clip equal to the 1:1 oracle by the four-point equality", (t) => {
  const files = corpus();
  const byOrigin = (origin: string): number => files.filter((file) => file.origin === origin).length;
  ok(byOrigin("docs/spec/examples") >= 9, "the example games' animations are always there");
  let zeroDelay = 0;
  let text = 0;
  for (const file of files) {
    const oracle = oracleOf(file.animation);
    equal(oracle.slots.length, 51, file.path);
    const clip = viaText(imported(file.animation, file.name));
    deepEqual(clipEqualsOracle(clip, oracle), [], file.path);
    if (file.animation.delay === 0) zeroDelay += 1;
    if (file.animation.minor === 0) text += 1;
  }
  ok(zeroDelay > 0, "the corpus holds a delay-0 file");
  ok(text > 0, "the corpus holds a Toolkit 2 text-form file");
  t.diagnostic(`${files.length} files (docs/spec/examples ${byOrigin("docs/spec/examples")}, fixtures/legacy ${byOrigin("fixtures/legacy")}), ${zeroDelay} with delay 0, ${text} text form`);
});

void test("the import of the example game's south walk is the contract page's own example", () => {
  const file = corpus().find((candidate) => candidate.name === "hero_walk_s.anm");
  if (file === undefined) throw new Error("hero_walk_s.anm is part of docs/spec/examples");
  const clip = imported(file.animation, file.name);
  deepEqual(clip.frames, [{ image: "tiles/village.tst14" }, { image: "tiles/village.tst15" }]);
  deepEqual(clip.colourKey, { r: 255, g: 255, b: 255 });
  deepEqual(clip.tags, ["imported"]);
  deepEqual(clip.metadata, { source: "hero_walk_s.anm" });
  equal(clip.delay, 0.15);
});

void test("importing twice gives the same clip and the same text, with nothing that changes per run", () => {
  for (const file of corpus().slice(0, 5)) {
    const first = writeClip(imported(file.animation, file.name));
    const second = writeClip(imported(file.animation, file.name));
    deepEqual(first, second);
    if (first.ok) ok(!/\d{4}-\d{2}-\d{2}|T\d\d:\d\d/.test(first.text.replace(/delay: .*/, "")), "no date or time in the text");
  }
});

// ---------------------------------------------------------------- the field accounting

void test("empty slots are dropped, order is kept, and a hole in the middle is closed", () => {
  const animation = legacy([slot("a.bmp"), EMPTY, slot("b.bmp"), EMPTY, EMPTY, slot("c.bmp")]);
  const result = importAnimation(animation, "x.anm");
  if (!result.ok) throw new Error(formatClipProblems(result.problems));
  deepEqual(
    result.clip.frames.map((frame) => frame.image),
    ["bitmap/a.bmp", "bitmap/b.bmp", "bitmap/c.bmp"],
  );
  deepEqual(result.report, { droppedSlots: 48, droppedSounds: [] });
});

void test("names fold to lowercase IDs, a backslash becomes a slash, and the case of a sound is folded too", () => {
  const clip = imported(legacy([slot("Hero\\Walk.BMP", "Sounds\\Step.WAV"), slot("Village.TST14"), slot("Tiles\\Old.GPH"), slot("Set.ISO3"), slot("House.TBM"), slot("É.png")]));
  deepEqual(clip.frames, [
    { image: "bitmap/hero/walk.bmp", sound: "media/sounds/step.wav" },
    { image: "tiles/village.tst14" },
    { image: "tiles/tiles/old.gph" },
    { image: "tiles/set.iso3" },
    { image: "bitmap/house.tbm" },
    { image: "bitmap/É.png" },
  ]);
  equal(imageId("A.tst1"), "tiles/a.tst1");
  equal(imageId("a.png"), "bitmap/a.png");
  equal(soundId("A.WAV"), "media/a.wav");
});

void test("an empty sound is an absent key, and a sound on a dropped slot is reported, not kept", () => {
  const animation = legacy([slot("a.bmp", "boom.wav"), slot("b.bmp"), { ...EMPTY, sound: "lost.wav" }]);
  const result = importAnimation(animation, "x.anm");
  if (!result.ok) throw new Error(formatClipProblems(result.problems));
  deepEqual(result.clip.frames, [{ image: "bitmap/a.bmp", sound: "media/boom.wav" }, { image: "bitmap/b.bmp" }]);
  ok(!Object.hasOwn(result.clip.frames[1]!, "sound"));
  deepEqual(result.report, { droppedSlots: 49, droppedSounds: [{ slot: 2, sound: "lost.wav" }] });
});

void test("one colour key is written once for the clip when every kept frame shares it, and on every frame when they differ", () => {
  const same = imported(legacy([slot("a.bmp", "", { r: 1, g: 2, b: 3 }), slot("b.bmp", "", { r: 1, g: 2, b: 3 }), { ...EMPTY, transparent: { r: 9, g: 9, b: 9 } }]));
  deepEqual(same.colourKey, { r: 1, g: 2, b: 3 });
  ok(same.frames.every((frame) => !Object.hasOwn(frame, "colourKey")));

  const animation = legacy([slot("a.bmp", "", { r: 1, g: 2, b: 3 }), slot("b.bmp", "", WHITE), slot("c.bmp", "", { r: 1, g: 2, b: 3 })]);
  const differ = imported(animation);
  ok(!Object.hasOwn(differ, "colourKey"));
  deepEqual(
    differ.frames.map((frame) => frame.colourKey),
    [{ r: 1, g: 2, b: 3 }, WHITE, { r: 1, g: 2, b: 3 }],
  );
  deepEqual(clipEqualsOracle(viaText(differ), oracleOf(animation)), []);
});

void test("the delay is carried unchanged, zero included, and the canvas is the legacy size", () => {
  for (const delay of [0, 0.15, 0.0666666666666667, 1 / 3]) {
    const clip = viaText(imported(legacy([slot("a.bmp")], { delay, width: 64, height: 128 })));
    ok(Object.is(clip.delay, delay), `delay ${delay}`);
    deepEqual(clip.canvas, { width: 64, height: 128 });
  }
});

void test("the oracle keeps what the clip drops: all 51 slots, header, size, delay and residue", () => {
  const animation = legacy([slot("a.bmp", "s.wav")], { residue: new Uint8Array([7, 8]), major: 2 });
  const oracle = oracleOf(animation);
  equal(oracle.slots.length, 51);
  deepEqual(oracle.header, { magic: "RPGTLKIT ANIM", major: 2, minor: 3 });
  deepEqual(oracle.residue, [7, 8]);
  deepEqual(oracle.slots[0], { image: "a.bmp", colour: WHITE, sound: "s.wav" });
});

void test("a legacy value the contract cannot hold is returned as problems, not repaired", () => {
  const refuse = (animation: Animation): string => {
    const result = importAnimation(animation, "x.anm");
    if (result.ok) throw new Error("expected the import to be refused");
    return formatClipProblems(result.problems);
  };
  ok(refuse(legacy([])).includes("frames"));
  ok(refuse(legacy([slot("a.bmp ")])).includes("frames[0].image"));
  ok(refuse(legacy([slot("a.bmp\n")])).includes("frames[0].image"));
  ok(refuse(legacy([slot("a.bmp")], { width: 0 })).includes("canvas.width"));
  ok(refuse(legacy([slot("a.bmp")], { delay: -0.5 })).includes("delay"));
  ok(refuse(legacy([slot("a.bmp")], { delay: Number.NaN })).includes("delay"));
});

// ---------------------------------------------------------------- the equality itself

void test("the four-point equality fails on each kind of difference", () => {
  const animation = legacy([slot("a.bmp", "s.wav"), slot("Village.tst3", "", { r: 5, g: 6, b: 7 })]);
  const oracle = oracleOf(animation);
  const clip = imported(animation);
  deepEqual(clipEqualsOracle(clip, oracle), []);

  const frames = clip.frames;
  const first = frames[0]!;
  const second = frames[1]!;
  const cases: [string, Clip, RegExp][] = [
    ["canvas", { ...clip, canvas: { width: 33, height: 32 } }, /^1\./],
    ["delay", { ...clip, delay: 0.16 }, /^2\./],
    ["a dropped frame", { ...clip, frames: [first] }, /^3\./],
    ["an empty slot kept", { ...clip, frames: [first, second, { image: "bitmap/" }] }, /^3\./],
    ["reordered frames", { ...clip, frames: [second, first] }, /^4\./],
    ["a changed image", { ...clip, frames: [{ ...first, image: "bitmap/b.bmp" }, second] }, /^4\. frame 0 image/],
    ["a lost sound", { ...clip, frames: [{ image: first.image }, second] }, /^4\. frame 0 sound/],
    ["an invented sound", { ...clip, frames: [first, { ...second, sound: "media/x.wav" }] }, /^4\. frame 1 sound/],
    ["a changed colour", { ...clip, frames: [first, { ...second, colourKey: { r: 5, g: 6, b: 8 } }] }, /^4\. frame 1 colour/],
    ["no colour at all", { ...clip, frames: [first, { image: second.image }] }, /^4\. frame 1 colour/],
  ];
  for (const [name, changed, pattern] of cases) {
    const differences = clipEqualsOracle(changed, oracle);
    ok(differences.length > 0 && pattern.test(differences[0]!), `${name}: ${differences.join("; ")}`);
  }
});

void test("a binary animation built byte by byte imports through the real decoder", () => {
  const writer = new BinaryWriter();
  writer.str(ANIMATION_MAGIC);
  writer.i16(2);
  writer.i16(3);
  writer.i32(48);
  writer.i32(16);
  writer.i32(2);
  for (const [image, sound] of [["Walk1.BMP", ""], ["", "orphan.wav"], ["Walk2.BMP", "Step.WAV"]] as const) {
    writer.str(image);
    writer.color({ r: 255, g: 0, b: 255 });
    writer.str(sound);
  }
  writer.f64(0);
  const decoded = readAnimation(new BinaryReader(writer.toBytes()));
  if (!decoded.ok) throw new Error(decoded.error.message);
  const result = importAnimation(decoded.value, "walk.anm");
  if (!result.ok) throw new Error(formatClipProblems(result.problems));
  deepEqual(viaText(result.clip), {
    contract: "animation-clip",
    version: "1.0.0-pre.1",
    tags: ["imported"],
    metadata: { source: "walk.anm" },
    canvas: { width: 48, height: 16 },
    delay: 0,
    colourKey: { r: 255, g: 0, b: 255 },
    frames: [{ image: "bitmap/walk1.bmp" }, { image: "bitmap/walk2.bmp", sound: "media/step.wav" }],
  });
  deepEqual(result.report, { droppedSlots: 1, droppedSounds: [{ slot: 1, sound: "orphan.wav" }] });
});
