// Reference input model for the movement oracle (ticket 5.2): recorded keyboard,
// pointer and normalized gamepad events become held actions, key-queue entries,
// an eight-way movement intent, click-to-move requests and on-screen button
// slots. Pointer slots activate on release over the pressed slot; pointer.cancel
// clears the pending slot and primary bit without a release edge or click.
// Written from docs/spec/engine/display-input-audio.md#e-110..e-113,
// #reawakened-gamepad-contract and accessibility.md#a11y-6; it imports nothing
// from packages/core. Choices the spec leaves open are tagged `PROPOSED P-n`.

const DIR_ACTIONS = ["up", "down", "left", "right"];
const BIT_ACTIONS = ["up", "down", "left", "right", "confirm", "cancel", "menu"]; // normalized internal action order
const DEAD_ZONE = 250;

const PAD_BIT_ACTIONS = { 0: "confirm", 1: "cancel", 9: "menu", 12: "up", 13: "down", 14: "left", 15: "right", 17: "left", 18: "right", 19: "up", 20: "down" };

function physicalPadMask(event) {
  let mask = event.buttons & 0x1ffff;
  if (Math.abs(event.axes.x) >= DEAD_ZONE) mask |= 1 << (event.axes.x < 0 ? 17 : 18);
  if (Math.abs(event.axes.y) >= DEAD_ZONE) mask |= 1 << (event.axes.y < 0 ? 19 : 20);
  return mask;
}

/** Convert physical W3C buttons and axes to the reference model's internal action mask (E-112). */
export function padMask(event) {
  const physical = physicalPadMask(event);
  const controls = [[12, 0], [13, 1], [14, 2], [15, 3], [0, 4], [1, 5], [9, 6], [19, 0], [20, 1], [17, 2], [18, 3]];
  let mask = 0;
  for (const [bit, action] of controls) if ((physical & (1 << bit)) !== 0) mask |= 1 << action;
  return mask;
}

const INTENT = { "0,-1": "N", "1,-1": "NE", "1,0": "E", "1,1": "SE", "0,1": "S", "-1,1": "SW", "-1,0": "W", "-1,-1": "NW" };

