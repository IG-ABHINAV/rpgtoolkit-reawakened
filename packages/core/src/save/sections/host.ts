import type { HostDisplayGeometry, HostFeatures, NormalizedHostFeatures } from "../../ports/host.ts";

export const HOST_FEATURES_SCHEMA_VERSION = 1;
export const DISPLAY_SCHEMA_VERSION = 1;

export type HostFeaturesSection = NormalizedHostFeatures;
export type DisplaySection = { readonly geometry: HostDisplayGeometry };


export function normalizeHostFeatures(input: HostFeatures | undefined): HostFeaturesSection {
  const value: HostFeatures = input === undefined ? {} : input;
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("features must be an object");
  if (Object.keys(value).some((key) => (value as Record<string, unknown>)[key] === undefined)) throw new TypeError("features must not contain undefined values");
  for (const key of ["touch", "keyboard", "gamepad", "haptics"] as const) {
    if (value[key] !== undefined && typeof value[key] !== "boolean") throw new TypeError(`features.${key} must be a boolean`);
  }
  if (value.pointer !== undefined && value.pointer !== "fine" && value.pointer !== "coarse" && value.pointer !== "none") {
    throw new TypeError("features.pointer must be 'fine', 'coarse', or 'none'");
  }
  if (value.orientation !== undefined && value.orientation !== null && value.orientation !== "landscape" && value.orientation !== "portrait") {
    throw new TypeError("features.orientation must be 'landscape', 'portrait', or null");
  }
  return {
    touch: value.touch ?? false,
    pointer: value.pointer ?? "none",
    keyboard: value.keyboard ?? false,
    gamepad: value.gamepad ?? false,
    haptics: value.haptics ?? false,
    orientation: value.orientation ?? null,
  };
}

export function createDisplaySection(width: number, height: number): DisplaySection {
  return {
    geometry: {
      content: { width, height },
      game: { x: 0, y: 0, width, height },
      safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
    },
  };
}

export function normalizeDisplayGeometry(value: HostDisplayGeometry): HostDisplayGeometry {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("displayGeometry must be an object");
  if (!hasExactKeys(value as unknown as Record<string, unknown>, ["content", "game", "safeArea"])) throw new TypeError("displayGeometry contains unexpected or missing properties");
  const content = value.content;
  const game = value.game;
  const safeArea = value.safeArea;
  if (!isRecord(content) || !isRecord(game) || !isRecord(safeArea)) throw new TypeError("displayGeometry must contain content, game, and safeArea objects");
  if (!hasExactKeys(content, ["width", "height"]) || !hasExactKeys(game, ["x", "y", "width", "height"]) || !hasExactKeys(safeArea, ["top", "right", "bottom", "left"])) throw new TypeError("displayGeometry contains unexpected or missing properties");
  const fields = [content.width, content.height, game.x, game.y, game.width, game.height, safeArea.top, safeArea.right, safeArea.bottom, safeArea.left];
  if (fields.some((field) => typeof field !== "number" || !Number.isFinite(field) || field < 0)) throw new TypeError("displayGeometry values must be finite and non-negative");
  if (content.width <= 0 || content.height <= 0 || game.width <= 0 || game.height <= 0) throw new TypeError("displayGeometry content and game sizes must be positive");
  if (game.x + game.width > content.width || game.y + game.height > content.height) throw new TypeError("displayGeometry game rectangle must fit within content");
  return {
    content: { width: content.width as number, height: content.height as number },
    game: { x: game.x as number, y: game.y as number, width: game.width as number, height: game.height as number },
    safeArea: { top: safeArea.top as number, right: safeArea.right as number, bottom: safeArea.bottom as number, left: safeArea.left as number },
  };
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
