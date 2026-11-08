// #1778 research (Opus): project decoded legacy models into an EXPERIMENTAL
// logical document set (actor / item / skill / effect / clip / scene / tiles /
// environment / project). Notation-neutral: documents are plain JSON-model
// values written as .json only so later steps can emit every notation from the
// same data. Not an importer, not an approved schema, no proof of playability.
//
//   node project.mjs --decoded <scratch>/decoded --out <scratch>/projection
//
// Reads decode-cohort.mjs output (manifest + per-file models). Writes, per game:
//   model/**.json        logical documents (one per projected owner)
//   provenance.json      source file + sha256 -> projected documents
//   accounting.json      every decoded field path: mapped / compat / dropped
//                        (reason) / unaccounted, with non-default counts
//   diagnostics.json     unresolved references seen while projecting
// Semantics come from docs/spec/formats/*.md (board, item, character, enemy,
// battle-data, animation, tiles, main-file).
import { mkdirSync, readFileSync, writeFileSync, rmSync, copyFileSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i < 0 ? undefined : args[i + 1]; };
const decodedRoot = opt('--decoded');
const outRoot = opt('--out');
const onlyGame = opt('--game');
if (!decodedRoot || !outRoot) throw new Error('--decoded and --out are required');
const manifest = JSON.parse(readFileSync(join(decodedRoot, 'manifest.json'), 'utf8'));

