// #1778 research (Opus): the SAME library operations bundled twice by esbuild
// (platform=node and platform=browser) and executed in Node and in Chromium.
// Corrected after review (#1784): every step first makes explicit POSITIVE and
// NEGATIVE semantic assertions (round trip equals the input, malformed input is
// rejected, edits produce the expected value, the validator accepts a valid
// document AND rejects a known-invalid one at the expected path). Only then are
// output hashes compared across hosts. A step "passes" only if all its
// assertions hold; hashes alone prove nothing.
import * as YAML from 'yaml';
import * as KDL from '@bgotink/kdl';
import * as KJ from '@bgotink/kdl/json';
import * as TOMLP from '@decimalturn/toml-patch';
import * as SMOL from 'smol-toml';
import JSON5 from 'json5';
import Hjson from 'hjson';
import * as JSONC from 'jsonc-parser';
import * as EDN from 'edn-data';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { XMLValidator } from 'fast-xml-parser';
import Ajv2020 from 'ajv/dist/2020.js';
import * as HOCON from '@o3co/ts.hocon';

async function hash(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}
function deepEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null || Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  // JSON-model semantics: object key order is not significant (as isDeepStrictEqual).
  return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]));
}
const throws = (fn) => { try { fn(); return false; } catch { return true; } };
const edited = (doc) => { const v = JSON.parse(JSON.stringify(doc)); v.placements[0].at[0] = 215; return v; };

export async function runProbe({ doc, schema }) {
  const out = {};
  const step = async (name, fn) => {
    try {
      const t = performance.now(); const { text, checks } = await fn();
      const failed = Object.entries(checks).filter(([, v]) => v !== true).map(([k]) => k);
      out[name] = { ok: failed.length === 0, checks, failed, hash: await hash(text), ms: +(performance.now() - t).toFixed(2) };
    } catch (e) { out[name] = { ok: false, error: String(e.message ?? e).slice(0, 160) }; }
  };
  const want = edited(doc);
  await step('yaml', () => {
    const t = new YAML.Document(doc).toString(); const p = YAML.parseDocument(t); p.setIn(['placements', 0, 'at', 0], 215);
    return { text: t + p.toString(), checks: { roundTrip: deepEqual(YAML.parse(t), doc), editExpected: deepEqual(p.toJS(), want), rejectsMalformed: YAML.parseDocument('a: [1, 2\nb: c').errors.length > 0 } };
  });
  await step('kdl-jik', () => {
    const t = KJ.stringify(doc, { indentation: 2 });
    return { text: t, checks: { roundTrip: deepEqual(KJ.parse(t), doc), formatIdentity: KDL.format(KDL.parse(t)) === t, rejectsMalformed: throws(() => KDL.parse('node "unterminated')) } };
  });
  await step('toml', () => {
    const t = TOMLP.stringify(doc); const v = SMOL.parse(t); v.placements[0].at[0] = 215; const patched = TOMLP.patch(t, v);
    return { text: t + patched, checks: { roundTrip: deepEqual(SMOL.parse(t), doc), patchExpected: deepEqual(SMOL.parse(patched), want), rejectsMalformed: throws(() => SMOL.parse('a = "x\nb = 1')) } };
  });
  await step('json5', () => {
    const t = JSON5.stringify(doc, null, 2);
    return { text: t, checks: { roundTrip: deepEqual(JSON5.parse(t), doc), rejectsMalformed: throws(() => JSON5.parse('{a: [1, }')) } };
  });
  await step('hjson', () => {
    const t = Hjson.stringify(doc); const rt = Hjson.rt.stringify(Hjson.rt.parse(`# c\n${t}`));
    return { text: t + rt, checks: { roundTrip: deepEqual(Hjson.parse(t), doc), rtKeepsComment: rt.includes('# c'), rejectsMalformed: throws(() => Hjson.parse('{\n a: "x\n}')) } };
  });
  await step('jsonc', () => {
    const t = JSON.stringify(doc, null, 2); const e = JSONC.applyEdits(t, JSONC.modify(t, ['placements', 0, 'at', 0], 215, { formattingOptions: { insertSpaces: true, tabSize: 2 } }));
    const errs = []; JSONC.parse('{"a": [1,, }', errs);
    return { text: e, checks: { editExpected: deepEqual(JSON.parse(e), want), reportsMalformed: errs.length > 0 } };
  });
  await step('edn-data', () => {
    const t = EDN.toEDNStringFromSimpleObject(doc); const opts = { mapAs: 'object', keywordAs: 'string', listAs: 'array' };
    let malformed; try { malformed = EDN.parseEDNString('{:a 1', opts); } catch { malformed = 'threw'; }
    return { text: t, checks: { roundTrip: deepEqual(EDN.parseEDNString(t, opts), doc), rejectsMalformed: malformed === 'threw' } };
  });
  await step('xmldom', () => {
    const good = `<map xmlns="http://www.w3.org/2005/xpath-functions"><!-- c --><string key="id">${doc.id}</string></map>`;
    const errs = []; try { new DOMParser({ onError: (level, msg) => { if (level !== 'warning') errs.push(msg); } }).parseFromString('<map><string key="id">x</map>', 'text/xml'); } catch (e) { errs.push(String(e.message ?? e)); }
    const s = new XMLSerializer().serializeToString(new DOMParser().parseFromString(good, 'text/xml'));
    return { text: s, checks: { serializeKeepsComment: s.includes('<!-- c -->'), validatorAcceptsGood: XMLValidator.validate(good) === true, domRejectsMalformed: errs.length > 0, validatorRejectsMalformed: XMLValidator.validate('<map><string key="id">x</map>') !== true } };
  });
  await step('ajv2020', () => {
    const ajv = new Ajv2020({ allErrors: true, strict: false }); ajv.addKeyword?.({ keyword: 'x-ref', schemaType: 'string' });
    const v = ajv.compile(schema); const okGood = v(doc);
    const bad = JSON.parse(JSON.stringify(doc)); bad.placements[0].at[0] = '214'; const okBad = v(bad);
    return { text: JSON.stringify([okGood, okBad, v.errors?.map((e) => e.instancePath)]), checks: { acceptsValid: okGood === true, rejectsInvalid: okBad === false, errorAtExpectedPath: (v.errors ?? []).some((e) => e.instancePath === '/placements/0/at/0') } };
  });
  await step('ts-hocon', () => {
    const v = HOCON.parse('a { b = 1 }\nc = ${a} { d = 2 }\n'); const o = typeof v.toObject === 'function' ? v.toObject() : v;
    return { text: JSON.stringify(o), checks: { substitutionMerge: deepEqual(o, { a: { b: 1 }, c: { b: 1, d: 2 } }), rejectsMalformed: throws(() => HOCON.parse('a = ${missing}\n')) } };
  });
  return out;
}
