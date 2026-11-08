// The movement oracle's reference simulation (ticket 5.2): a tiny tick machine
// written from docs/spec/engine/movement-and-collision.md (E-20..E-48, R-50..R-54
// and the ratifications), docs/spec/engine/main-loop-and-startup.md and AD-26's phase
// list. It exists only to *derive expected outcome facts* (positions, layers, fired
// triggers, events) for authored scenes; it imports nothing from packages/core, and it
// is not an implementation anyone should reuse.
//
// Where the specification leaves an observable open, the choice below is tagged
// `PROPOSED P-n` and is listed in the plan under "Proposed ruling (pending owner
// review)". A later consumer that disagrees changes the doc first (G7), then the scene.

import { DIRV, FACINGS, FP, facingOf, hitEdge, hitsVector, overlaps, rect, scale, translate, isGlancing } from "./geometry.mjs";
import { findPath } from "./pathfind.mjs";

export const FLAGS = { PAUSE_THREAD: 1, CLEAR_QUEUE: 2, PATHFIND: 4, WAYPOINT_PATH: 8, WAYPOINT_LINK: 16 };
const ADVANCE = 4 * FP; // R-50 item 4: 4 px per advance.
const FREEZE_TICKS = 120; // R-51 item 2: 2 s at 60 Hz.
const WAIT_TICKS = 120; // R-51 item 4 (an unverified default recorded with the rule).
const DEFAULT_BASE = [-15, -15, 15, 0]; // character.md defaults: collision rectangle.
const DEFAULT_ACT = [-24, -24, 24, 8]; // character.md defaults: activation rectangle.

/** R-50: integer ticks per 4 px advance. */
export function ticksPerAdvance(speedSeconds, gameSpeed) {
  const speedMs = Math.floor(speedSeconds * 1000 + 0.5);
  const gs = Math.max(-4, Math.min(4, gameSpeed));
  const numerator = Math.max(1000, (speedMs - 100 * gs) * 60); // max(oneTickMs, ...) x 60, exact
  return Math.max(1, Math.floor((numerator + 500) / 1000));
}

/** Seconds to whole ticks, round half up (`core/time` rule used by R-50). */
export const msToTicks = (ms) => Math.max(1, Math.floor((ms * 60 + 500) / 1000));

const polyOf = (rectPx) => rect(rectPx[0] * FP, rectPx[1] * FP, rectPx[2] * FP, rectPx[3] * FP);

function loadBoard(def) {
  return {
    ...def,
    vectors: (def.vectors ?? []).map((v) => ({ ...v, points: scale(v.points) })),
    programs: (def.programs ?? []).map((p) => ({ ...p, points: scale(p.points) })),
  };
}

export class World {
  constructor(setup) {
    this.setup = setup;
    this.boards = new Map(Object.entries(setup.boards).map(([id, def]) => [id, loadBoard({ id, ...def })]));
    this.vars = { ...(setup.vars ?? {}) };
    this.rng = [...(setup.rng ?? [])];
    this.rngIndex = 0;
    this.keySeq = 0;
    this.keyQueue = [];
    this.live = []; // lifecycle records for threads: { id, kind, owner }
    this.cache = new Map();
    this.rev = 0;
    this.fired = new Set();
    this.repeat = new Map();
    this.gone = new Set();
    this.walked = 0;
    this.lock = false;
    this.pendingSend = null;
    this.threads = [];
    this.tick = -1;
    this.players = (setup.players ?? []).map((p, index) => this.makeActor({ ...p, kind: "player" }, index));
    this.items = [];
    this.encounter = { tiles: 0 };
    this.ev = [];
    this.installBoard(setup.board, { boot: true });
    this.lastCell = this.cellOf(this.player);
    for (const t of setup.threads ?? []) this.threads.push({ ...t, status: "pending", stack: [], vars: {} });
  }

  // ---------------------------------------------------------------- actors

  makeActor(def, index) {
    const a = {
      id: def.id,
      kind: def.kind,
      index,
      x: Math.round(def.x * FP),
      y: Math.round(def.y * FP),
      layer: def.layer ?? 0,
      speed: def.speed ?? 0.05,
      facing: FACINGS.indexOf(def.facing ?? "S"),
      controlled: def.controlled ?? def.kind === "player",
      visible: def.visible !== false,
      base: polyOf(def.collision ?? DEFAULT_BASE),
      act: polyOf(def.activation?.rect ?? DEFAULT_ACT),
      trigger: def.activation ?? null,
      thread: def.thread ?? null,
      slot: def.slot ?? index,
      loadCondition: def.loadCondition ?? null,
      queue: [],
      cur: null,
      state: "waiting",
      cadence: 0,
      frozenUntil: 0,
      waitLeft: 0,
      under: new Set(),
      wp: null,
      idleCount: 0,
      stepDone: false,
      anims: def.anims ?? null,
      idleMs: def.idleMs ?? 3000,
      anim: null,
      frame: 0,
      animTicks: 0,
      stance: null,
      held: false,
    };
    return a;
  }

  get board() {
    return this.boards.get(this.boardId);
  }
  get player() {
    return this.players.find((p) => p.controlled) ?? this.players[0];
  }
  get actors() {
    return [...this.players, ...this.items];
  }
  /** `drawId`: players precede items, each by index (AD-25). */
  get ordered() {
    return this.actors.map((a, i) => ({ a, i })).sort((l, r) => l.i - r.i).map((e) => e.a);
  }
  drawId(a) {
    return a.kind === "player" ? a.index : this.players.length + a.index;
  }
  get tpaFor() {
    return (a) => ticksPerAdvance(a.speed, this.board.gameSpeed ?? 0);
  }
  cellOf(a) {
    return [Math.floor(a.x / FP / 32), Math.floor(a.y / FP / 32)];
  }
  emit(type, data = {}) {
    this.ev.push({ e: type, ...data });
  }
  moveSize() {
    // E-23 (ruled 2026-11-04): 32 px in tile movement, 4 px in either pixel mode.
    return (this.board.pixelMovement ?? 0) === 0 ? 32 : 4;
  }
  draw(n) {
    const value = this.rng[this.rngIndex];
    if (value === undefined || value < 0 || value >= n) throw new Error(`scripted rng draw ${this.rngIndex} (${value}) is not in [0, ${n})`);
    this.rngIndex += 1;
    this.emit("rng-draw", { n, value });
    return value;
  }

