/**
 * The legacy `.anm` to native clip importer (docs/spec/formats/native-animation-clip.md,
 * "Field accounting"). It takes the legacy decoder's model, already decoded, and
 * returns a native clip model; it reads and writes no file (G2), and the clip it
 * returns carries no timestamp and nothing else that changes from run to run.
 *
 * Choices the contract page left open, recorded in its "Reference reader, writer
 * and importer" note: where an ID points (a folder prefix per asset type), which
 * key spelling a shared colour key gets, and what is reported about dropped slots.
 */

import { classifyImageReference, type Animation } from "@tk-reawakened/core";
import { checkClip, CLIP_CONTRACT, CLIP_VERSION, foldId, type Clip, type ClipColour, type ClipFrame, type ClipProblem } from "@tk-reawakened/native-data";

/** What the importer dropped, for a person to read. Empty slots are dropped by rule; this says how many, and which held a sound. */
export type ImportReport = {
  /** How many legacy slots had no image and were dropped. */
  readonly droppedSlots: number;
  /** The dropped slots that still named a sound, by 0-based slot number. */
  readonly droppedSounds: readonly { readonly slot: number; readonly sound: string }[];
};

export type ImportResult =
  | { readonly ok: true; readonly clip: Clip; readonly report: ImportReport }
  | { readonly ok: false; readonly problems: readonly ClipProblem[] };

/** The legacy path rule: `\` is `/`, then the ASCII fold (docs/spec/formats/README.md#paths-inside-files). */
const fold = (name: string): string => foldId(name.replaceAll("\\", "/"));

/**
 * The ID of a legacy frame image. A tile reference (`village.tst14`, `set.iso3`,
 * `x.gph`) is the tileset's ID with the tile number appended, under `tiles/`;
 * any other picture, `.tbm` included, is under `bitmap/`.
 */
export function imageId(image: string): string {
  const kind = classifyImageReference(image).kind;
  return `${kind === "tile" || kind === "singleTile" ? "tiles" : "bitmap"}/${fold(image)}`;
}

/** The ID of a legacy sound name, under `media/`. */
export function soundId(sound: string): string {
  return `media/${fold(sound)}`;
}

const sameColour = (left: ClipColour, right: ClipColour): boolean => left.r === right.r && left.g === right.g && left.b === right.b;

/**
 * Convert a decoded legacy animation to a native clip. `sourceName` is the legacy
 * file name (for example `hero_walk_s.anm`), recorded as `metadata.source`.
 *
 * Empty slots are dropped; the rest keep their order. The colour key is written
 * once at the clip level when every kept frame has the same colour, and on every
 * frame otherwise. An empty sound is an absent key. The delay is carried as it
 * is, zero included. A legacy value the contract cannot hold (a name with a space
 * at either end, a size under 1, a negative delay, no picture at all) is returned
 * as problems, never repaired.
 */
export function importAnimation(animation: Animation, sourceName: string): ImportResult {
  const kept: { readonly image: string; readonly sound: string; readonly colour: ClipColour }[] = [];
  const droppedSounds: { slot: number; sound: string }[] = [];
  animation.frames.forEach((frame, slot) => {
    if (frame.image === "") {
      if (frame.sound !== "") droppedSounds.push({ slot, sound: frame.sound });
      return;
    }
    kept.push({ image: frame.image, sound: frame.sound, colour: { r: frame.transparent.r, g: frame.transparent.g, b: frame.transparent.b } });
  });

  const first = kept[0];
  const shared = first !== undefined && kept.every((frame) => sameColour(frame.colour, first.colour));
  const frames: ClipFrame[] = kept.map((frame) => ({
    image: imageId(frame.image),
    ...(frame.sound === "" ? {} : { sound: soundId(frame.sound) }),
    ...(shared ? {} : { colourKey: frame.colour }),
  }));

  const clip: Clip = {
    contract: CLIP_CONTRACT,
    version: CLIP_VERSION,
    tags: ["imported"],
    metadata: { source: sourceName },
    canvas: { width: animation.width, height: animation.height },
    delay: animation.delay,
    ...(shared ? { colourKey: first.colour } : {}),
    frames,
  };
  const problems = checkClip(clip);
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, clip, report: { droppedSlots: animation.frames.length - kept.length, droppedSounds } };
}
