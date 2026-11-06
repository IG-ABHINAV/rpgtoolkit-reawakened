// Integer geometry for the movement oracle (ticket 5.2).
//
// Written from docs/spec/engine/movement-and-collision.md and nothing else; it
// imports no code from packages/core. Positions are held in fixed point: one
// board pixel is `FP` (256) units, so every comparison below is exact integer
// arithmetic (no trigonometry, no `**`, no host-dependent maths; R-54 and AD-13).
// Overlap means *interior* overlap: two shapes that only touch do not collide, so
// a sprite can stand flush against a wall.

export const FP = 256;

/** The eight facings, in the ruled index order (R-54): N = 0 … NW = 7. */
export const FACINGS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
export const DIRV = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];

export const px = (value) => Math.round(value * FP);
export const toPx = (units) => units / FP;

/** A rectangle as a counter-clockwise-agnostic point list (units). */
export function rect(x0, y0, x1, y1) {
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}

export function translate(points, dx, dy) {
  return points.map(([x, y]) => [x + dx, y + dy]);
}

export function scale(points) {
  return points.map(([x, y]) => [x * FP, y * FP]);
}

function project(points, ax, ay) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const [x, y] of points) {
    const value = x * ax + y * ay;
    if (value < lo) lo = value;
    if (value > hi) hi = value;
  }
  return [lo, hi];
}

function axes(points, closed) {
  const out = [];
  const count = closed ? points.length : points.length - 1;
  for (let index = 0; index < count; index += 1) {
    const [x0, y0] = points[index];
    const [x1, y1] = points[(index + 1) % points.length];
    out.push([y1 - y0, x0 - x1]);
  }
  return out;
}

/**
 * Interior overlap of two convex shapes by the separating-axis test. A shape
 * with two points is an open segment; with more it is a closed convex polygon.
 */
export function overlaps(a, b) {
  const all = [...axes(a, a.length > 2), ...axes(b, b.length > 2)];
  for (const [ax, ay] of all) {
    const [aLo, aHi] = project(a, ax, ay);
    const [bLo, bHi] = project(b, ax, ay);
    if (aHi <= bLo || bHi <= aLo) return false;
  }
  return true;
}

/** Does the base overlap one board vector (closed polygon or open polyline)? */
export function hitsVector(base, vector) {
  if (vector.closed !== false) return overlaps(base, vector.points);
  for (let index = 0; index + 1 < vector.points.length; index += 1) {
    if (overlaps(base, [vector.points[index], vector.points[index + 1]])) return true;
  }
  return false;
}

/** Choose a canonical hit edge independent of polygon winding and start vertex. */
export function hitEdge(base, vector) {
  const count = vector.closed !== false ? vector.points.length : vector.points.length - 1;
  const compare = (a, b) => a[0] - b[0] || a[1] - b[1];
  const edges = [];
  const fallback = [];
  const xs = base.map((p) => p[0]);
  const ys = base.map((p) => p[1]);
  const turn = (a, b, p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  const on = (a, b, p) => p[0] >= Math.min(a[0], b[0]) && p[0] <= Math.max(a[0], b[0]) && p[1] >= Math.min(a[1], b[1]) && p[1] <= Math.max(a[1], b[1]);
  for (let index = 0; index < count; index += 1) {
    const a = vector.points[index];
    const b = vector.points[(index + 1) % vector.points.length];
    const edge = compare(a, b) <= 0 ? [a, b] : [b, a];
    if (Math.max(a[0], b[0]) >= Math.min(...xs) && Math.min(a[0], b[0]) <= Math.max(...xs) && Math.max(a[1], b[1]) >= Math.min(...ys) && Math.min(a[1], b[1]) <= Math.max(...ys)) fallback.push(edge);
    for (let i = 0; i < base.length; i += 1) {
      const c = base[i];
      const d = base[(i + 1) % base.length];
      const [u, v, w, x] = [turn(a, b, c), turn(a, b, d), turn(c, d, a), turn(c, d, b)];
      if (((u > 0 && v < 0) || (u < 0 && v > 0) || (u === 0 && on(a, b, c)) || (v === 0 && on(a, b, d)))
        && ((w > 0 && x < 0) || (w < 0 && x > 0) || (w === 0 && on(c, d, a)) || (x === 0 && on(c, d, b)))) {
        edges.push(edge);
        break;
      }
    }
  }
  const candidates = edges.length === 0 ? fallback : edges;
  candidates.sort((a, b) => compare(a[0], b[0]) || compare(a[1], b[1]));
  return candidates.length === 0 ? null : [candidates[0][1][0] - candidates[0][0][0], candidates[0][1][1] - candidates[0][0][1]];
}

/**
 * R-54 glancing test on integer vectors: `|cross| <= |dot|` (angle to the edge
 * line at most 45 degrees), or the fixed rational tan 63 degrees on isometric boards.
 */
export function isGlancing(m, e, isometric) {
  const cross = Math.abs(m[0] * e[1] - m[1] * e[0]);
  const dot = Math.abs(m[0] * e[0] + m[1] * e[1]);
  return isometric ? cross * 100000 <= dot * 196261 : cross <= dot;
}

/** The facing index (0..7) nearest to a vector, with integer ratios only. */
export function facingOf(dx, dy) {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax === 0 && ay === 0) return -1;
  // tan 22.5 degrees ~ 0.414: |dy| <= 0.414 |dx| is horizontal, symmetric for vertical.
  if (ay * 1000 <= ax * 414) return dx > 0 ? 2 : 6;
  if (ax * 1000 <= ay * 414) return dy > 0 ? 4 : 0;
  if (dx > 0) return dy > 0 ? 3 : 1;
  return dy > 0 ? 5 : 7;
}

/** The squared length of a vector of units. */
export const len2 = (dx, dy) => dx * dx + dy * dy;

/** Exact-rational compare of a/b with c/d (b, d > 0). */
const cmp = (a, b, c, d) => a * d - c * b;

/**
 * Does the open segment A-B pass through the open interior of the axis-aligned
 * rectangle (x0, y0)-(x1, y1)? Exact rationals; used by the vector pathfinder.
 */
export function segmentCrossesOpenRect(ax, ay, bx, by, x0, y0, x1, y1) {
  let lo = [0, 1];
  let hi = [1, 1];
  const clip = (a, d, lower, upper) => {
    if (d === 0) return a > lower && a < upper;
    let t0;
    let t1;
    if (d > 0) {
      t0 = [lower - a, d];
      t1 = [upper - a, d];
    } else {
      t0 = [upper - a, d];
      t1 = [lower - a, d];
    }
    // normalise denominators positive
    const norm = ([n, den]) => (den < 0 ? [-n, -den] : [n, den]);
    t0 = norm(t0);
    t1 = norm(t1);
    if (cmp(t0[0], t0[1], lo[0], lo[1]) > 0) lo = t0;
    if (cmp(t1[0], t1[1], hi[0], hi[1]) < 0) hi = t1;
    return true;
  };
  if (!clip(ax, bx - ax, x0, x1)) return false;
  if (!clip(ay, by - ay, y0, y1)) return false;
  return cmp(lo[0], lo[1], hi[0], hi[1]) < 0;
}