  // ---------------------------------------------------------------- board entry (E-19, E-47, reawakened-board-entry)

  installBoard(id, opts = {}) {
    const old = this.boardId === undefined ? null : this.board;
    const stopped = [];
    if (old !== null) {
      for (const t of this.live.filter((l) => l.kind === "board" || l.kind === "item")) stopped.push(t.id);
      this.live = this.live.filter((l) => l.kind !== "board" && l.kind !== "item");
    }
    this.boardId = id;
    this.fired.clear();
    this.repeat.clear();
    this.gone.clear();
    this.cache.clear();
    this.rev += 1;
    const board = this.board;
    // Items hydrate by compacted runtime index (raw file slots with no item are skipped).
    this.items = (board.items ?? []).map((def, index) => {
      const item = this.makeActor({ ...def, kind: "item" }, index);
      if (item.loadCondition !== null && this.vars[item.loadCondition.var] !== item.loadCondition.value) item.visible = false;
      return item;
    });
    const started = [];
    for (const t of board.threads ?? []) {
      if (t.kind === "persistent" && this.live.some((l) => l.id === t.id)) continue;
      this.live.push({ id: t.id, kind: t.kind, owner: id });
      started.push(t.id);
    }
    for (const item of this.items) {
      if (item.visible && item.thread !== null) {
        this.live.push({ id: `item:${item.id}`, kind: "item", owner: id });
        started.push(`item:${item.id}`);
      }
    }
    if (old !== null) this.emit("threads-stopped", { ids: stopped });
    this.emit("board-install", { board: id });
    for (const item of opts.boot ? this.actors : this.items) this.emit("hydrate", { id: item.id, drawId: this.drawId(item), index: item.index, slot: item.slot, visible: item.visible });
    this.lastStarted = started;
    if (opts.boot) this.emit("threads-started", { ids: started });
  }

  /** Place the player and finish the board-entry rule. `comeFrom` is the sender thread, if any. */
  enterBoard(x, y, layer, comeFrom = null) {
    const p = this.player;
    p.x = Math.round(x * FP);
    p.y = Math.round(y * FP);
    p.layer = layer;
    p.queue.length = 0;
    p.cur = null;
    p.state = "waiting";
    this.emit("place-player", { x, y, layer });
    this.emit("camera-align", { on: "player", smoothing: 0 });
    // The program under the player is deactivated so the destination does not fire at once.
    const base = translate(p.base, p.x, p.y);
    for (const prog of this.board.programs) {
      if (prog.layer === p.layer && overlaps(base, prog.points)) this.fired.add(prog.id);
    }
    for (const item of this.items) {
      if (item.visible && item.trigger !== null && item.layer === p.layer && overlaps(base, translate(item.act, item.x, item.y))) this.fired.add(`item:${item.id}`);
    }
    this.emit("trigger-deactivate", { x, y, layer });
    if (this.board.music && this.board.music !== this.music) {
      this.music = this.board.music;
      this.emit("music", { file: this.board.music });
    }
    this.emit("threads-started", { ids: this.lastStarted });
    if (this.board.enterProgram) {
      // The enter program is the blocking thread when none is live, else a board thread.
      const senderBlocks = comeFrom !== null && comeFrom.kind === "blocking";
      this.emit("enter-program", { program: this.board.enterProgram, as: senderBlocks ? "board" : "blocking" });
    }
    this.lastCell = this.cellOf(p);
    this.walked = 0;
    this.emit("cache-flushed");
  }

  // ---------------------------------------------------------------- collision

  baseAt(a, x, y) {
    return translate(a.base, x, y);
  }
  solids(layer) {
    return this.board.vectors.filter((v) => v.layer === layer && v.type === "solid");
  }
  boardHit(a, x, y) {
    const base = this.baseAt(a, x, y);
    for (const v of this.solids(a.layer)) if (hitsVector(base, v)) return v;
    return null;
  }
  spriteHit(a, x, y) {
    const base = this.baseAt(a, x, y);
    for (const other of this.ordered) {
      if (other === a || !other.visible || other.layer !== a.layer) continue;
      if (overlaps(base, this.baseAt(other, other.x, other.y))) return other;
    }
    return null;
  }
  offBoard(a, x, y) {
    const [l, u, r, d] = [a.base[0][0], a.base[0][1], a.base[1][0], a.base[2][1]];
    const w = this.board.w * FP;
    const h = this.board.h * FP;
    if (x + l < 0) return "W";
    if (x + r > w) return "E";
    if (y + u < 0) return "N";
    if (y + d > h) return "S";
    return null;
  }

  // ---------------------------------------------------------------- path finding

  route(a, goalPx) {
    const sprites = this.ordered.filter((o) => o !== a && o.visible && o.layer === a.layer).map((o) => this.baseAt(o, o.x, o.y));
    const ctx = { w: this.board.w, h: this.board.h, base: a.base, solids: this.solids(a.layer), sprites };
    const start = [Math.round(a.x / FP), Math.round(a.y / FP)];
    const mode = this.board.pfMode ?? 1;
    const key = JSON.stringify([this.rev, mode, a.layer, a.base, start, goalPx, sprites]);
    let cache = "hit";
    let result = this.cache.get(key);
    if (result === undefined) {
      cache = "miss";
      result = findPath(ctx, mode, start, goalPx);
      this.cache.set(key, result);
    }
    return { result, cache, mode };
  }

