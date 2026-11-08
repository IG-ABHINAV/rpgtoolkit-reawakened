/** Host capability and display queries (docs/spec/engine/host-capabilities-and-viewports.md#host-features). */
import type { Arg, BuiltinDoc, BuiltinSpec } from "../builtins.ts";
import { ScriptError } from "../errors.ts";
import { foldAscii } from "../values.ts";

const GROUPS = ["core-runtime", "host-capabilities-viewport-geometry-reawakened"];
const SEE = [
  "docs/spec/engine/host-capabilities-and-viewports.md#host-features",
  "docs/spec/engine/host-capabilities-and-viewports.md#display-planes",
];

function docs(summary: string, behaviour: string, throws?: BuiltinDoc["throws"]): BuiltinDoc {
  return {
    summary,
    behaviour,
    groups: GROUPS,
    tags: ["experimental"],
    waits: { kind: "never", summary: "The query returns immediately and never waits." },
    see: SEE,
    ...(throws === undefined ? {} : { throws }),
  };
}

function stringArg(args: readonly Arg[], index: number, name: string): string {
  const value = args[index]?.value;
  if (typeof value !== "string") throw new ScriptError("builtin.bad-arg", `${name}: expected a string`);
  return value;
}

type Side = "left" | "right" | "top" | "bottom";
function sideArg(args: readonly Arg[], name: string): Side {
  const side = foldAscii(stringArg(args, 0, name));
  if (side === "left" || side === "right" || side === "top" || side === "bottom") return side;
  throw new ScriptError("builtin.bad-arg", `${name}: side must be left, right, top, or bottom`);
}

function geometryValue(view: Parameters<BuiltinSpec["call"]>[0], args: readonly Arg[], name: "marginwidth" | "safeareainset"): number {
  const side = sideArg(args, name);
  const geometry = view.state?.display.geometry;
  const width = view.logicalViewport?.width ?? view.state?.display.geometry.game.width ?? 320;
  const height = view.logicalViewport?.height ?? view.state?.display.geometry.game.height ?? 240;
  if (geometry === undefined) return 0;
  if (name === "marginwidth") {
    const distance = side === "left" ? geometry.game.x
      : side === "right" ? geometry.content.width - geometry.game.x - geometry.game.width
        : side === "top" ? geometry.game.y
          : geometry.content.height - geometry.game.y - geometry.game.height;
    return Math.floor(distance / (side === "left" || side === "right" ? geometry.game.width / width : geometry.game.height / height));
  }
  const inset = geometry.safeArea[side];
  return Math.floor(inset / (side === "left" || side === "right" ? geometry.game.width / width : geometry.game.height / height));
}

export const HOST_SPECS: readonly BuiltinSpec[] = [
  {
    name: "hasfeature",
    aliases: [],
    params: [{ name: "name", optional: false, byRef: false, variadic: false }],
    doc: docs(
      "Check whether a host capability is active.",
      "Read the current normalized host capability record and return 1 or 0. Names are case-insensitive: touch, keyboard, gamepad, and haptics use their boolean values; pointer is active unless its type is none; orientation is active unless it is null. Unknown names return 0.",
      [{ code: "builtin.bad-arg", when: "The capability name is not a string." }],
    ),
    call: (view, args) => {
      const name = foldAscii(stringArg(args, 0, "hasFeature"));
      const features = view.state?.features;
      const active = name === "touch" ? features?.touch === true
        : name === "keyboard" ? features?.keyboard === true
          : name === "gamepad" ? features?.gamepad === true
            : name === "haptics" ? features?.haptics === true
              : name === "pointer" ? features !== undefined && features.pointer !== "none"
                : name === "orientation" ? features !== undefined && features.orientation !== null
                  : false;
      return { value: active ? 1 : 0 };
    },
  },
  {
    name: "pointertype",
    aliases: [],
    params: [],
    doc: docs("Read the current pointer precision.", "Return the normalized host pointer type: fine, coarse, or none."),
    call: (view) => ({ value: view.state?.features.pointer ?? "none" }),
  },
  {
    name: "viewwidth",
    aliases: [],
    params: [],
    doc: docs("Read the configured logical viewport width in pixels.", "Return the configured logical viewport width in pixels; physical display geometry does not change this value."),
    call: (view) => ({ value: view.logicalViewport?.width ?? 320 }),
  },
  {
    name: "viewheight",
    aliases: [],
    params: [],
    doc: docs("Read the configured logical viewport height in pixels.", "Return the configured logical viewport height in pixels; physical display geometry does not change this value."),
    call: (view) => ({ value: view.logicalViewport?.height ?? 240 }),
  },
  {
    name: "marginwidth",
    aliases: [],
    params: [{ name: "side", optional: false, byRef: false, variadic: false }],
    doc: docs("Read the display margin for a side in logical pixels.", "For left, right, top, or bottom, return the distance between the content edge and game rectangle edge, divided by the corresponding game-to-logical scale and floored. Side names are case-insensitive.", [{ code: "builtin.bad-arg", when: "The side is not a string or is not left, right, top, or bottom." }]),
    call: (view, args) => ({ value: geometryValue(view, args, "marginwidth") }),
  },
  {
    name: "safeareainset",
    aliases: [],
    params: [{ name: "side", optional: false, byRef: false, variadic: false }],
    doc: docs("Read a hardware safe-area inset in logical pixels.", "For top, right, bottom, or left, return the CSS-pixel inset divided by the corresponding game-to-logical scale and floored. Side names are case-insensitive.", [{ code: "builtin.bad-arg", when: "The side is not a string or is not top, right, bottom, or left." }]),
    call: (view, args) => ({ value: geometryValue(view, args, "safeareainset") }),
  },
  {
    name: "displayaspect",
    aliases: [],
    params: [],
    doc: docs("Read the physical content-window aspect ratio.", "Return content.width divided by content.height from the current normalized display geometry."),
    call: (view) => {
      const geometry = view.state?.display.geometry;
      return { value: geometry === undefined ? 4 / 3 : geometry.content.width / geometry.content.height };
    },
  },
];
