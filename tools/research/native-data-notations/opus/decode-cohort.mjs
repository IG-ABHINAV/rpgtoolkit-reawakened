// Read-only #1778 research host (Opus). Decodes the pinned cohort's authored
// data files through the PUBLIC @tk-reawakened/core decoders and writes plain
// JSON models to a scratch directory. Not an importer, converter or format.
//
// Usage (from the repository root, after the core package is built):
//   node tools/research/native-data-notations/opus/decode-cohort.mjs \
//     --inventory <1778-shared-inputs.json> --out <scratch>/decoded \
//     --game demo=<root> --game ChimeranEmpire=<root> ...
// Each <root> is a game directory (folders Boards/, Chrs/, Item/ ... and
// optionally Main/). Nothing under a root is written. Media payloads are
// hashed and inventoried only; images/audio are not decoded.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { CORE_DECODERS } from '@tk-reawakened/core';

const args = process.argv.slice(2);
const opt = (name) => args.flatMap((a, i) => (a === name ? [args[i + 1]] : []));
const [out] = opt('--out');
const [inventoryPath] = opt('--inventory');
if (!out) throw new Error('--out is required');
const games = Object.fromEntries(opt('--game').map((g) => g.split(/=(.*)/s).slice(0, 2)));

const inventory = new Map();
if (inventoryPath) {
  for (const f of JSON.parse(readFileSync(inventoryPath, 'utf8')).files) {
    inventory.set(`${f.game}|${f.path.toLowerCase()}`, f);
  }
}
const extToKind = new Map(Object.entries(CORE_DECODERS).flatMap(([id, d]) => d.extensions.map((e) => [e, id])));
const mediaExt = new Set(['png', 'jpg', 'jpeg', 'bmp', 'gif', 'wav', 'mid', 'midi', 'mp3', 'ogg', 'it', 'xm', 's3m', 'mod']);
const sha = (b) => createHash('sha256').update(b).digest('hex');

/** JSON-safe copy: typed arrays become plain arrays; undefined is reported. */
function plain(value) {
  if (ArrayBuffer.isView(value)) return Array.from(value);
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === 'object') {
    const o = {};
    for (const [k, v] of Object.entries(value)) o[k] = v === undefined ? { $undefined: true } : plain(v);
    return o;
  }
  return value;
}

function walk(root) {
  const files = [];
  const visit = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) visit(p);
      else files.push(relative(root, p));
    }
  };
  visit(root);
  return files;
}

const manifest = { generatedBy: 'decode-cohort.mjs', node: process.version, games: {} };
for (const [game, root] of Object.entries(games)) {
  const rows = [];
  for (const path of walk(root)) {
    const ext = path.split('.').at(-1).toLowerCase();
    const bytes = readFileSync(join(root, path));
    const hash = sha(bytes);
    const inv = inventory.get(`${game}|${path.toLowerCase()}`);
    const row = { path, bytes: bytes.length, sha256: hash, inventoryId: inv?.id ?? null, inventoryHashMatch: inv ? inv.sha256 === hash : null };
    if (ext === 'prg') {
      row.status = bytes[0] === 0 ? 'compiled-program-not-inspected' : 'program-source';
    } else if (mediaExt.has(ext)) {
      row.status = 'media-hashed-not-decoded';
    } else if (extToKind.has(ext) && extToKind.get(ext) !== 'image') {
      const kind = extToKind.get(ext);
      row.format = kind;
      if (bytes.length === 0) row.status = 'zero-byte-placeholder';
      else {
        try {
          const r = CORE_DECODERS[kind].decode(bytes, {});
          if (!r.ok) { row.status = 'decode-failed'; row.error = r.error; }
          else {
            const model = kind === 'board' ? r.value.board : r.value;
            row.status = 'decoded';
            row.warnings = r.warnings ?? [];
            row.major = model.major ?? null; row.minor = model.minor ?? null;
            const target = join(out, game, `${path}.json`);
            // The decoder normalises every board to the vector model (2.4;
            // docs/spec/formats/board.md#version-dispatch), so the model's
            // version is not the stored one (#1796). Read the physical header:
            // binary (byte 14 = 0, shorts at 15/17) or Toolkit 2 text
            // (lines 2-3 are major/minor; legacy/text-formats.md#board-toolkit-2-text).
            if (kind === 'board') {
              row.decodedModelVersion = `${model.major}.${model.minor}`;
              if (bytes[14] === 0) {
                const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
                row.storedForm = 'binary'; row.storedMajor = view.getInt16(15, true); row.storedMinor = view.getInt16(17, true);
              } else {
                const lines = new TextDecoder('latin1').decode(bytes.subarray(0, 64)).split(/\r?\n/);
                row.storedForm = 'tk2-text'; row.storedMajor = Number(lines[1].trim()); row.storedMinor = Number(lines[2].trim());
              }
            }
            mkdirSync(dirname(target), { recursive: true });
            writeFileSync(target, JSON.stringify(plain(model)));
          }
        } catch (e) { row.status = 'decoder-threw'; row.error = String(e); }
      }
    } else row.status = 'not-a-data-format';
    rows.push(row);
  }
  manifest.games[game] = { root, files: rows };
}
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 1));
for (const [game, { files }] of Object.entries(manifest.games)) {
  const count = {};
  for (const f of files) count[f.status] = (count[f.status] ?? 0) + 1;
  const mismatch = files.filter((f) => f.inventoryHashMatch === false).length;
  const unmatched = files.filter((f) => f.inventoryId === null).length;
  console.log(game, JSON.stringify(count), `hashMismatch=${mismatch}`, `notInInventory=${unmatched}`);
}