  // ---------------------------------------------------------------- commands (input phase)

  enqueue(a, step) {
    a.queue.push(step);
  }
  issue(a, flags, points, extra = {}) {
    if (flags & FLAGS.CLEAR_QUEUE) {
      a.queue.length = 0;
      a.cur = null;
      a.wp = null;
      a.waitLeft = 0;
    }
    if (flags & FLAGS.PATHFIND) {
      const goal = points[points.length - 1];
      const { result, cache, mode } = this.route(a, goal);
      this.emit("path", { actor: a.id, mode, goal, route: result.points, expansions: result.expansions, capped: result.capped, reached: result.reached, goalAdjusted: result.goalAdjusted, cache });
      for (const [x, y] of result.points) this.enqueue(a, { src: "path", tx: Math.round(x * FP), ty: Math.round(y * FP) });
    } else if (flags & (FLAGS.WAYPOINT_PATH | FLAGS.WAYPOINT_LINK)) {
      const v = this.board.vectors.find((vec) => vec.id === extra.vector);
      a.wp = { vector: v.id, link: Boolean(flags & FLAGS.WAYPOINT_LINK), cycles: extra.cycles ?? 1, done: 0, idx: 0, copy: v.points.map((p) => [...p]) };
      this.emit("waypoint-start", { actor: a.id, vector: v.id, link: a.wp.link, cycles: a.wp.cycles });
    } else {
      for (const [x, y] of points) this.enqueue(a, { src: "point", tx: Math.round(x * FP), ty: Math.round(y * FP), ignoreBoard: true });
    }
  }
  pushDirs(a, dirs, clear) {
    if (clear) this.issue(a, FLAGS.CLEAR_QUEUE, []);
    for (const d of dirs.split(",").map((s) => s.trim()).filter(Boolean)) this.enqueue(a, { src: "dir", dir: FACINGS.indexOf(d), size: this.moveSize() });
  }

  applyScript(op) {
    const actor = (id) => this.actors.find((a) => a.id === id);
    switch (op.op) {
      case "press": this.pushDirs(this.player, op.dir, false); this.emit("key-press", { dir: op.dir }); break;
      case "push": this.pushDirs(actor(op.actor), op.dirs, Boolean(op.clear)); break;
      case "path": this.issue(actor(op.actor), op.flags, op.points); break;
      case "waypoint": this.issue(actor(op.actor), op.flags, [], { vector: op.vector, cycles: op.cycles }); break;
      case "activate": this.activateKey = true; this.emit("activate-key"); break;
      case "setVar": this.setVar(op.var, op.value); break;
      case "editVector": this.editVector(op); break;
      case "send": this.pendingSend = op; this.emit("send-requested", { board: op.board, x: op.x, y: op.y, layer: op.layer }); break;
      case "removeItem": this.removeItem(op.item); break;
      case "showItem": this.showItem(op.item, true); break;
      case "hideItem": this.showItem(op.item, false); break;
      case "stance": this.playStance(actor(op.actor), op.name); break;
      case "keypress": this.keySeq += 1; this.keyQueue.push({ seq: this.keySeq, key: op.key ?? "confirm" }); this.emit("key", { seq: this.keySeq, key: op.key ?? "confirm" }); break;
      case "teleport": { const a = actor(op.actor); a.x = Math.round(op.x * FP); a.y = Math.round(op.y * FP); a.queue.length = 0; a.cur = null; break; }
      default: throw new Error(`unknown script op ${op.op}`);
    }
  }
  setVar(name, value) {
    if (this.vars[name] !== value) {
      this.vars[name] = value;
      this.changed = { ...(this.changed ?? {}), [name]: value };
    }
  }
  editVector(op) {
    const board = this.boards.get(op.board ?? this.boardId);
    if (op.action === "add") board.vectors.push({ ...op.vector, points: scale(op.vector.points) });
    else if (op.action === "remove") board.vectors = board.vectors.filter((v) => v.id !== op.id);
    else if (op.action === "move") board.vectors.find((v) => v.id === op.id).points = scale(op.points);
    this.cache.clear();
    this.rev += 1;
    this.emit("vector-edit", { action: op.action, id: op.id ?? op.vector.id });
    this.emit("cache-flushed");
  }
  removeItem(id) {
    const item = this.items.find((i) => i.id === id);
    item.visible = false;
    item.removed = true;
    this.live = this.live.filter((l) => {
      const gone = l.id === `item:${id}`;
      if (gone) this.emit("thread-stop", { id: l.id, owner: id });
      return !gone;
    });
    this.emit("item-removed", { item: id });
  }
  showItem(id, visible) {
    const item = this.items.find((i) => i.id === id);
    if (item.visible === visible) return;
    item.visible = visible;
    const tid = `item:${id}`;
    if (visible && item.thread !== null) {
      this.live.push({ id: tid, kind: "item", owner: this.boardId });
      this.emit("thread-start", { id: tid, owner: id });
    } else if (!visible && this.live.some((l) => l.id === tid)) {
      this.live = this.live.filter((l) => l.id !== tid);
      this.emit("thread-stop", { id: tid, owner: id });
    }
    this.emit(visible ? "item-shown" : "item-hidden", { item: id });
  }

  // ---------------------------------------------------------------- script threads (E-33, AD-26 waits)

