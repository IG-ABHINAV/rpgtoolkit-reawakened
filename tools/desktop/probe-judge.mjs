// One direction step is 32 pixels on the axis pressed (#1122). The tap phase
// proves a single shift key produces exactly one tile and no drift on the
// perpendicular axis; the hold phase proves continuous movement: at least two
// tiles on the pressed axis with less than half a tile of perpendicular drift,
// which no wrong-axis or diagonal walk can satisfy.
const TILE_PX = 32;
const HOLD_MIN_PX = 2 * TILE_PX;

export function judgeMovement(name, before, afterTap, afterHold) {
  const axis = name === "ArrowUp" || name === "ArrowDown" ? "y" : "x";
  const perpAxis = axis === "x" ? "y" : "x";
  const delta = (from, to) => from === null || to === null || from === undefined || to === undefined
    ? null
    : { axis: to[axis] - from[axis], perp: to[perpAxis] - from[perpAxis] };
  const tap = delta(before, afterTap);
  const hold = delta(afterTap, afterHold);
  return {
    axis,
    tap,
    hold,
    tapOk: tap !== null && Math.abs(tap.axis) === TILE_PX && Math.abs(tap.perp) < TILE_PX / 2,
    holdOk: hold !== null && Math.abs(hold.axis) >= HOLD_MIN_PX && Math.abs(hold.perp) < TILE_PX / 2,
  };
}

