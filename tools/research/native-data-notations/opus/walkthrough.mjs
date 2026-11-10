// #1778 research (Opus): AGENT-PERFORMED text-editor rehearsal (not human
// usability testing) on the real demo projection written in each notation.
// Every edit below is a plain text operation on the file (what a person in an
// ordinary editor would do); the only tool used afterwards is check.mjs.
//
//   node walkthrough.mjs --projection <scratch>/projection --work <scratch>/walkthrough --out <scratch>/results/walkthrough.json
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, statSync, symlinkSync, cpSync, renameSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CODECS } from './notations.mjs';
import { createValidator, loadProject, checkProject, renameReference, planRenameMoves } from './check.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i < 0 ? undefined : args[i + 1]; };
const P = opt('--projection'), WORK = opt('--work'), OUT = opt('--out');
const CODEC_FOR = { yaml: 'yaml', 'json-layout': 'json-layout', 'json5-layout': 'json5-layout', hjson: 'hjson', 'toml-rows': 'toml-rows', kdl: 'kdl', edn: 'edn', ron: 'ron-compact', xml: 'xml' };
const validator = createValidator(join(here, 'schemas/plugins'));
const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const unified = (a, b) => { const dir = join(WORK, '_d'); mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'before'), a); writeFileSync(join(dir, 'after'), b); return spawnSync('git', ['diff', '--no-index', '--unified=1', '--', join(dir, 'before'), join(dir, 'after')], { encoding: 'utf8' }).stdout.replace(/^(diff|index|---|\+\+\+) .*\n/gm, ''); };
const errorsOf = (dir) => checkProject(loadProject(dir), validator).filter((d) => d.severity !== 'info');

function emitTree(id, ext) {
  const dir = join(WORK, id); rmSync(dir, { recursive: true, force: true });
  const model = join(P, 'demo/model');
  for (const f of walk(model)) {
    const rel = relative(model, f);
    const t = join(dir, rel); mkdirSync(dirname(t), { recursive: true });
    if (rel.endsWith('.json') && !rel.startsWith('scripts/')) {
      const v = JSON.parse(readFileSync(f, 'utf8'));
      if (rel === 'scenes/start/scene.json') v.extensions = { 'com.example.weather': { version: 1, precipitation: 'rain', intensity: 0.25 }, 'org.example.lanterns': { version: 3, glow: [255, 200, 120] } };
      writeFileSync(t.replace(/\.json$/, `.${ext}`), CODECS[id].stringify(v));
    } else if (rel.startsWith('scripts/')) cpSync(f, t); else symlinkSync(f, t);
  }
  return dir;
}