  evalExpr(th, e) {
    if (typeof e === "number") return e;
    if (typeof e === "string") return th.vars[e] ?? this.vars[e];
    switch (e[0]) {
      case "add": return this.evalExpr(th, e[1]) + this.evalExpr(th, e[2]);
      case "sub": return this.evalExpr(th, e[1]) - this.evalExpr(th, e[2]);
      case "rand": return this.draw(this.evalExpr(th, e[1]));
      default: throw new Error(`bad expr ${e[0]}`);
    }
  }
  startMovementWait(th, ids) {
    th.status = "wait:movement";
    th.wait = { kind: "movement", actors: ids };
  }
  movementIdle(a) {
    return a.cur === null && a.queue.length === 0 && a.wp === null;
  }
  exec(th, op, collect) {
    const actor = (id) => this.actors.find((a) => a.id === id);
    switch (op.op) {
      case "locate": {
        const a = actor(op.actor);
        th.vars[op.x] = Math.round(a.x / FP);
        th.vars[op.y] = Math.round(a.y / FP);
        this.emit("locate", { thread: th.id, actor: a.id, x: th.vars[op.x], y: th.vars[op.y], layer: a.layer });
        break;
      }
      case "set": th.vars[op.var] = this.evalExpr(th, op.expr); break;
      case "if": {
        const [kind, ax, ay, bx, by, range] = op.cond;
        const v = (e) => this.evalExpr(th, e);
        const yes = kind === "near" ? Math.abs(v(ax) - v(bx)) < range && Math.abs(v(ay) - v(by)) < range : v(ax) === v(bx) && v(ay) === v(by);
        th.stack.push({ ops: yes ? op.then : op.else ?? [], i: 0 });
        break;
      }
      case "loop": th.stack.push({ ops: op.body, i: 0, loop: true }); break;
      case "sleep": th.status = "sleep"; th.wake = this.tick + op.ticks; break;
      case "end": th.status = "done"; th.stack.length = 0; this.emit("thread-end", { thread: th.id }); break;
      case "emit": this.emit(op.name, { thread: th.id, ...(op.data ?? {}) }); break;
      case "waitKey": th.status = "wait:key"; th.wait = { kind: "input.key", after: this.keySeq }; break;
      case "run": th.stack.push({ ops: op.program, i: 0 }); break;
      case "push":
      case "path": {
        const a = actor(op.actor);
        if (collect) { collect.push(op); break; }
        this.runMove(th, a, op);
        break;
      }
      case "multiRun": {
        const pending = [];
        for (const m of op.moves) pending.push(m);
        // multiRun defers every start, then starts them together and yields one movement wait.
        for (const m of pending) this.runMove(th, actor(m.actor), { ...m, flags: (m.flags ?? 0) & ~FLAGS.PAUSE_THREAD });
        this.startMovementWait(th, pending.map((m) => m.actor));
        break;
      }
      case "waypoint": this.issue(actor(op.actor), op.flags, [], { vector: op.vector, cycles: op.cycles }); if (op.flags & FLAGS.PAUSE_THREAD) this.startMovementWait(th, [op.actor]); break;
      default: this.applyScript(op);
    }
  }
  runMove(th, a, op) {
    const flags = op.flags ?? 0;
    if (op.op === "push") this.pushDirs(a, op.dirs, Boolean(flags & FLAGS.CLEAR_QUEUE));
    else this.issue(a, flags, op.points ?? [[this.evalExpr(th, op.goal[0]), this.evalExpr(th, op.goal[1])]]);
    if (th.kind === "blocking" || flags & FLAGS.PAUSE_THREAD) this.startMovementWait(th, [a.id]);
  }

  wakeThreads() {
    for (const th of this.threads) {
      if (th.status === "pending" && (th.start ?? 0) <= this.tick) {
        th.status = "run";
        th.stack = [{ ops: th.program, i: 0 }];
        this.emit("thread-start", { id: th.id, kind: th.kind });
      }
    }
    for (const th of [...this.threads].sort((l, r) => (l.id < r.id ? -1 : 1))) {
      if (th.status === "sleep" && this.tick >= th.wake) th.status = "run";
      else if (th.status === "wait:movement" && th.wait.actors.every((id) => this.movementIdle(this.actors.find((a) => a.id === id)))) th.status = "run";
      else if (th.status === "wait:key" && this.keyQueue.some((k) => k.seq > th.wait.after)) th.status = "run";
    }
  }
  runThreads() {
    for (const th of this.threads) {
      let budget = 10000;
      while (th.status === "run" && budget > 0) {
        budget -= 1;
        const frame = th.stack[th.stack.length - 1];
        if (frame === undefined) { th.status = "done"; break; }
        if (frame.i >= frame.ops.length) {
          if (frame.loop) frame.i = 0;
          else th.stack.pop();
          continue;
        }
        const op = frame.ops[frame.i];
        frame.i += 1;
        this.exec(th, op);
      }
    }
  }

  // ---------------------------------------------------------------- movement phase

  startStep(a) {
    if (a.queue.length === 0 && a.wp !== null) this.nextWaypoint(a);
    if (a.queue.length === 0) return false;
    const s = a.queue.shift();
    const dir = s.src === "dir";
    const tx = dir ? a.x + DIRV[s.dir][0] * s.size * FP : s.tx;
    const ty = dir ? a.y + DIRV[s.dir][1] * s.size * FP : s.ty;
    a.cur = { src: s.src, dir: dir ? s.dir : null, tx, ty, sx: a.x, sy: a.y, ignoreBoard: Boolean(s.ignoreBoard), tried: false };
    a.state = "moving";
    return true;
  }
  waypointFinished(a) {
    const w = a.wp;
    const pts = w.link ? this.board.vectors.find((v) => v.id === w.vector).points : w.copy;
    return w.idx >= pts.length && w.cycles !== 0 && w.done + 1 >= w.cycles;
  }
  nextWaypoint(a) {
    const w = a.wp;
    const pts = w.link ? this.board.vectors.find((v) => v.id === w.vector).points : w.copy;
    if (w.idx >= pts.length) {
      w.idx = 0;
      w.done += 1;
      if (w.cycles !== 0 && w.done >= w.cycles) {
        a.wp = null;
        this.emit("waypoint-complete", { actor: a.id });
        return;
      }
    }
    const [x, y] = pts[w.idx];
    w.idx += 1;
    a.queue.push({ src: "waypoint", tx: x, ty: y });
  }

