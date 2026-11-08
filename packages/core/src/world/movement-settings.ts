import type { WorldMovementSettings } from "../save/sections/world.ts";

function movementFlag(value: unknown): number {
  if (value === null) return 0;
  if (typeof value === "number") return value === 0 ? 0 : 1;
  if (typeof value === "string") return value.toLowerCase() === "off" ? 0 : 1;
  return value === false ? 0 : 1;
}

/** Resolve the immediate pixelmovement() setting update; null means no setter arity. */
export function resolvePixelMovement(
  current: WorldMovementSettings,
  args: readonly unknown[],
): WorldMovementSettings | null {
  if (args.length < 1 || args.length > 2) return null;
  const walking = movementFlag(args[0]);
  const pushing = walking === 0
    ? 0
    : args.length === 2
      ? movementFlag(args[1])
      : current.pushing ?? 0;
  return { walking, pushing };
}