const fold = (p) => p.replaceAll('\\', '/').toLowerCase();
const isUndef = (v) => v && typeof v === 'object' && v.$undefined === true;
const has = (v) => v !== undefined && !isUndef(v) && v !== '' && v !== null;
export function slug(text) {
  return text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/\.[a-z0-9]+$/, '').replace(/['’]/g, '').replace(/[^a-z0-9/]+/g, '-')
    .replace(/-+/g, '-').replace(/(^|\/)-|-($|\/)/g, '$1$2') || 'unnamed';
}

// ---- field accounting -------------------------------------------------------
// Every decoded field path of a format is either consumed by a projection rule
// or listed here with the reason it is not authored data in the projection.
const DROPPED = {
  '*': { magic: 'format signature', major: 'format version (provenance keeps it)', minor: 'format version (provenance keeps it)', residue: 'trailing bytes; reported in accounting when non-empty' },
  board: { tileRuns: 'run-length view of tileMatrix (same cells)', 'programs[].handle': 'unused by every cohort board (0 non-empty)', 'sprites[].reserved': 'reserved; editor writes -1', 'programs[].closed': 'trigger areas are always closed in the cohort (-1); kept as closed flag only when 0', coordType: 'kept as compat.tk3.coordType' },
  item: { reservedAnimation: 'unused slot', sizeType: 'legacy, ignored by engine (item.md field 21)' },
  character: { sizeType: 'legacy, ignored (character.md field 27)' },
  gam: { registrationFlag: 'licence/registration metadata, not game data', registrationCode: 'licence/registration metadata, not game data; never copied', projectPath: 'machine-specific editor path', disableProtectReg: 'registration UI flag', languageFile: 'editor-only resource (native-data-boundaries README)' },
  'tile-animation': { frameCount: 'equals frames length' },
  tileset: { 'tiles[].pixels': 'binary pixel payload stays in the binary tileset', 'detail.code': 'binary tileset header', 'detail.bytesPerPixel': 'binary tileset header', 'detail.size': 'binary tileset header', 'detail.isometric': 'binary tileset header', version: 'binary tileset header' },
  font: { values: 'bitmap font pixels stay binary', magic: 'format signature', version: 'format version', subversion: 'format version' },
};
// main-file.md fields with no forward owner chosen by this research. Any
// non-default value is preserved verbatim in project compat.tk3.unprojected.
const GAM_UNPROJECTED = ['audioSettings', 'cursorCancelSound', 'cursorEnabled', 'cursorMoveSound', 'cursorSelectSound', 'dayLengthMinutes', 'dayNightType', 'drawVectorsFlags', 'hotSpotX', 'hotSpotY', 'mouseCursor', 'movementControls', 'movementScanCodes', 'pathColor', 'pathfindHeuristic', 'resX', 'resY', 'showFpsInTitle', 'transparent', 'useDayNight', 'useJoystick'];

class Accounting {
  constructor() { this.rows = new Map(); }
  touch(format, path, rule) { const k = `${format}|${path}`; const r = this.rows.get(k) ?? { format, field: path, files: 0, nonDefault: 0, status: null, detail: null }; if (rule) { r.status = rule.status; r.detail = rule.detail; } this.rows.set(k, r); return r; }
  observe(format, model) {
    const visit = (v, p) => {
      if (isUndef(v)) { const r = this.touch(format, p); r.files++; r.undefinedInModel = (r.undefinedInModel ?? 0) + 1; return; }
      if (v && typeof v === 'object' && !Array.isArray(v)) { for (const [k, x] of Object.entries(v)) visit(x, p ? `${p}.${k}` : k); return; }
      if (Array.isArray(v) && v.length && v[0] && typeof v[0] === 'object' && !Array.isArray(v[0]) && !p.endsWith('pixels')) { for (const x of v) visit(x, `${p}[]`); return; }
      const r = this.touch(format, p); r.files++;
      const nd = Array.isArray(v) ? v.some((x) => x !== '' && x !== 0 && x !== null) : !(v === '' || v === 0 || v === null || v === false);
      if (nd) r.nonDefault++;
    };
    visit(model, '');
  }
  mark(format, path, status, detail) { const r = this.touch(format, path); if (!r.status || r.status === 'unaccounted') { r.status = status; r.detail = detail ?? null; } }
  finish() {
    for (const r of this.rows.values()) {
      if (r.status) continue;
      const base = r.field.split(/[.[]/)[0];
      const d = DROPPED[r.format]?.[r.field] ?? DROPPED[r.format]?.[base] ?? DROPPED['*'][r.field];
      if (d) { r.status = 'not-projected'; r.detail = d; } else r.status = 'unaccounted';
    }
    return [...this.rows.values()].sort((a, b) => `${a.format}|${a.field}`.localeCompare(`${b.format}|${b.field}`, 'en'));
  }
}

// ---- per-game projection ----------------------------------------------------
function projectGame(game) {
  const { root, files } = manifest.games[game];
  const decoded = new Map(); // folded path -> {row, model}
  const programs = new Map(); // folded Prg-relative -> path
  const media = new Map(); // folded basename-in-folder -> path
  for (const row of files) {
    if (row.status === 'decoded') decoded.set(fold(row.path), { row, model: JSON.parse(readFileSync(join(decodedRoot, game, `${row.path}.json`), 'utf8')) });
    if (row.path.toLowerCase().startsWith('prg/')) programs.set(fold(row.path.slice(4)), row.path);
    if (row.status === 'media-hashed-not-decoded') media.set(fold(row.path), row.path);
  }
  const acct = new Accounting();
  const docs = new Map(); // doc path -> value
  const provenance = [];
  const diagnostics = [];
  const ids = new Map(); // `${kind}|${folded legacy path}` -> id
  const used = new Map();
  function idFor(kind, legacyPath) {
    const k = `${kind}|${fold(legacyPath)}`;
    if (ids.has(k)) return ids.get(k);
    let base = slug(legacyPath.replaceAll('\\', '/')), id = base, n = 2;
    while (used.has(`${kind}|${id}`)) id = `${base}-${n++}`;
    used.set(`${kind}|${id}`, k); ids.set(k, id); return id;
  }
  const lookup = (folder, name) => decoded.get(fold(`${folder}/${name}`));
  let produced = [];
  const put = (path, value, source) => { docs.set(path, value); produced.push(path); provenance.push({ document: path, source: source.path, sha256: source.sha256, storedVersion: source.storedMajor != null ? `${source.storedMajor}.${source.storedMinor}` : source.major != null ? `${source.major}.${source.minor}` : null }); };
  const seen = new Set();
  const diag = (where, kind, value, note) => { const k = `${where}|${kind}|${value}`; if (seen.has(k)) return; seen.add(k); diagnostics.push({ where, kind, value, note }); };

  // References ---------------------------------------------------------------
  function script(text, where) {
    if (!has(text)) return undefined;
    const p = programs.get(fold(text));
    if (p) return { program: `scripts/${p.slice(4).replaceAll('\\', '/')}` };
    // docs/spec/formats/board.md field 26: a program field is inline RPGCode
    // when no such file exists. Mirror the census screen: punctuation and no
    // .prg/.rnc suffix -> inline; otherwise an unresolved file reference.
    if (!/\.(?:prg|rnc)$/i.test(text.trim()) && /[();{}\n]|^\s*#/.test(text)) return { inline: text };
    diag(where, 'program', text, 'no such file under Prg/; kept as an unresolved program reference');
    return { program: `scripts/${text.replaceAll('\\', '/')}` };
  }
  function clip(text, where) {
    if (!has(text)) return undefined;
    if (lookup('Misc', text)) return idFor('clip', text);
    diag(where, 'clip', text, 'no decoded .anm under Misc/');
    return idFor('clip', text);
  }
  const assetFolders = { image: ['Bitmap', 'media/images'], audio: ['Media', 'media/audio'] };
  function asset(kind, text, where) {
    if (!has(text)) return undefined;
    const [legacy, native] = assetFolders[kind];
    const hit = media.get(fold(`${legacy}/${text}`));
    if (!hit) diag(where, kind, text, `no file under ${legacy}/`);
    return `${native}/${(hit ? hit.slice(legacy.length + 1) : text).replaceAll('\\', '/')}`;
  }
  function tile(text, where) {
    if (!has(text)) return undefined;
    const m = /^(.*\.(?:tst|iso))(\d+)$/i.exec(text);
    if (m) {
      if (!decoded.has(fold(`Tiles/${m[1]}`))) diag(where, 'tileset', m[1], 'no decoded tileset under Tiles/');
      return { tileset: idFor('tileset', m[1]), tile: Number(m[2]) };
    }
    if (/\.tan$/i.test(text)) return { animation: idFor('tile-animation', text) };
    if (/\.gph$/i.test(text)) return { single: text };
    diag(where, 'tile', text, 'unrecognised tile reference');
    return { unresolved: text };
  }
  const ref = (kind, folder, text, where) => {
    if (!has(text)) return undefined;
    if (!lookup(folder, text)) diag(where, kind, text, `no decoded file under ${folder}/`);
    return idFor(kind, text);
  };
  const colour = (c) => [c.r, c.g, c.b];
  const pts = (list) => list.map((p) => [p.x, p.y]);
  const prune = (o) => {
    if (Array.isArray(o)) return o.map(prune);
    if (o && typeof o === 'object') {
      const r = {};
      for (const [k, v] of Object.entries(o)) {
        const x = prune(v);
        if (x === undefined) continue;
        if (x && typeof x === 'object' && (Array.isArray(x) ? x.length === 0 : Object.keys(x).length === 0)) continue;
        r[k] = x;
      }
      return r;
    }
    return o;
  };
  const dirs = ['south', 'north', 'east', 'west', 'northwest', 'northeast', 'southwest', 'southeast'];
  const dirMap = (list, where) => { if (!Array.isArray(list)) return undefined; const o = {}; list.forEach((v, i) => { const c = clip(v, where); if (c) o[dirs[i]] = c; }); return o; };
  const mark = (format, fields, status = 'mapped', detail) => { for (const f of fields) acct.mark(format, f, status, detail); };

  // Which .itm files appear on boards: world presence evidence.
  const placedItems = new Set();
  for (const [p, { model, row }] of decoded) if (row.format === 'board') for (const s of model.sprites) if (has(s.itemFile)) placedItems.add(fold(`Item/${s.itemFile}`));

  for (const [path, { row, model }] of decoded) {
    acct.observe(row.format, model);
    produced = [];
    const where = row.path;
    switch (row.format) {
      case 'character': {
        const id = idFor('actor', row.path.replace(/^Chrs\//i, ''));
        const walk = dirMap(model.movementAnimations, where), idle = dirMap(model.idleAnimations, where);
        const stanceNames = ['fight', 'defend', 'special', 'die', 'rest'];
        const stances = {}; if (Array.isArray(model.battleStances)) model.battleStances.slice(0, 5).forEach((v, i) => { const c = clip(v, where); if (c) stances[stanceNames[i]] = c; });
        const custom = Array.isArray(model.customStances) ? model.customStances.filter((s) => has(s.animation) && has(s.handle)).map((s) => ({ name: s.handle, clip: clip(s.animation, where) })) : undefined;
        const lg = isUndef(model.legacyGraphics) ? undefined : model.legacyGraphics;
        put(`actors/${id}`, prune({
          kind: 'actor', id, name: model.name,
          presence: {
            portrait: has(model.profilePicture) ? (/\.(?:tst|iso)\d+$/i.test(model.profilePicture) ? { tile: tile(model.profilePicture, where) } : { image: asset('image', model.profilePicture, where) }) : undefined,
            clips: { walk, idle, custom },
            timing: isUndef(model.speed) ? undefined : { secondsPerFrame: model.speed, idleAfterSeconds: model.idleTime },
            collision: isUndef(model.vectorBases) ? undefined : pts(model.vectorBases[0].points),
            activation: isUndef(model.vectorBases) ? undefined : pts(model.vectorBases[1].points),
            legacyTiles: lg ? { walk: lg.walkFrames.map((f) => [tile(f.top, where), tile(f.bottom, where)].map((t) => t ?? null)), rest: lg.restTiles.map((t) => tile(t, where) ?? null), battle: lg.battleTiles.map((t) => tile(t, where) ?? null), custom: lg.customFrames.map((f) => [tile(f.top, where), tile(f.bottom, where)].map((t) => t ?? null)) } : undefined,
          },
          character: {
            statVariables: { experience: model.variableNames[0], defence: model.variableNames[1], fight: model.variableNames[2], health: model.variableNames[3], maxHealth: model.variableNames[4], name: model.variableNames[5], specialPower: model.variableNames[6], maxSpecialPower: model.variableNames[7], level: model.variableNames[8] },
            initialStats: { experience: model.stats.experience, hp: model.stats.hp, maxHp: model.stats.maxHp, dp: model.stats.dp, fp: model.stats.fp, smp: model.stats.smp, maxSmp: model.stats.maxSmp, level: model.stats.level },
            progression: { firstLevelExperience: model.firstLevelExp, experienceIncrease: model.experienceIncrease, maxLevel: model.maxLevel, mode: model.levelUpType === 1 ? 'fixed' : 'percentage', perLevel: { hp: model.levelIncreases[0], dp: model.levelIncreases[1], fp: model.levelIncreases[2], smp: model.levelIncreases[3] }, onLevelUp: script(model.levelUpProgram, where) },
            skills: { menuLabel: has(model.specialMoveCategory) ? model.specialMoveCategory : undefined, enabled: model.hasSpecialMoves === 0, learnable: model.specialMoves.map((s, slot) => ({ s, slot })).filter(({ s }) => has(s.file)).map(({ s, slot }) => prune({ skill: ref('skill', 'SpcMove', s.file, where), slot, requires: { experience: s.minExp || undefined, level: s.minLevel || undefined, variable: has(s.condVar) ? { name: s.condVar, equals: s.condValue } : undefined } })) },
            equipment: { armourSlots: model.bodySlots.map((b, i) => ({ b, i })).filter(({ b, i }) => i > 0 && b).map(({ i }) => ['head', 'neck', 'left-hand', 'right-hand', 'body', 'legs'][i - 1]), accessorySlots: model.accessorySlots.filter(has) },
            combat: { stances, sounds: isUndef(model.battleSounds) || !model.battleSounds.some(has) ? undefined : model.battleSounds.map((s) => asset('audio', s, where) ?? null) },
          },
          compat: { tk3: { source: row.path } },
        }), row);
        mark('character', ['name', 'variableNames', 'stats.experience', 'stats.hp', 'stats.maxHp', 'stats.dp', 'stats.fp', 'stats.smp', 'stats.maxSmp', 'stats.level', 'profilePicture', 'specialMoves[].file', 'specialMoves[].minExp', 'specialMoves[].minLevel', 'specialMoves[].condVar', 'specialMoves[].condValue', 'specialMoveCategory', 'hasSpecialMoves', 'accessorySlots', 'bodySlots', 'firstLevelExp', 'experienceIncrease', 'maxLevel', 'levelIncreases', 'levelUpProgram', 'levelUpType', 'movementAnimations', 'idleAnimations', 'battleStances', 'customStances[].animation', 'customStances[].handle', 'customStances', 'idleTime', 'speed', 'vectorBases[].points[].x', 'vectorBases[].points[].y', 'vectorBases', 'legacyGraphics', 'legacyGraphics.walkFrames[].top', 'legacyGraphics.walkFrames[].bottom', 'legacyGraphics.restTiles', 'legacyGraphics.battleTiles', 'legacyGraphics.customFrames[].top', 'legacyGraphics.customFrames[].bottom', 'battleSounds']);
        break;
      }
      case 'item': {
        const legacyName = row.path.replace(/^Item\//i, '');
        const inventory = model.equipable || model.menuUsable || model.battleUsable || model.keyItem || model.buyPrice || model.sellPrice || has(model.description);
        const world = model.boardUsable || placedItems.has(path) || has(model.activationProgram) || has(model.multitaskProgram);
        let itemId;
        if (inventory || !world) {
          itemId = idFor('item', legacyName);
          put(`items/${itemId}`, prune({
            kind: 'item', id: itemId, name: model.name, description: has(model.description) ? model.description : undefined,
            value: { buy: model.buyPrice, sell: model.sellPrice }, keyItem: model.keyItem === 1 || undefined,
            equip: model.equipable ? { slots: model.equipSlots.map((b, i) => ({ b, i })).filter(({ b, i }) => i > 0 && b).map(({ i }) => ['head', 'neck', 'left-hand', 'right-hand', 'body', 'legs', 'accessory'][i - 1]), accessory: has(model.accessoryName) ? model.accessoryName : undefined, bonus: { hp: model.equipBonus[0], dp: model.equipBonus[1], fp: model.equipBonus[2], smp: model.equipBonus[3] }, onEquip: script(model.onEquipProgram, where), onRemove: script(model.onRemoveProgram, where) } : undefined,
            restrictedTo: model.usedBy === 1 ? model.allowedCharacters.filter(has) : undefined,
            menuUse: model.menuUsable ? { hp: model.menuUseHp, smp: model.menuUseSmp, run: script(model.menuUseProgram, where) } : undefined,
            battleUse: model.battleUsable ? { hp: model.battleUseHp, smp: model.battleUseSmp, run: script(model.battleUseProgram, where), clip: clip(model.battleAnimation, where) } : undefined,
            compat: { tk3: { source: row.path, flags: { equipable: model.equipable, menuUsable: model.menuUsable, boardUsable: model.boardUsable, battleUsable: model.battleUsable } } },
          }), row);
        }
        if (world) {
          const id = idFor('actor', legacyName);
          const lw = isUndef(model.legacyWalk) ? undefined : model.legacyWalk;
          put(`actors/${id}`, prune({
            kind: 'actor', id, name: model.name, item: itemId,
            presence: {
              clips: { walk: dirMap(model.movementAnimations, where), idle: dirMap(model.idleAnimations, where), held: !itemId ? clip(model.battleAnimation, where) : undefined, rest: clip(model.restAnimation, where), custom: Array.isArray(model.customStances) ? model.customStances.filter((s) => has(s.animation) && has(s.handle)).map((s) => ({ name: s.handle, clip: clip(s.animation, where) })) : undefined },
              timing: isUndef(model.speed) ? undefined : { secondsPerFrame: model.speed, idleAfterSeconds: model.idleTime },
              collision: isUndef(model.vectorBases) ? undefined : pts(model.vectorBases[0].points),
              activation: isUndef(model.vectorBases) ? undefined : pts(model.vectorBases[1].points),
              legacyTiles: lw ? { walk: lw.frames.map((f) => [tile(f.top, where) ?? null, tile(f.bottom, where) ?? null]), rest: lw.restTiles.map((t) => tile(t, where) ?? null) } : undefined,
            },
            behaviour: { onActivate: script(model.activationProgram, where), whilePresent: script(model.multitaskProgram, where) },
            compat: { tk3: { source: row.path } },
          }), row);
        }
        mark('item', ['name', 'description', 'buyPrice', 'sellPrice', 'keyItem', 'equipable', 'equipSlots', 'accessoryName', 'equipBonus', 'onEquipProgram', 'onRemoveProgram', 'usedBy', 'allowedCharacters', 'menuUsable', 'menuUseHp', 'menuUseSmp', 'menuUseProgram', 'battleUsable', 'battleUseHp', 'battleUseSmp', 'battleUseProgram', 'battleAnimation', 'boardUsable', 'movementAnimations', 'idleAnimations', 'restAnimation', 'customStances', 'customStances[].animation', 'customStances[].handle', 'speed', 'idleTime', 'vectorBases', 'vectorBases[].points[].x', 'vectorBases[].points[].y', 'legacyWalk', 'legacyWalk.frames[].top', 'legacyWalk.frames[].bottom', 'legacyWalk.restTiles', 'activationProgram', 'multitaskProgram']);
        break;
      }
      case 'enemy': {
        const id = idFor('actor', row.path.replace(/^Enemy\//i, ''));
        const stanceNames = ['fight', 'defend', 'special', 'die', 'rest', 'unused'];
        const stances = {}; model.stances.forEach((v, i) => { const c = clip(v, where); if (c) stances[stanceNames[i]] = c; });
        const skills = (list) => list.filter(has).map((s) => ref('skill', 'SpcMove', s, where));
        put(`actors/${id}`, prune({
          kind: 'actor', id, name: model.name,
          presence: { clips: { stances, custom: Array.isArray(model.customStances) ? model.customStances.filter((s) => has(s.animation) && has(s.handle)).map((s) => ({ name: s.handle, clip: clip(s.animation, where) })) : undefined }, tileGrid: Array.isArray(model.tileGrid) ? { width: model.width, height: model.height, tiles: model.tileGrid.map((t) => tile(t, where) ?? null) } : undefined },
          combatant: {
            stats: { hp: model.hp, smp: model.smp, fp: model.fp, dp: model.dp },
            critical: { onOneIn: model.criticalOn, multiplier: model.criticalBy },
            escape: { allowed: model.canRun === 1, run: script(model.runAwayProgram, where) },
            ai: { level: model.aiLevel, custom: model.customAi === 1 || undefined, run: script(model.aiProgram, where) },
            skills: skills(model.specialMoves), weaknesses: skills(model.weaknesses), strengths: skills(model.strengths),
            rewards: { experience: model.experienceReward, gold: model.goldReward },
            onDefeat: script(model.defeatProgram, where),
          },
          compat: { tk3: { source: row.path } },
        }), row);
        mark('enemy', ['name', 'hp', 'smp', 'fp', 'dp', 'canRun', 'criticalOn', 'criticalBy', 'specialMoves', 'weaknesses', 'strengths', 'aiLevel', 'customAi', 'aiProgram', 'experienceReward', 'goldReward', 'defeatProgram', 'runAwayProgram', 'stances', 'customStances', 'customStances[].animation', 'customStances[].handle', 'tileGrid', 'width', 'height']);
        break;
      }
      case 'special-move': {
        const id = idFor('skill', row.path.replace(/^SpcMove\//i, ''));
        put(`skills/${id}`, prune({
          kind: 'skill', id, name: model.name, description: has(model.description) ? model.description : undefined,
          cost: { smp: model.smpCost }, power: model.damage, drainsTargetSmp: model.targetSmpDrain || undefined,
          usable: { battle: model.usableInBattle === 0, menu: model.usableFromMenu === 1 },
          effect: ref('effect', 'StatusE', model.statusEffect, where), run: script(model.program, where),
          presentation: { clip: clip(model.animation, where) },
          compat: { tk3: { source: row.path, usableInBattleByte: model.usableInBattle } },
        }), row);
        mark('special-move', ['name', 'description', 'smpCost', 'damage', 'targetSmpDrain', 'usableInBattle', 'usableFromMenu', 'statusEffect', 'program', 'animation']);
        break;
      }
      case 'status-effect': {
        const id = idFor('effect', row.path.replace(/^StatusE\//i, ''));
        put(`effects/${id}`, prune({
          kind: 'effect', id, name: model.name, rounds: model.rounds,
          modifiers: { speedUp: model.speedUp === 1 || undefined, slowDown: model.slowDown === 1 || undefined, disable: model.disable === 1 || undefined },
          perRound: { hp: model.hpEnabled ? model.hpPerRound : undefined, smp: model.smpEnabled ? model.smpPerRound : undefined, run: model.runProgram ? script(model.program, where) : undefined },
          compat: { tk3: { source: row.path } },
        }), row);
        mark('status-effect', ['name', 'rounds', 'speedUp', 'slowDown', 'disable', 'hpEnabled', 'hpPerRound', 'smpEnabled', 'smpPerRound', 'runProgram', 'program']);
        break;
      }
      case 'animation': {
        const id = idFor('clip', row.path.replace(/^Misc\//i, ''));
        // Fixed-capacity legacy frame arrays: keep every slot up to the last
        // non-empty image or sound; trailing empty slots are capacity, not frames.
        let last = -1; model.frames.forEach((f, i) => { if (has(f.image) || has(f.sound)) last = i; });
        const frames = model.frames.slice(0, last + 1).map((f, i) => prune({
          id: `f${i + 1}`,
          image: /\.(?:tst|iso)\d+$/i.test(f.image) ? undefined : asset('image', f.image, where), tile: /\.(?:tst|iso)\d+$/i.test(f.image) ? tile(f.image, where) : undefined,
          transparent: colour(f.transparent), sound: asset('audio', f.sound, where),
        }));
        put(`clips/${id}`, prune({ kind: 'clip', id, size: [model.width, model.height], secondsPerFrame: model.delay, frames, compat: { tk3: { source: row.path, storedFrameSlots: model.frames.length } } }), row);
        mark('animation', ['width', 'height', 'delay', 'frames[].image', 'frames[].sound', 'frames[].transparent.r', 'frames[].transparent.g', 'frames[].transparent.b']);
        break;
      }
      case 'tile-animation': {
        const id = idFor('tile-animation', row.path.replace(/^Tiles\//i, ''));
        put(`tile-animations/${id}`, prune({ kind: 'tile-animation', id, speed: model.speed, frames: model.frames.map((t) => tile(t, where) ?? null), compat: { tk3: { source: row.path } } }), row);
        mark('tile-animation', ['speed', 'frames']);
        break;
      }
      case 'battle-background': {
        const id = idFor('environment', row.path.replace(/^Bkrounds\//i, ''));
        const composition = Array.isArray(model.tiles) ? gridOf(model.tiles.map((t) => tile(t, where)), model.tints, 19) : undefined;
        put(`environments/${id}`, prune({
          kind: 'environment', id, image: asset('image', model.image, where), music: asset('audio', model.music, where),
          sounds: { menuMove: asset('audio', model.menuMoveSound, where), menuChoose: asset('audio', model.menuChooseSound, where), ready: asset('audio', model.readySound, where), cannot: asset('audio', model.cantDoSound, where) },
          composition, compat: { tk3: { source: row.path } },
        }), row);
        mark('battle-background', ['image', 'music', 'menuMoveSound', 'menuChooseSound', 'readySound', 'cantDoSound', 'tiles', 'tints[].r', 'tints[].g', 'tints[].b']);
        break;
      }
      case 'board': projectBoard(row, model); break;
      case 'gam': {
        put('project', prune({
          kind: 'project', title: model.gameTitle,
          start: { scene: ref('scene', 'Boards', model.initBoard, where), party: [ref('actor', 'Chrs', model.initChar, where)].filter(Boolean) },
          hooks: { startup: script(model.startupPrg, where), runtime: script(model.runTimePrg, where), gameOver: script(model.gameOverPrg, where), customBattle: model.useCustomFightPrg ? script(model.customFightPrg, where) : undefined },
          input: { activationKey: model.activationKey, menuKey: model.menuKey, runtimeKey: model.runTimeKey, extraKeys: model.extKeys.filter((k) => k.asciiKey || has(k.program)).map((k) => ({ key: k.asciiKey, run: script(k.program, where) })) },
          battles: { enabled: model.fightingDisabled === 0, chancePercent: model.chances, style: model.fightType, encounters: model.enemies.filter((e) => has(e.enemyFile)).map((e) => ({ actor: ref('actor', 'Enemy', e.enemyFile, where), skillLevel: e.skillLevel })) },
          menuSkin: { button: asset('image', model.skinButton, where), window: asset('image', model.skinWindow, where) },
          extensions: { plugins: model.plugins.filter((p) => has(p.pluginFile)).map((p) => ({ file: p.pluginFile, enabled: p.enabled === 1 })), menuPlugin: has(model.menuPlugin) ? model.menuPlugin : undefined, battlePlugin: has(model.fightPlugin) ? model.fightPlugin : undefined },
          compat: { tk3: { source: row.path, screenType: model.screenType, extendToFullScreen: model.extendToFullScreen, resolution: model.resolution, colorDepth: model.colorDepth, gameSpeed: model.gameSpeed, pixelMovement: model.pixelMovement, reservedRuns: model.reservedRuns, unprojected: Object.fromEntries(GAM_UNPROJECTED.filter((k) => { const v = model[k]; return v !== undefined && v !== null && v !== 0 && v !== '' && !(Array.isArray(v) && v.length === 0) && !(v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every((x) => x === 0)); }).map((k) => [k, model[k]])) } },
        }), row);
        mark('gam', ['gameTitle', 'initBoard', 'initChar', 'startupPrg', 'runTimePrg', 'gameOverPrg', 'useCustomFightPrg', 'customFightPrg', 'activationKey', 'menuKey', 'runTimeKey', 'extKeys[].asciiKey', 'extKeys[].program', 'fightingDisabled', 'chances', 'fightType', 'enemies[].enemyFile', 'enemies[].skillLevel', 'skinButton', 'skinWindow', 'plugins[].enabled', 'plugins[].pluginFile', 'menuPlugin', 'fightPlugin']);
        for (const k of GAM_UNPROJECTED) for (const f of [k, `${k}.r`, `${k}.g`, `${k}.b`]) acct.mark('gam', f, 'compat-if-set', 'copied to compat.tk3.unprojected only when non-default');
        mark('gam', ['screenType', 'extendToFullScreen', 'resolution', 'colorDepth', 'gameSpeed', 'pixelMovement', 'reservedRuns.parallax', 'reservedRuns.multitask', 'reservedRuns.menuPluginFallback', 'reservedRuns.fightStyle'], 'compat', 'compat.tk3 namespace');
        break;
      }
      case 'tileset': case 'font': break; // binary payloads stay binary (accounting marks fields)
      default: diag(where, 'format', row.format, 'no projection rule');
    }
    // Unparsed trailing bytes are not authored fields we understand, but they
    // are not discarded either: keep them, base64, in each produced document.
    if (Array.isArray(model.residue) && model.residue.length) {
      for (const p of produced) { const d = docs.get(p); d.compat ??= {}; d.compat.tk3 ??= {}; d.compat.tk3.residueBase64 = Buffer.from(model.residue).toString('base64'); }
      diag(where, 'residue', `${model.residue.length} bytes`, 'decoder left trailing bytes; preserved as compat.tk3.residueBase64');
      acct.mark(row.format, 'residue', 'compat-if-set', 'non-empty residue preserved as compat.tk3.residueBase64');
    }
  }

  function gridOf(cells, tints, width) {
    const palette = [], index = new Map(), rows = [];
    for (let i = 0; i < cells.length; i += width) rows.push(cells.slice(i, i + width).map((t) => { if (!t) return 0; const k = JSON.stringify(t); if (!index.has(k)) { index.set(k, palette.length + 1); palette.push({ index: palette.length + 1, ...t }); } return index.get(k); }));
    const tintRows = tints?.some((t) => t.r || t.g || t.b) ? Array.from({ length: Math.ceil(tints.length / width) }, (_, r) => tints.slice(r * width, r * width + width).map(colour)) : undefined;
    return { width, palette, rows, tints: tintRows };
  }

  function projectBoard(row, b) {
    const where = row.path;
    const id = idFor('scene', row.path.replace(/^Boards\//i, ''));
    const kinds = { 0: 'none', 1: 'solid', 2: 'under', 4: 'one-way', 8: 'stairs', 16: 'waypoint' };
    const regions = b.vectors.map((v, i) => prune({ id: has(v.handle) ? v.handle : `region-${i + 1}`, kind: kinds[v.type] ?? `type-${v.type}`, layer: v.layer, closed: v.closed !== 0, points: pts(v.points), targetLayer: v.type === 8 ? v.attributes : undefined, flags: v.type === 2 && v.attributes ? v.attributes : undefined, otherAttributes: v.type !== 8 && v.type !== 2 && v.attributes ? v.attributes : undefined }));
    const condition = (o) => (o.activate === 1 ? { when: { variable: o.initialVar, equals: o.initialValue }, then: has(o.finalVar) ? { variable: o.finalVar, set: o.finalValue } : undefined } : undefined);
    const triggers = b.programs.map((p, i) => prune({ id: `trigger-${i + 1}`, layer: p.layer, area: pts(p.points), open: p.closed === 0 || undefined, run: script(p.program, where) ?? { empty: true }, graphic: tile(p.graphic, where), activation: { onKey: (p.activationType & 1) === 1, repeatWhileInside: (p.activationType & 2) === 2 || undefined, stopsPlayer: (p.activationType & 4) === 4 || undefined, repeatDistance: p.repeatDistance || undefined }, condition: condition(p) }));
    const counts = new Map();
    const placements = b.sprites.map((s, i) => {
      if (!has(s.itemFile)) return prune({ id: `empty-slot-${i + 1}`, emptySlot: true });
      const actor = ref('actor', 'Item', s.itemFile, where);
      const n = (counts.get(actor) ?? 0) + 1; counts.set(actor, n);
      return prune({ id: `${actor}-${n}`, actor, at: [s.x, s.y, s.layer], onActivate: script(s.activationPrg, where), whilePresent: script(s.multitaskPrg, where), activation: { onKey: (s.activationType & 1) === 1, repeat: (s.activationType & 2) === 2 || undefined }, condition: condition(s), loadIf: has(s.loadingVar) ? { variable: s.loadingVar, equals: s.loadingValue } : undefined });
    });
    const links = {}; for (const d of ['north', 'south', 'east', 'west']) { const t = b.links[d]; if (!has(t)) continue; links[d] = /\.brd$/i.test(t) ? { scene: ref('scene', 'Boards', t, where) } : { run: script(t, where) }; }
    const p = b.properties;
    put(`scenes/${id}/scene`, prune({
      kind: 'scene', id, size: { width: b.sizeX, height: b.sizeY, layers: b.sizeL }, layerTitles: b.layerTitles.slice(1).some(has) ? b.layerTitles.slice(1) : undefined,
      tiles: 'tiles',
      background: { colour: colour(p.backgroundColour), image: asset('image', p.backgroundImage, where), imageMode: has(p.backgroundImage) ? p.backgroundDrawType : undefined, music: asset('audio', p.backgroundMusic, where) },
      ambient: p.ambient.r || p.ambient.g || p.ambient.b ? colour(p.ambient) : undefined,
      start: [p.start.x, p.start.y, p.start.layer],
      battles: { allowed: p.allowBattles !== 0, environment: ref('environment', 'Bkrounds', p.battleBackground, where), skillLevel: p.battleSkill || undefined },
      savingDisabled: p.disableSaving !== 0 || undefined,
      onEnter: script(p.enterPrg, where), links,
      regions, triggers, placements,
      images: b.images.map((im, i) => ({ id: `image-${i + 1}`, ...im })), lights: b.lights.length ? b.lights : undefined,
      threads: b.threads.filter(has).map((t) => script(t, where)),
      constants: b.constants.some((c) => c !== '0' && c !== '') ? b.constants : undefined,
      compat: { tk3: { source: row.path, coordType: b.coordType, storedForm: row.storedForm, storedVersion: `${row.storedMajor}.${row.storedMinor}`, decodedModelVersion: row.decodedModelVersion } },
    }), row);
    // Tiles: palette (LUT with stable indices), layers as rows, sparse shading.
    const palette = [];
    b.lut.forEach((t, i) => { if (i > 0 && has(t)) palette.push({ index: i, ...tile(t, where) }); });
    const layers = [];
    for (let l = 0; l < b.sizeL; l++) {
      const rows = [];
      for (let y = 0; y < b.sizeY; y++) rows.push(b.tileMatrix.slice((l * b.sizeY + y) * b.sizeX, (l * b.sizeY + y + 1) * b.sizeX));
      layers.push({ layer: l + 1, rows });
    }
    const shading = b.shadeLayers.map((s) => {
      let cell = 0; const runs = [];
      for (const r of s.records) { const n = Math.max(1, r.runCount); if (r.r || r.g || r.b) runs.push({ at: [cell % b.sizeX + 1, Math.floor(cell / b.sizeX) + 1], cells: n, tint: [r.r, r.g, r.b] }); cell += n; }
      return { castLayer: s.castLayer, runs };
    }).filter((s) => s.runs.length);
    put(`scenes/${id}/tiles`, prune({ kind: 'tile-layers', scene: id, size: { width: b.sizeX, height: b.sizeY }, palette, layers, shading: shading.length ? shading : undefined }), row);
    mark('board', ['sizeX', 'sizeY', 'sizeL', 'layerTitles', 'lut', 'tileMatrix', 'shadeLayers', 'vectors', 'vectors[].points[].x', 'vectors[].points[].y', 'vectors[].type', 'vectors[].layer', 'vectors[].closed', 'vectors[].handle', 'vectors[].attributes', 'programs', 'programs[].program', 'programs[].graphic', 'programs[].layer', 'programs[].points[].x', 'programs[].points[].y', 'programs[].activate', 'programs[].activationType', 'programs[].repeatDistance', 'programs[].initialVar', 'programs[].initialValue', 'programs[].finalVar', 'programs[].finalValue', 'sprites', 'sprites[].itemFile', 'sprites[].x', 'sprites[].y', 'sprites[].layer', 'sprites[].activationPrg', 'sprites[].multitaskPrg', 'sprites[].activationType', 'sprites[].activate', 'sprites[].initialVar', 'sprites[].initialValue', 'sprites[].finalVar', 'sprites[].finalValue', 'sprites[].loadingVar', 'sprites[].loadingValue', 'links.north', 'links.south', 'links.east', 'links.west', 'properties.backgroundImage', 'properties.backgroundDrawType', 'properties.backgroundColour.r', 'properties.backgroundColour.g', 'properties.backgroundColour.b', 'properties.backgroundMusic', 'properties.enterPrg', 'properties.battleBackground', 'properties.battleSkill', 'properties.allowBattles', 'properties.disableSaving', 'properties.ambient.r', 'properties.ambient.g', 'properties.ambient.b', 'properties.start.x', 'properties.start.y', 'properties.start.layer', 'images', 'lights', 'threads', 'constants']);
    mark('board', ['programs[].closed', 'coordType'], 'compat', 'closed=0 kept as open:true; coordType in compat.tk3');
    mark('board', ['shadeLayers[].castLayer', 'shadeLayers[].records[].runCount', 'shadeLayers[].records[].r', 'shadeLayers[].records[].g', 'shadeLayers[].records[].b']);
  }

  // Write -----------------------------------------------------------------------
  const out = join(outRoot, game);
  rmSync(out, { recursive: true, force: true });
  for (const [p, v] of docs) { const t = join(out, 'model', `${p}.json`); mkdirSync(dirname(t), { recursive: true }); writeFileSync(t, `${JSON.stringify(v, null, 2)}\n`); }
  // External programs are copied byte-for-byte (scratch only, never tracked).
  for (const [, p] of programs) { const t = join(out, 'model', 'scripts', p.slice(4)); mkdirSync(dirname(t), { recursive: true }); copyFileSync(join(root, p), t); }
  // Binary payloads stay binary (owner exception): link them into the projected
  // tree at their new locations so reference checks see real files.
  for (const row of files) {
    let target = null;
    if (row.status === 'media-hashed-not-decoded' && /^bitmap\//i.test(row.path)) target = join('media/images', row.path.slice(7));
    else if (row.status === 'media-hashed-not-decoded' && /^media\//i.test(row.path)) target = join('media/audio', row.path.slice(6));
    else if (row.format === 'tileset') target = join('tilesets', `${idFor('tileset', row.path.replace(/^Tiles\//i, ''))}${/\.iso$/i.test(row.path) ? '.iso' : '.tst'}`);
    else if (row.format === 'font') target = join('fonts', row.path.replace(/^Font\//i, ''));
    if (!target) continue;
    const t = join(out, 'model', target); mkdirSync(dirname(t), { recursive: true });
    try { symlinkSync(join(root, row.path), t); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
  const accounting = acct.finish();
  writeFileSync(join(out, 'provenance.json'), JSON.stringify(provenance, null, 1));
  writeFileSync(join(out, 'accounting.json'), JSON.stringify(accounting, null, 1));
  writeFileSync(join(out, 'diagnostics.json'), JSON.stringify(diagnostics, null, 1));
  const byKind = {}; for (const p of docs.keys()) { const k = p.split('/')[0]; byKind[k] = (byKind[k] ?? 0) + 1; }
  const unaccounted = accounting.filter((r) => r.status === 'unaccounted');
  console.log(game, JSON.stringify(byKind), `programs=${programs.size}`, `diagnostics=${diagnostics.length}`, `unaccounted=${unaccounted.map((r) => `${r.format}|${r.field}`).join(',') || 0}`);
}

for (const game of Object.keys(manifest.games)) if (!onlyGame || onlyGame === game) projectGame(game);