  advanceVec(a) {
    const c = a.cur;
    const dx = c.tx - a.x;
    const dy = c.ty - a.y;
    if ((this.board.pixelMovement ?? 0) > 0 && c.src === "dir" && Math.abs(dx) <= ADVANCE && Math.abs(dy) <= ADVANCE) {
      return { nx: c.tx, ny: c.ty, reach: true };
    }
    const dist = Math.floor(Math.sqrt(dx * dx + dy * dy));
    if (dist <= ADVANCE) return { nx: c.tx, ny: c.ty, reach: true };
    return { nx: a.x + Math.trunc((dx * ADVANCE) / dist), ny: a.y + Math.trunc((dy * ADVANCE) / dist), reach: false };
  }

  free(a, x, y) {
    return this.boardHit(a, x, y) === null && this.spriteHit(a, x, y) === null && this.offBoard(a, x, y) === null;
  }

  moveActor(a) {
    if (!a.visible) return;
    if (a.state === "frozen") {
      if (this.tick >= a.frozenUntil) {
        a.state = "waiting";
        a.cadence = 0;
        this.emit("thaw", { actor: a.id });
      }
      return;
    }
    if (a.state === "stance" && !a.held) return;
    const active = a.cur !== null || a.queue.length > 0 || a.wp !== null;
    if (!active) {
      a.cadence = 0;
      if (a.state === "moving") a.state = "waiting";
      return;
    }
    if (a.cadence > 0) {
      a.cadence -= 1;
      return;
    }
    if (a.cur === null && !this.startStep(a)) return;
    if (a.held) {
      a.held = false;
      a.stance = null;
      this.emit("stance-released", { actor: a.id });
    }
    a.state = "moving";
    const tpa = this.tpaFor(a);
    const c = a.cur;
    const { nx, ny, reach } = this.advanceVec(a);
    const dirIdx = c.dir !== null ? c.dir : facingOf(nx - a.x, ny - a.y);
    const finish = (blocked) => {
      a.cur = null;
      a.waitLeft = 0;
      // A successful step reports that it completed (the party step count reads this event, see
      // docs/spec/engine/movement-and-collision.md#reawakened-party-steps); a blocked step does not complete.
      if (!blocked) this.emit("step-complete", { actor: a.id });
      if (a.queue.length === 0 && a.wp !== null && this.waypointFinished(a)) {
        a.wp = null;
        this.emit("waypoint-complete", { actor: a.id });
      }
      if (a.queue.length === 0 && a.wp === null) {
        a.state = "waiting";
        a.cadence = 0;
        this.emit("movement-complete", blocked ? { actor: a.id, blocked: true } : { actor: a.id });
      } else a.cadence = tpa - 1;
    };

    // The player cannot leave the board except over a link (E-28); items are not limited.
    if (a.kind === "player") {
      const exit = this.offBoard(a, nx, ny);
      if (exit !== null) {
        if (dirIdx >= 0) a.facing = dirIdx;
        a.pendingExit = exit;
        finish(true);
        return;
      }
    }

    const hit = c.ignoreBoard ? null : this.boardHit(a, nx, ny);
    if (hit !== null) {
      const slid = (this.board.pixelMovement ?? 0) >= 1 ? this.slide(a, hit, nx, ny) : null;
      if (slid === null) {
        this.emit("blocked", { actor: a.id, by: hit.id });
        if (dirIdx >= 0) a.facing = dirIdx;
        finish(true);
        return;
      }
      // R-54 item 3: the slide turns the step, so the slid point becomes its target and the step ends
      // on arriving there (one slide per step).
      this.applyMove(a, slid.x, slid.y, slid.facing);
      this.afterAdvance(a, c, slid.x, slid.y, true, tpa, finish);
      return;
    }

    const blocker = this.spriteHit(a, nx, ny);
    if (blocker !== null) {
      this.spriteCollision(a, c, blocker, tpa, finish);
      return;
    }

    a.waitLeft = 0;
    this.applyMove(a, nx, ny, dirIdx);
    this.afterAdvance(a, c, nx, ny, reach, tpa, finish);
  }

  /** R-54: slide along a wall at a glancing angle (pixel movement only). */
  slide(a, vector, nx, ny) {
    const f = facingOf(nx - a.x, ny - a.y);
    const edge = hitEdge(this.baseAt(a, nx, ny), vector);
    if (f < 0 || edge === null) return null;
    if (!isGlancing([nx - a.x, ny - a.y], edge, false)) return null;
    const cands = [(f + 7) % 8, (f + 1) % 8]
      .map((d) => ({ d, x: a.x + (DIRV[d][0] === 0 || DIRV[d][1] === 0 ? DIRV[d][0] * ADVANCE : DIRV[d][0] * 724), y: a.y + (DIRV[d][0] === 0 || DIRV[d][1] === 0 ? DIRV[d][1] * ADVANCE : DIRV[d][1] * 724) }))
      .filter((c) => this.free(a, c.x, c.y))
      .sort((l, r) => l.d - r.d);
    return cands.length === 0 ? null : { x: cands[0].x, y: cands[0].y, facing: cands[0].d };
  }

