/**
 * The 1:1 importer output as a test oracle (docs/spec/formats/native-animation-clip.md,
 * "Importer output as test oracle"): the legacy decoder's model of an `.anm`, kept
 * slot for slot, and the contract's four-point equality between a native clip and it.
 * It is a test helper only; it is never the native format and is never published.
 */

import type { Animation } from "@tk-reawakened/core";
import type { Clip, ClipColour } from "@tk-reawakened/native-data";

export type OracleSlot = { readonly image: string; readonly colour: ClipColour; readonly sound: string };

export type Oracle = {
  readonly header: { readonly magic: string; readonly major: number; readonly minor: number };
  readonly width: number;
  readonly height: number;
  /** Every slot, empty ones included, in file order (51 in every file the editor wrote). */
  readonly slots: readonly OracleSlot[];
  readonly delay: number;
  readonly residue: readonly number[];
};

/** The 1:1 model of a decoded legacy animation: every field, nothing dropped. */
export function oracleOf(animation: Animation): Oracle {
  return {
    header: { magic: animation.magic, major: animation.major, minor: animation.minor },
    width: animation.width,
    height: animation.height,
    slots: animation.frames.map((frame) => ({
      image: frame.image,
      colour: { r: frame.transparent.r, g: frame.transparent.g, b: frame.transparent.b },
      sound: frame.sound,
    })),
    delay: animation.delay,
    residue: [...animation.residue],
  };
}

/** ASCII fold, `\` as `/`: the comparison the contract names for "the same asset". */
const asset = (name: string): string => name.replaceAll("\\", "/").replace(/[A-Z]/g, (letter) => letter.toLowerCase());

/** The folder an importer may file a legacy image under: tiles for tile references, bitmap otherwise. */
const imageFolder = (image: string): string => (/\.(?:tst|iso)[0-9]+$|\.gph$/i.test(image) ? "tiles/" : "bitmap/");

const sameColour = (left: ClipColour | undefined, right: ClipColour): boolean => left !== undefined && left.r === right.r && left.g === right.g && left.b === right.b;

/**
 * The four points of the contract's equality, each reported by name when it fails.
 * An empty list means the clip equals the oracle.
 *
 * 1. the canvas equals the legacy width and height;
 * 2. the delay is the same number;
 * 3. one frame per slot that has an image, in slot order, and no others;
 * 4. each frame's image is the legacy name resolved to the same asset, its sound is
 *    the slot's or absent where the slot's is empty, and its colour key (its own,
 *    else the clip's) is the slot's colour.
 */
export function clipEqualsOracle(clip: Clip, oracle: Oracle): string[] {
  const differences: string[] = [];
  if (clip.canvas.width !== oracle.width || clip.canvas.height !== oracle.height) {
    differences.push(`1. canvas ${clip.canvas.width}x${clip.canvas.height}, legacy ${oracle.width}x${oracle.height}`);
  }
  if (!Object.is(clip.delay, oracle.delay)) differences.push(`2. delay ${clip.delay}, legacy ${oracle.delay}`);

  const withImage = oracle.slots.filter((slot) => slot.image !== "");
  if (clip.frames.length !== withImage.length) {
    differences.push(`3. ${clip.frames.length} frames, legacy has ${withImage.length} slots with an image`);
    return differences;
  }
  withImage.forEach((slot, index) => {
    const frame = clip.frames[index]!;
    const expectedImage = `${imageFolder(slot.image)}${asset(slot.image)}`;
    if (frame.image !== expectedImage) differences.push(`4. frame ${index} image ${frame.image}, legacy ${slot.image} is ${expectedImage}`);
    const expectedSound = slot.sound === "" ? undefined : `media/${asset(slot.sound)}`;
    if (frame.sound !== expectedSound) differences.push(`4. frame ${index} sound ${String(frame.sound)}, legacy ${JSON.stringify(slot.sound)}`);
    if (!sameColour(frame.colourKey ?? clip.colourKey, slot.colour)) differences.push(`4. frame ${index} colour key differs from legacy ${JSON.stringify(slot.colour)}`);
  });
  return differences;
}