const results = { note: 'Agent-performed rehearsal with scripted plain-text edits; not observed human usability.', perNotation: {} };
rmSync(WORK, { recursive: true, force: true }); mkdirSync(WORK, { recursive: true });
for (const [id] of Object.entries(CODEC_FOR)) {
  const c = CODECS[id]; const ext = c.ext; const dir = emitTree(id, ext); const r = { codec: id, ext };
  const scenePath = join(dir, `scenes/start/scene.${ext}`); const actorPath = join(dir, `actors/oldman.${ext}`);
  const scene0 = readFileSync(scenePath, 'utf8'); const actor0 = readFileSync(actorPath, 'utf8');
  // 1. From the placement, find the actor definition: the placement names `actor: oldman`; rule kind->folder gives actors/oldman.<ext>.
  const loc = c.locate?.(scene0, ['placements', 0, 'actor']);
  const line = loc ? scene0.split('\n')[loc.line - 1].trim() : scene0.split('\n').find((l) => l.includes('oldman') && !l.includes('scripts/') && !l.includes('wp_'))?.trim();
  r.locateActor = { placementLine: line, sourceLine: loc?.line ?? null, definitionFile: relative(dir, actorPath), exists: true };
  // 2. Ownership: core fields vs namespaced plugin data.
  const v = c.parse(scene0);
  r.ownership = { coreTopLevel: Object.keys(v).filter((k) => k !== 'extensions' && k !== 'compat'), compat: Object.keys(v.compat ?? {}), pluginNamespaces: Object.keys(v.extensions ?? {}), checker: checkProject(loadProject(dir), validator).filter((d) => d.file === relative(dir, scenePath) && d.severity === 'info').map((d) => `${d.code}: ${d.namespace}`) };
  // 3. Change a property by hand: oldman walks a little faster (0.3 -> 0.25 s per frame).
  const lines = actor0.split('\n'); const i = lines.findIndex((l) => l.includes('secondsPerFrame'));
  const j = lines[i].includes('0.3') ? i : i + 1; lines[j] = lines[j].replace('0.3', '0.25');
  const actor1 = lines.join('\n'); writeFileSync(actorPath, actor1);
  r.changeProperty = { diff: unified(actor0, actor1), parsedValue: c.parse(actor1).presence.timing.secondsPerFrame, errorsAfter: errorsOf(dir).filter((d) => d.file.startsWith('actors/')).length };
  // 4. Edit the inline RPGCode hook: add a second statement the way this notation is typed.
  const oldCode = 'itemPath("source", tkMV_WAYPOINT_LINK,  "wp_oldman", 0);';
  const want = `${oldCode}\nmwin("Lovely weather.");`;
  const typed = { yaml: null, 'json-layout': '\\nmwin(\\"Lovely weather.\\");', 'json5-layout': '\\nmwin(\\"Lovely weather.\\");', hjson: '\\nmwin(\\"Lovely weather.\\");', 'toml-rows': '\\nmwin(\\"Lovely weather.\\");', kdl: '\\nmwin(\\"Lovely weather.\\");', edn: '\\nmwin(\\"Lovely weather.\\");', ron: '\\nmwin(\\"Lovely weather.\\");', xml: '\nmwin("Lovely weather.");' }[id];
  let scene1;
  if (id === 'yaml') scene1 = scene0.replace(/whilePresent:\n(\s+)inline: (.*)\n/, (m, ws, code) => `whilePresent:\n${ws}inline: |-\n${ws}  ${code}\n${ws}  mwin("Lovely weather.");\n`);
  else { const esc = id === 'xml' ? oldCode : JSON.stringify(oldCode).slice(1, -1); scene1 = scene0.replace(`${esc}`, `${esc}${typed}`); }
  writeFileSync(scenePath, scene1);
  let got; try { got = c.parse(scene1).placements[0].whilePresent.inline; } catch (e) { got = `PARSE ERROR ${e.message}`; }
  r.editInlineScript = { diff: unified(scene0, scene1), exact: got === want, got: got === want ? undefined : got };
  // 5. Add a placement by hand: the minimal typed hunk (agent-generated from the canonical layout).
  const sceneV = c.parse(scene1);
  const added = structuredClone(sceneV); added.placements.push({ id: 'oldman-2', actor: 'oldman', at: [300, 200, 1], onActivate: { program: 'scripts/oldman.prg' } });
  const canonBefore = c.stringify(sceneV), canonAfter = c.stringify(added);
  const hunk = unified(canonBefore, canonAfter);
  const dpatch = join(WORK, '_p'); mkdirSync(dpatch, { recursive: true }); writeFileSync(join(dpatch, 'a'), canonBefore); writeFileSync(join(dpatch, 'b'), canonAfter); writeFileSync(join(dpatch, 't'), scene1);
  const d = spawnSync('diff', ['-u', join(dpatch, 'a'), join(dpatch, 'b')], { encoding: 'utf8' }).stdout; writeFileSync(join(dpatch, 'p'), d);
  const pr = spawnSync('patch', ['-s', '-o', join(dpatch, 'o'), join(dpatch, 't'), join(dpatch, 'p')], { encoding: 'utf8' });
  const scene2 = pr.status === 0 ? readFileSync(join(dpatch, 'o'), 'utf8') : null;
  if (scene2) writeFileSync(scenePath, scene2);
  r.addPlacement = { typedHunk: hunk, linesTouched: (hunk.match(/^[+-](?![+-])/gm) ?? []).length, applied: !!scene2, placementsAfter: scene2 ? c.parse(scene2).placements.map((p) => p.id) : null, errorsAfter: errorsOf(dir).length };
  // 6. Break a reference and let the checker find it.
  const scene3 = (scene2 ?? scene1).replace(/oldman-2([\s\S]*?)oldman/, (m, mid) => `oldman-2${mid}oldmn`);
  writeFileSync(scenePath, scene3);
  r.brokenReference = errorsOf(dir).filter((x) => x.code === 'broken-reference').map((x) => `${x.file}:${x.line ?? '?'}:${x.col ?? '?'} ${x.message} (${x.path})`);
  writeFileSync(scenePath, scene2 ?? scene1);
  // 7. Rename a referenced clip project-wide (common reference-edit operation), then move its file.
  const proj = loadProject(dir);
  const changed = renameReference(proj, validator, 'clip', 'oldman/oldman-s', 'oldman/walk-south', 'preserve');
  for (const ch of changed) writeFileSync(join(dir, ch.file), ch.after);
  for (const m of planRenameMoves(proj, 'clip', 'oldman/oldman-s', 'oldman/walk-south')) renameSync(join(dir, m.from), join(dir, m.to));
  const after = errorsOf(dir);
  r.renameClip = { filesChanged: changed.map((x) => `${x.file} (${x.mode}, ${x.references} ref)`), brokenAfter: after.filter((x) => x.code === 'broken-reference').length, actorDiff: unified(changed.find((x) => x.file.startsWith('actors/'))?.before ?? '', changed.find((x) => x.file.startsWith('actors/'))?.after ?? '') };
  // 8. Rename a scene: data references update; inline RPGCode literals are only reported.
  const proj2 = loadProject(dir);
  const moves2 = planRenameMoves(proj2, 'scene', 'out', 'harbour');
  const changed2 = renameReference(proj2, validator, 'scene', 'out', 'harbour', 'preserve');
  for (const ch of changed2) writeFileSync(join(dir, ch.file), ch.after);
  for (const m of moves2) { mkdirSync(dirname(join(dir, m.to)), { recursive: true }); renameSync(join(dir, m.from), join(dir, m.to)); }
  const afterScene = errorsOf(dir);
  r.renameScene = { filesChanged: changed2.map((x) => x.file), moved: moves2.map((m) => `${m.from} -> ${m.to}`), errorsAfter: afterScene.filter((x) => x.severity === 'error').map((x) => `${x.code} ${x.file}`), scriptLiteralWarnings: afterScene.filter((x) => x.code === 'script-literal-reference').map((x) => `${x.file}:${x.line ?? '?'} ${x.message}`) };
  // 9. Rename onto an existing document must be refused before any write (#1788).
  const proj3 = loadProject(dir); const snapshot = proj3.docs.map((d) => d.text).join('\u0000');
  try { renameReference(proj3, validator, 'clip', 'start/start-fight', 'start/start-defend', 'preserve'); r.renameOntoExisting = 'NOT REFUSED'; } catch (e) { r.renameOntoExisting = { refused: true, message: e.message, unchanged: loadProject(dir).docs.map((d) => d.text).join('\u0000') === snapshot }; }
  results.perNotation[id] = r;
  console.log(id, 'inline exact', r.editInlineScript.exact, 'add applied', r.addPlacement.applied, 'broken found', r.brokenReference.length, 'rename broken after', r.renameClip.brokenAfter);
}
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(results, null, 1));