  applyMove(a, x, y, facing) {
    const moved = Math.floor(Math.sqrt((x - a.x) ** 2 + (y - a.y) ** 2));
    if (a.kind === "player") this.walked += moved;
    a.x = x;
    a.y = y;
    if (facing >= 0) a.facing = facing;
    a.idleCount = 0;
    // Stairs move the sprite to the vector's layer; under vectors only report overlap.
    const base = this.baseAt(a, a.x, a.y);
    for (const v of this.board.vectors) {
      if (v.layer === a.layer && v.type === "stairs" && hitsVector(base, v)) {
        this.emit("layer-change", { actor: a.id, from: a.layer, to: v.toLayer, by: v.id });
        a.layer = v.toLayer;
        break;
      }
    }
    const nowUnder = new Set(this.board.vectors.filter((v) => v.layer === a.layer && v.type === "under" && hitsVector(base, v)).map((v) => v.id));
    for (const id of nowUnder) if (!a.under.has(id)) this.emit("under-enter", { actor: a.id, vector: id });
    for (const id of a.under) if (!nowUnder.has(id)) this.emit("under-leave", { actor: a.id, vector: id });
    a.under = nowUnder;
  }

  afterAdvance(a, c, nx, ny, reach, tpa, finish) {
    const vx = c.tx - c.sx;
    const vy = c.ty - c.sy;
    const passed = (c.tx - a.x) * vx + (c.ty - a.y) * vy <= 0;
    if (reach || passed) {
      if (a.kind === "player") a.stepDone = true;
      finish(false);
    } else a.cadence = tpa - 1;
  }

  spriteCollision(a, c, blocker, tpa, finish) {
    const following = c.src === "point" || c.src === "path" || c.src === "waypoint";
    if (following && a.waitLeft === 0 && !c.tried) {
      c.tried = true;
      // R-51 item 3: one local diversion attempt per blocked step, to the step's own target point.
      const { result } = this.route(a, [Math.round(c.tx / FP), Math.round(c.ty / FP)]);
      if (result.reached && result.points.length > 0) {
        const via = result.points;
        const rest = { src: c.src, tx: c.tx, ty: c.ty, ignoreBoard: c.ignoreBoard };
        a.queue.unshift(...via.map(([x, y]) => ({ src: "path", tx: Math.round(x * FP), ty: Math.round(y * FP) })), rest);
        a.cur = null;
        a.cadence = tpa - 1;
        this.emit("diversion", { actor: a.id, blocker: blocker.id, via });
        return;
      }
      a.waitLeft = WAIT_TICKS;
      this.emit("waiting-for-blocker", { actor: a.id, blocker: blocker.id });
      return;
    }
    if (following && a.waitLeft > 0) {
      a.waitLeft -= 1;
      if (a.waitLeft > 0) return;
      // R-51 item 4: the wait expired, so the actor stops and the direct result applies.
      a.queue.length = 0;
      a.wp = null;
      a.cur = null;
      this.emit("path-stopped", { actor: a.id, blocker: blocker.id });
      a.state = "waiting";
      this.resolveCollision(a, blocker, tpa);
      return;
    }
    this.resolveCollision(a, blocker, tpa, () => finish(true));
  }

  /** R-51 item 2: who loses, then the 120-tick freeze. */
  resolveCollision(a, blocker, tpa, finish) {
    const moving = (s) => s.state === "moving";
    let loser;
    if (moving(a) !== moving(blocker)) loser = moving(a) ? blocker : a; // a stationary sprite loses to a moving one
    else if (a.controlled !== blocker.controlled) loser = a.controlled ? blocker : a; // the user-controlled player wins
    else if (tpa !== this.tpaFor(blocker)) loser = tpa < this.tpaFor(blocker) ? blocker : a; // the faster sprite wins
    else loser = this.drawId(a) > this.drawId(blocker) ? a : blocker; // the larger drawId loses
    const winner = loser === a ? blocker : a;
    // Owner 2026-11-07: resolve priority first, then end the blocked direct step.
    finish?.();
    if (loser.state !== "frozen") {
      loser.state = "frozen";
      loser.cur = null;
      loser.waitLeft = 0;
      loser.frozenUntil = this.tick + FREEZE_TICKS; // frozen on ticks F .. F + 119 whatever the iteration order
      this.emit("sprite-collision", { winner: winner.id, loser: loser.id });
    }
  }

  movementPhase() {
    for (const a of this.ordered) this.moveActor(a);
  }

  // ---------------------------------------------------------------- edges (E-28, R-53)

  edgesPhase() {
    const p = this.player;
    if (!p.pendingExit) return;
    const dir = p.pendingExit;
    p.pendingExit = null;
    const link = this.board.links?.[dir] ?? null;
    if (link === null) {
      this.emit("edge-blocked", { dir });
      return;
    }
    if (link.program) {
      this.emit("program-link", { dir, program: link.program });
      return;
    }
    const dest = this.boards.get(link.board);
    const [l, u, r, d] = [p.base[0][0], p.base[0][1], p.base[1][0], p.base[2][1]];
    let ax;
    let ay;
    const clamp = (v, lo, hi) => (lo > hi ? null : Math.max(lo, Math.min(hi, v)));
    if (dir === "E" || dir === "W") {
      ax = dir === "E" ? -l : dest.w * FP - r;
      ay = clamp(p.y, -u, dest.h * FP - d);
    } else {
      ay = dir === "S" ? -u : dest.h * FP - d;
      ax = clamp(p.x, -l, dest.w * FP - r);
    }
    let blocked = ax === null || ay === null;
    if (!blocked) {
      const base = translate(p.base, ax, ay);
      blocked = dest.vectors.some((v) => v.layer === p.layer && v.type === "solid" && hitsVector(base, v));
    }
    if (blocked) {
      this.emit("arrival-rejected", { dir, board: link.board, x: ax === null ? null : ax / FP, y: ay === null ? null : ay / FP });
      return;
    }
    this.emit("board-link", { dir, from: this.boardId, to: link.board });
    this.switchBoard(link.board, ax / FP, ay / FP, p.layer, null);
  }

  switchBoard(id, x, y, layer, from) {
    this.installBoard(id);
    this.enterBoard(x, y, layer, from);
  }