/** Run a recorded input case; returns one fact row per tick. */
export function runInput(setup, events, ticks) {
  const bound = new Set(Object.values(setup.bindings.keys));
  const keyboard = new Set(); // actions the keyboard holds
  const pads = new Map(); // device -> { connected, mask, physicalMask }
  const order = []; // direction actions in press order (PROPOSED P-12: later press wins on a blocked diagonal)
  let seq = setup.firstSeq ?? 1;
  const slots = new Map(setup.slots.map((s) => [s.id, { ...s }]));
  let pointerButtons = 0;
  let pressedButtonSlot = null;
  const rows = [];
  let prev = new Set();
  const heldNow = () => {
    const set = new Set(keyboard);
    for (const pad of pads.values()) {
      if (!pad.connected) continue;
      BIT_ACTIONS.forEach((action, bit) => { if (pad.mask & (1 << bit)) set.add(action); });
    }
    for (const action of [...set]) if (!bound.has(action)) set.delete(action); // a gamepad adds nothing the bindings do not name
    return set;
  };
  for (let t = 0; t < ticks; t += 1) {
    const row = { t };
    const queue = [];
    const notes = [];
    for (const e of events.filter((x) => x.t === t)) {
      let physicalOrder = [];
      const ev = e.ev;
      if (ev.kind === "key") {
        const action = setup.bindings.keys[ev.code];
        if (action === undefined) { notes.push(`ignored:unbound:${ev.code}`); continue; }
        if (ev.down) {
          if (ev.repeat) { notes.push(`ignored:repeat:${ev.code}`); continue; }
          keyboard.add(action);
        } else keyboard.delete(action);
      } else if (ev.kind === "gamepad") {
        if (!Number.isInteger(ev.device) || ev.device < 0 || ev.device > 3) { notes.push(`ignored:device:${ev.device}`); continue; }
        const pad = pads.get(ev.device);
        const previousPhysical = pad?.physicalMask ?? 0;
        const currentPhysical = ev.connected ? physicalPadMask(ev) : 0;
        for (let bit = 0; bit <= 20; bit += 1) {
          if (((previousPhysical ^ currentPhysical) & (1 << bit)) === 0 || (currentPhysical & (1 << bit)) === 0) continue;
          const action = PAD_BIT_ACTIONS[bit];
          if (action !== undefined && bound.has(action) && !physicalOrder.includes(action)) physicalOrder.push(action);
        }
        if (!ev.connected) {
          if (pad === undefined) { notes.push(`ignored:never-connected:${ev.device}`); continue; }
          pad.connected = false;
          pad.mask = 0;
          pad.physicalMask = 0;
          notes.push(`disconnect:${ev.device}`);
        } else if (pad === undefined) pads.set(ev.device, { connected: true, mask: padMask(ev), physicalMask: currentPhysical });
        else { pad.connected = true; pad.mask = padMask(ev); pad.physicalMask = currentPhysical; }
      } else if (ev.kind === "pointer.cancel") {
        pointerButtons &= ~1;
        pressedButtonSlot = null;
        continue;
      } else if (ev.kind === "pointer") {
        const wasPrimaryDown = (pointerButtons & 1) !== 0;
        const buttons = Number(ev.buttons ?? (ev.phase === "up" ? 0 : 1));
        const isPrimaryDown = (buttons & 1) !== 0;
        const slot = [...slots.values()].find((s) => ev.x >= s.x && ev.x < s.x + s.w && ev.y >= s.y && ev.y < s.y + s.h);
        pointerButtons = buttons;
        if (!wasPrimaryDown && isPrimaryDown) {
          if (slot !== undefined && !slot.enabled) notes.push(`slot-disabled:${slot.id}`);
          pressedButtonSlot = slot?.enabled === true ? slot.id : null;
        } else if (wasPrimaryDown && pressedButtonSlot !== null) {
          if (slot?.id !== pressedButtonSlot || !slot.enabled) {
            pressedButtonSlot = null;
          } else if (!isPrimaryDown) {
            queue.push({ seq, key: slot.action, via: `slot:${slot.id}` });
            seq += 1;
            row.slot = slot.id;
            pressedButtonSlot = null;
          }
        }
        if (isPrimaryDown && slot === undefined) {
          const cam = setup.camera ?? [0, 0];
          row.click = { logical: [ev.x, ev.y], board: [ev.x + cam[0], ev.y + cam[1]], via: "pathfind" };
        }
        continue;
      } else if (ev.kind === "slot-enabled") {
        slots.get(ev.id).enabled = ev.enabled;
        notes.push(`slot:${ev.id}:${ev.enabled ? "enabled" : "disabled"}`);
        continue;
      }
      // Gamepad transitions follow ascending changed physical controls; non-pad ties use the reference action order.
      const after = heldNow();
      const pressed = [...after].filter((a) => !prev.has(a)).sort((l, r) => {
        const li = physicalOrder.indexOf(l);
        const ri = physicalOrder.indexOf(r);
        if (li >= 0 || ri >= 0) return (li < 0 ? Number.MAX_SAFE_INTEGER : li) - (ri < 0 ? Number.MAX_SAFE_INTEGER : ri);
        return BIT_ACTIONS.indexOf(l) - BIT_ACTIONS.indexOf(r);
      });
      for (const action of pressed) { queue.push({ seq, key: action }); seq += 1; if (DIR_ACTIONS.includes(action)) order.push(action); }
      for (const action of prev) if (!after.has(action)) { const i = order.indexOf(action); if (i >= 0) order.splice(i, 1); }
      prev = after;
    }
    const held = prev;
    row.held = [...held].sort((l, r) => BIT_ACTIONS.indexOf(l) - BIT_ACTIONS.indexOf(r));
    let x = (held.has("right") ? 1 : 0) - (held.has("left") ? 1 : 0);
    let y = (held.has("down") ? 1 : 0) - (held.has("up") ? 1 : 0);
    if (x !== 0 && y !== 0 && !setup.allowDiagonals) {
      // PROPOSED P-12: with diagonals off, the most recently pressed direction wins.
      const last = [...order].reverse().find((a) => held.has(a));
      if (last === "left" || last === "right") y = 0; else x = 0;
    }
    row.intent = INTENT[`${x},${y}`] ?? null;
    if (queue.length > 0) row.queue = queue;
    if (notes.length > 0) row.notes = notes;
    row.slots = [...slots.values()].filter((s) => s.enabled).map((s) => s.id);
    rows.push(row);
  }
  return rows;
}