  performSend() {
    const op = this.pendingSend;
    this.pendingSend = null;
    this.emit("send-swap", { board: op.board });
    const caller = op.caller ?? null;
    if (caller !== null && caller.kind === "board") this.emit("caller-killed", { thread: caller.id });
    // send() names a position in the destination board's coordinate mode: these scenes' boards are
    // plain (no pixel-coordinate flag), so x/y are one-based tiles and the layer is one-based (below 1 means layer 1).
    this.switchBoard(op.board, (op.x - 1) * 32 + 16, (op.y - 1) * 32 + 31, Math.max(1, op.layer) - 1, caller);
    if (caller !== null && caller.kind !== "board") this.emit("caller-resume", { thread: caller.id });
  }

  // ---------------------------------------------------------------- triggers (E-40..E-45, R-52)

  triggersPhase() {
    const p = this.player;
    const stepEvent = p.stepDone;
    p.stepDone = false;
    const keyEvent = Boolean(this.activateKey);
    this.activateKey = false;
    if (this.lock) {
      if (p.cur === null && p.queue.length === 0) {
        this.lock = false;
        this.walked = 0;
        this.lastCell = this.cellOf(p);
      }
      return false;
    }
    let stepped = false;
    if (stepEvent) {
      this.evaluate("step");
      stepped = true;
    }
    if (keyEvent) this.evaluate("key");
    this.walked = stepEvent ? 0 : this.walked;
    return stepped;
  }

  condOk(c) {
    return c === null || c === undefined || this.vars[c.var] === c.value;
  }

  evaluate(kind) {
    const p = this.player;
    const base = translate(p.base, p.x, p.y);
    const regions = this.board.programs.filter((r) => r.layer === p.layer && !this.gone.has(r.id));
    const items = this.items.filter((i) => i.visible && i.trigger !== null && i.layer === p.layer && !this.gone.has(`item:${i.id}`));
    // Re-arm on leaving (E-40, E-42): a trigger whose area the player is no longer in forgets its state.
    if (kind === "step") {
      for (const r of this.board.programs) if (!(r.layer === p.layer && overlaps(base, r.points))) { this.fired.delete(r.id); this.repeat.delete(r.id); }
      for (const i of this.items) if (!(i.visible && i.layer === p.layer && i.trigger !== null && overlaps(base, translate(i.act, i.x, i.y)))) { this.fired.delete(`item:${i.id}`); this.repeat.delete(`item:${i.id}`); }
    }
    const typeOk = (t) => (kind === "step" ? t === "step" || t === "repeat" : t === "key");
    const qualifies = (id, trig) => {
      if (!typeOk(trig.type) || !this.condOk(trig.condition)) return false;
      if (trig.type === "step") return !this.fired.has(id);
      if (trig.type === "repeat") {
        const c = (this.repeat.get(id) ?? 0) + this.walked;
        this.repeat.set(id, c);
        return !this.fired.has(id) || c >= trig.distanceRepeat * FP;
      }
      return true;
    };
    const itemQ = items.filter((i) => overlaps(base, translate(i.act, i.x, i.y)) && qualifies(`item:${i.id}`, i.trigger));
    const fv = DIRV[p.facing];
    itemQ.sort((l, r) => {
      const front = (i) => fv[0] * (i.x - p.x) + fv[1] * (i.y - p.y);
      const dist = (i) => (i.x - p.x) ** 2 + (i.y - p.y) ** 2;
      return front(r) - front(l) || dist(l) - dist(r) || l.index - r.index;
    });
    if (itemQ.length > 0) {
      const item = itemQ[0];
      item.facing = facingOf(p.x - item.x, p.y - item.y);
      this.emit("item-faces-player", { item: item.id });
      this.clearQueue(p, item.id);
      this.fire(`item:${item.id}`, "item", item.id, item.trigger);
      return;
    }
    const regionQ = regions.filter((r) => overlaps(base, r.points) && qualifies(r.id, r));
    if (regionQ.length > 0) {
      const region = regionQ[regionQ.length - 1]; // last in stored board order wins
      if (region.stopMovement) this.clearQueue(p, region.id);
      this.fire(region.id, "region", region.id, region);
    }
  }

  clearQueue(a, by) {
    if (a.queue.length === 0 && a.cur === null) return;
    a.queue.length = 0;
    a.cur = null;
    a.wp = null;
    a.state = "waiting";
    a.cadence = 0;
    this.emit("queue-cleared", { actor: a.id, by });
  }

  fire(key, kind, id, trig) {
    this.fired.add(key);
    this.repeat.set(key, 0);
    this.firedList = [...(this.firedList ?? []), { kind, id, program: trig.program }];
    let aborted = false;
    for (const op of trig.ops ?? []) {
      if (op.op === "set") this.setVar(op.var, op.value);
      else if (op.op === "gone") { this.gone.add(key); this.emit("gone", { trigger: id }); }
      else if (op.op === "abort") aborted = true;
      else if (op.op === "silentMove") {
        this.pushDirs(this.player, op.dirs, false);
        this.lock = true;
        this.emit("silent-move", { dirs: op.dirs });
      }
    }
    if (!aborted && trig.set) this.setVar(trig.set.var, trig.set.value); // set only after the program completes
    if (aborted) this.emit("program-aborted", { trigger: id });
  }

  // ---------------------------------------------------------------- random encounter (plugins-and-battle.md#random-encounters)

  battlePhase(stepped) {
    const b = this.board.battle;
    const p = this.player;
    if (!stepped || !b || !this.setup.fightEnabled) return;
    const cell = this.cellOf(p);
    if (cell[0] === this.lastCell[0] && cell[1] === this.lastCell[1]) return;
    this.lastCell = cell;
    this.emit("tile-moved", { cell });
    if (!b.allowed) return;
    let fight = false;
    if (b.type === 0) fight = this.draw(b.chances) === 0;
    else {
      this.encounter.tiles += 1;
      if (this.encounter.tiles >= b.chances) {
        this.encounter.tiles = 0;
        fight = true;
      }
    }
    if (!fight) return;
    if (this.setup.customFight) {
      this.emit("custom-fight-program", { program: this.setup.customFight });
      return;
    }
    const pool = (this.setup.encounterTable ?? []).filter((e) => e.skill === b.skill);
    if (pool.length === 0) {
      this.emit("message", { text: `No enemies of skill level ${b.skill} found.` });
      return;
    }
    const count = 1 + this.draw(4);
    const enemies = [];
    for (let i = 0; i < count; i += 1) enemies.push(pool[this.draw(pool.length)].enemy);
    this.emit("fight-handoff", { board: this.boardId, player: p.id, x: p.x / FP, y: p.y / FP, layer: p.layer, enemies, background: b.background });
  }

  // ---------------------------------------------------------------- animation (E-21, character.md fall-backs)

  resolveWalk(a, facing) {
    const w = a.anims.walk ?? {};
    const name = FACINGS[facing];
    if (w[name]) return { key: `walk.${name}`, spec: w[name] };
    if (name.length === 2) {
      const h = name.endsWith("E") ? "E" : "W"; // a missing diagonal falls back to the nearest horizontal direction
      if (w[h]) return { key: `walk.${h}`, spec: w[h] };
    }
    return null;
  }
  resolveIdle(a, facing) {
    const i = a.anims.idle ?? {};
    const name = FACINGS[facing];
    if (i[name]) return { key: `idle.${name}`, spec: i[name] };
    if (name.length === 2) {
      const h = name.endsWith("E") ? "E" : "W";
      if (i[h]) return { key: `idle.${h}`, spec: i[h] };
    }
    return this.resolveWalk(a, facing); // a missing idle animation uses the walk animation
  }
  playStance(a, name) {
    const spec = a.anims.stances[name];
    a.state = "stance";
    a.stance = { name, spec, frame: 0, ticks: 0 };
    a.anim = `stance.${name}`;
    a.frame = 0;
    a.animTicks = 0;
    a.held = false;
    this.emit("stance-start", { actor: a.id, stance: name });
  }
  animationPhase() {
    for (const a of this.actors) {
      if (a.anims === null || !a.visible) continue;
      if (a.state === "stance" && a.stance !== null) {
        const s = a.stance;
        if (!a.held) {
          s.ticks += 1;
          if (s.ticks >= msToTicks(s.spec.delayMs)) {
            s.ticks = 0;
            s.frame += 1;
          }
          if (s.frame >= s.spec.frames) {
            if (s.spec.hold) {
              s.frame = s.spec.frames - 1;
              a.held = true;
              this.emit("stance-complete", { actor: a.id, held: true });
            } else {
              a.state = "waiting";
              a.stance = null;
              this.emit("stance-complete", { actor: a.id, held: false });
            }
          }
        }
        if (a.stance !== null) {
          a.anim = `stance.${s.name}`;
          a.frame = s.frame;
          continue;
        }
      }
      let res = null;
      let advance = false;
      if (a.state === "moving") {
        res = this.resolveWalk(a, a.facing);
        advance = true;
      } else if (a.state === "waiting") {
        a.idleCount += 1;
        if (a.idleCount >= msToTicks(a.idleMs) && this.resolveIdle(a, a.facing) !== null) a.state = "idling";
        else res = this.resolveWalk(a, a.facing); // standing pose: the walk animation held at frame 0
      }
      if (a.state === "idling") {
        res = this.resolveIdle(a, a.facing);
        advance = true;
      }
      if (res === null) {
        a.anim = null;
        continue;
      }
      const label = `${res.key}/${a.state}`;
      if (label !== a.animLabel) {
        a.animLabel = label;
        a.anim = res.key;
        a.frame = 0;
        a.animTicks = 0;
      }
      if (advance) {
        a.animTicks += 1;
        if (a.animTicks >= msToTicks(res.spec.delayMs)) {
          a.animTicks = 0;
          a.frame = (a.frame + 1) % res.spec.frames;
        }
      }
    }
  }

  // ---------------------------------------------------------------- tick

  step(t, ops) {
    this.tick = t;
    this.ev = [];
    this.firedList = [];
    this.changed = null;
    if (this.pendingSend !== null) this.performSend();
    for (const op of ops) this.applyScript(op);
    this.wakeThreads();
    this.runThreads();
    this.movementPhase();
    this.edgesPhase();
    const stepped = this.triggersPhase();
    this.battlePhase(stepped);
    this.animationPhase();
    return this.row(t);
  }

  row(t) {
    const row = {
      t,
      a: this.actors.map((a) => {
        const base = [a.id, a.x / FP, a.y / FP, a.layer, a.visible ? a.state : "hidden", FACINGS[a.facing]];
        return a.anims === null ? base : [...base, a.anim, a.frame];
      }),
    };
    if (this.firedList.length > 0) row.fired = this.firedList;
    if (this.changed) row.vars = this.changed;
    if (this.threads.length > 0) row.th = Object.fromEntries(this.threads.map((th) => [th.id, th.status]));
    if (this.ev.length > 0) row.ev = this.ev;
    return row;
  }
}

/** Run a case: `setup`, recorded `script` ops `{ t, op, ... }` and a tick count. Returns the boot facts and one row per tick. */
export function simulate(setup, script, ticks) {
  const world = new World(setup);
  const boot = world.ev.splice(0); // the hydrated actors and the first board-entry records, before tick 0 runs
  const rows = [];
  for (let t = 0; t < ticks; t += 1) rows.push(world.step(t, script.filter((op) => op.t === t)));
  return { boot, rows };
}
