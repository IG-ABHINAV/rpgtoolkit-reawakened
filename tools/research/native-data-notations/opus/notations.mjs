// #1778 research (Opus): one adapter per candidate notation/library so every
// experiment drives the SAME logical value through each notation. Adapters
// call the named third-party libraries; nothing here parses a notation itself.
// Where a library lacks layout control, a small *layout printer* is used and
// labelled as project-owned printing code (integration cost), never as the
// library's behaviour. Libraries are resolved from an isolated scratch install
// (NOTATION_LIBS, default /private/tmp/tkr-1778-opus-experiments) so no
// workspace manifest or lockfile changes.
import { createRequire } from 'node:module';
import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

export const LIBS = process.env.NOTATION_LIBS ?? '/private/tmp/tkr-1778-opus-experiments';
const RON_BRIDGE = process.env.RON_BRIDGE ?? join(LIBS, 'ron-bridge/target/release/ron-bridge');
const req = createRequire(join(LIBS, 'package.json'));
const version = (name) => JSON.parse(readFileSync(join(LIBS, 'node_modules', name, 'package.json'), 'utf8')).version;
const YAML = req('yaml');
const KDL = req('@bgotink/kdl');
const KJ = req('@bgotink/kdl/json');
const TOMLP = req('@decimalturn/toml-patch');
const SMOL = req('smol-toml');
const TomlAst = req('toml-eslint-parser');
const JSON5 = req('json5');
const Hjson = req('hjson');
const JSONC = req('jsonc-parser');
const EDN = req('edn-data');
const { DOMParser, XMLSerializer } = req('@xmldom/xmldom');
const FXP = req('fast-xml-parser');

export const libraryVersions = Object.fromEntries(['yaml', '@bgotink/kdl', '@decimalturn/toml-patch', 'smol-toml', 'toml-eslint-parser', 'json5', 'hjson', 'jsonc-parser', 'edn-data', '@xmldom/xmldom', 'fast-xml-parser', 'rusty-object-notation', 'sdlang', 'ajv'].map((n) => [n, version(n)]));

// ---- shared helpers ---------------------------------------------------------
const isScalar = (v) => v === null || typeof v !== 'object';
const allScalar = (a) => a.every(isScalar);
const lineCol = (text, offset) => { const before = text.slice(0, offset); const line = before.split('\n').length; return { line, col: offset - before.lastIndexOf('\n') }; };
export function getAt(v, path) { for (const k of path) v = v?.[k]; return v; }
/** Apply a structural edit to a plain value (used by re-emit paths and to compute expectations). */
export function applyOps(value, ops) {
  const v = structuredClone(value);
  for (const op of ops) {
    const parent = getAt(v, op.path.slice(0, -1));
    const key = op.path.at(-1);
    if (op.op === 'set') parent[key] = structuredClone(op.value);
    else if (op.op === 'delete') { if (Array.isArray(parent)) parent.splice(key, 1); else delete parent[key]; }
    else if (op.op === 'insert') getAt(v, op.path).splice(op.index, 0, structuredClone(op.value));
    else if (op.op === 'move') { const a = getAt(v, op.path); const [x] = a.splice(op.from, 1); a.splice(op.to, 0, x); }
    else throw new Error(`unknown op ${op.op}`);
  }
  return v;
}

// ---- layout printer (project-owned; JSON / JSON5 / EDN / TOML rows) ----------
// Objects expand one key per line; arrays of scalars stay on one line; arrays
// whose items are all scalar arrays put one inner array per line (points,
// tile rows). Used only where the library offers no such layout control.
function layout(value, style, indent = '') {
  const inner = `${indent}  `;
  const sep = style === 'edn' ? ' ' : ', ';
  const comma = style === 'edn' ? '' : ',';
  const trailing = style === 'json5' ? ',' : '';
  const scalar = (x) => {
    if (style === 'edn') { if (x === null) return 'nil'; if (typeof x === 'string') return JSON.stringify(x).replace(/\\u([0-9a-f]{4})/gi, (m, h) => `\\u${h}`); return String(x); }
    return JSON.stringify(x);
  };
  // EDN keywords cannot carry arbitrary text (spaces, extra '/', leading digits…).
  // Keys that are not simple keyword names are written as EDN strings (#1790).
  const key = (k) => (style === 'edn' ? (/^[A-Za-z][A-Za-z0-9_-]*$/.test(k) ? `:${k}` : scalar(k)) : style === 'json5' && /^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k));
  if (isScalar(value)) return scalar(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    if (allScalar(value)) return `[${value.map(scalar).join(sep)}]`;
    if (value.every((x) => Array.isArray(x) && allScalar(x))) return `[\n${value.map((x) => `${inner}${layout(x, style, inner)}`).join(`${comma}\n`)}${trailing}\n${indent}]`;
    return `[\n${value.map((x) => `${inner}${layout(x, style, inner)}`).join(`${comma}\n`)}${trailing}\n${indent}]`;
  }
  const entries = Object.entries(value);
  if (entries.length === 0) return '{}';
  const kv = style === 'edn' ? ' ' : ': ';
  return `{\n${entries.map(([k, x]) => `${inner}${key(k)}${kv}${layout(x, style, inner)}`).join(`${comma}\n`)}${trailing}\n${indent}}`;
}

// ---- TOML null mapping (TOML has no null) ------------------------------------
// Documented mapping cost. Injective (#1782): null <-> { "$null" = true }, and
// every authored key that starts with "$" is escaped by doubling the "$", so a
// decoded single-key table { "$null" = true } can only be the null marker.
const tomlKeyEnc = (k) => (k.startsWith('$') ? `$${k}` : k);
const tomlKeyDec = (k) => (k.startsWith('$$') ? k.slice(1) : k);
const tomlEncode = (v) => (v === null ? { $null: true } : Array.isArray(v) ? v.map(tomlEncode) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [tomlKeyEnc(k), tomlEncode(x)])) : v);
const tomlDecode = (v) => {
  if (Array.isArray(v)) return v.map(tomlDecode);
  if (!v || typeof v !== 'object' || v instanceof Date) return v;
  const keys = Object.keys(v);
  if (keys.length === 1 && keys[0] === '$null' && v.$null === true) return null;
  const o = {}; for (const k of keys) Object.defineProperty(o, tomlKeyDec(k), { value: tomlDecode(v[k]), enumerable: true, writable: true, configurable: true });
  return o;
};
const tomlFormat = () => { const f = TOMLP.TomlFormat.default(); f.multilineArray = false; f.trailingComma = false; return f; };
// Re-flow `key = [ [..], [..] ]` lines (arrays of scalar arrays) one inner
// array per line. TOML permits multi-line arrays; toml-patch cannot emit this.
function tomlReflowRows(text) {
  return text.replace(/^(\s*)([A-Za-z0-9_"$.-]+) = \[ (\[ .* \]) \]$/gm, (m, ws, k, body) => {
    const items = body.split(/(?<=\]), (?=\[)/);
    return `${ws}${k} = [\n${items.map((x) => `${ws}  ${x},`).join('\n')}\n${ws}]`;
  });
}

// ---- W3C XPath 3.1 JSON-as-XML representation (fn:json-to-xml) ----------------
const FN = 'http://www.w3.org/2005/xpath-functions';
// Text content needs only & < > (and CR, which XML parsers would otherwise
// normalise away); attribute values additionally escape the double quote and
// TAB/LF/CR, which attribute-value normalisation would otherwise turn into
// spaces (#1792).
const escText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#13;');
const esc = (s) => escText(s).replace(/"/g, '&quot;').replace(/\t/g, '&#9;').replace(/\n/g, '&#10;');
// XML 1.0 cannot carry U+0000, most C0 controls, U+FFFE/U+FFFF or lone
// surrogates even as character references. The W3C JSON representation's
// `escaped="true"` / `escaped-key="true"` attributes carry such text with JSON
// backslash escapes instead (#1795).
const XML_FORBIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const jsonEsc = (s) => JSON.stringify(s).slice(1, -1).replace(/[\uFFFE\uFFFF]/g, (c) => `\\u${c.charCodeAt(0).toString(16)}`);
function toXml(value, indent = '', key) {
  const k = key === undefined ? '' : XML_FORBIDDEN.test(key) ? ` key="${esc(jsonEsc(key))}" escaped-key="true"` : ` key="${esc(key)}"`;
  if (value === null) return `${indent}<null${k}/>`;
  if (typeof value === 'string') return XML_FORBIDDEN.test(value) ? `${indent}<string${k} escaped="true">${escText(jsonEsc(value))}</string>` : `${indent}<string${k}>${escText(value)}</string>`;
  if (typeof value === 'number') return `${indent}<number${k}>${value}</number>`;
  if (typeof value === 'boolean') return `${indent}<boolean${k}>${value}</boolean>`;
  if (Array.isArray(value)) {
    if (value.length && allScalar(value)) return `${indent}<array${k}>${value.map((x) => toXml(x, '')).join('')}</array>`;
    return `${indent}<array${k}>\n${value.map((x) => toXml(x, `${indent}  `)).join('\n')}\n${indent}</array>`;
  }
  const e = Object.entries(value);
  return `${indent}<map${k}${indent === '' && key === undefined ? ` xmlns="${FN}"` : ''}>${e.length ? `\n${e.map(([kk, x]) => toXml(x, `${indent}  `, kk)).join('\n')}\n${indent}` : ''}</map>`;
}
const unescapeJson = (s, line) => { try { return JSON.parse(`"${s}"`); } catch { throw new Error(`invalid escaped string at line ${line}`); } };
function fromXmlElement(el) {
  const kids = () => Array.from(el.childNodes).filter((n) => n.nodeType === 1);
  switch (el.localName) {
    case 'null': return null;
    case 'string': return el.getAttribute('escaped') === 'true' ? unescapeJson(el.textContent, el.lineNumber) : el.textContent;
    case 'number': { const n = Number(el.textContent.trim()); if (!Number.isFinite(n)) throw new Error(`invalid number at line ${el.lineNumber}`); return n; }
    case 'boolean': { const t = el.textContent.trim(); if (t !== 'true' && t !== 'false') throw new Error(`invalid boolean at line ${el.lineNumber}`); return t === 'true'; }
    case 'array': return kids().map(fromXmlElement);
    case 'map': {
      // defineProperty keeps keys such as "__proto__" as ordinary data (#1791).
      const o = {};
      for (const c of kids()) {
        if (!c.hasAttribute('key')) throw new Error(`map entry without key at line ${c.lineNumber}`);
        const k = c.getAttribute('escaped-key') === 'true' ? unescapeJson(c.getAttribute('key'), c.lineNumber) : c.getAttribute('key');
        if (Object.hasOwn(o, k)) throw new Error(`duplicate key ${JSON.stringify(k)} at line ${c.lineNumber}`);
        Object.defineProperty(o, k, { value: fromXmlElement(c), enumerable: true, writable: true, configurable: true });
      }
      return o;
    }
    default: throw new Error(`unexpected element <${el.localName}> at line ${el.lineNumber}`);
  }
}
function parseXmlDom(text) {
  const errors = [];
  const doc = new DOMParser({ onError: (level, msg, locator) => { if (level !== 'warning') errors.push(`${msg}`); } }).parseFromString(text, 'text/xml');
  if (errors.length) throw new Error(errors.join('; '));
  return doc;
}
function xmlPathElement(doc, path) {
  let el = doc.documentElement;
  for (const k of path) {
    const kids = Array.from(el.childNodes).filter((n) => n.nodeType === 1);
    el = typeof k === 'number' ? kids[k] : kids.find((c) => c.getAttribute('key') === k);
    if (!el) return null;
  }
  return el;
}

// ---- KDL JiK path helpers (format-preserving edits on @bgotink/kdl) ----------
function kdlResolve(doc, path) {
  // Returns { node } for container/child-node values or { node, entry } for an entry value.
  let node = doc.nodes[0];
  for (let i = 0; i < path.length; i++) {
    const k = path[i];
    if (typeof k === 'number') {
      const kids = node.children?.nodes ?? [];
      if (kids.length) { node = kids[k]; continue; }
      const args = node.getArgumentEntries();
      return i === path.length - 1 ? { node, entry: args[k], argIndex: k } : null;
    }
    if (node.hasProperty(k)) return i === path.length - 1 ? { node, entry: node.getPropertyEntry(k), propName: k } : null;
    const child = node.children?.nodes.find((n) => n.getName() === k);
    if (!child) return null;
    node = child;
  }
  return { node };
}
// New nodes from fromJson() carry no surrounding whitespace; copy the layout
// trivia (leading/trailing) of a neighbouring node so the edit stays local.
const adopt = (fresh, like) => { if (like) { fresh.leading = like.leading; fresh.trailing = like.trailing; } return fresh; };
function kdlEdit(text, ops) {
  const doc = KDL.parse(text);
  for (const op of ops) {
    const parentPath = op.op === 'insert' || op.op === 'move' ? op.path : op.path.slice(0, -1);
    const key = op.path.at(-1);
    if (op.op === 'set') {
      const hit = kdlResolve(doc, op.path);
      if (hit?.entry && isScalar(op.value)) { hit.entry.setValue(op.value); continue; }
      const parent = kdlResolve(doc, parentPath).node;
      const fresh = KJ.fromJson(op.value, { nodeName: typeof key === 'number' ? '-' : key, indentation: 2 });
      if (hit?.entry) { hit.propName ? parent.deleteProperty(hit.propName) : parent.removeArgument(hit.argIndex); parent.appendNode(adopt(fresh, parent.children?.nodes.at(-1))); }
      else if (hit?.node) parent.replaceNode(hit.node, adopt(fresh, hit.node));
      else parent.appendNode(adopt(fresh, parent.children?.nodes.at(-1)));
    } else if (op.op === 'delete') {
      const hit = kdlResolve(doc, op.path); const parent = kdlResolve(doc, parentPath).node;
      if (hit.entry) hit.propName ? parent.deleteProperty(hit.propName) : parent.removeArgument(hit.argIndex); else parent.removeNode(hit.node);
    } else if (op.op === 'insert') {
      const arr = kdlResolve(doc, op.path).node; const kids = arr.children?.nodes ?? [];
      if (isScalar(op.value) && !kids.length) { arr.addArgument(op.value, null, op.index); continue; }
      if (!kids.length && arr.hasArguments()) {
        // JiK keeps all-scalar arrays as arguments; inserting a non-scalar element
        // rebuilds just this array node through JiK so the index is honoured (#1793).
        const cur = KJ.toJson(arr); cur.splice(op.index, 0, op.value);
        const parent = op.path.length > 1 ? kdlResolve(doc, op.path.slice(0, -1)).node : doc.nodes[0];
        parent.replaceNode(arr, adopt(KJ.fromJson(cur, { nodeName: arr.getName(), indentation: 2 }), arr));
        continue;
      }
      arr.insertNodeBefore(adopt(KJ.fromJson(op.value, { nodeName: '-', indentation: 2 }), kids[op.index] ?? kids.at(-1)), kids[op.index] ?? null);
    } else if (op.op === 'move') {
      const arr = kdlResolve(doc, op.path).node; const kids = arr.children?.nodes ?? [];
      if (!kids.length) {
        // All-scalar array stored as arguments (#1794): reorder the arguments.
        const values = arr.getArguments(); const [x] = values.splice(op.from, 1); values.splice(op.to, 0, x);
        values.forEach((val, i) => arr.getArgumentEntries()[i].setValue(val));
        continue;
      }
      const moving = kids[op.from];
      arr.removeNode(moving); arr.insertNodeBefore(moving, arr.children.nodes[op.to] ?? null);
    }
  }
  return KDL.format(doc);
}

// ---- codecs -----------------------------------------------------------------
// stringify(value) canonical writer; parse(text) -> value (throws with
// .line/.col when known); edit(text, ops) format-preserving edit or null;
// locate(text, path) -> {line, col} or null.
const errorAt = (message, line, col) => Object.assign(new Error(message), { line, col });

export const CODECS = {
  yaml: {
    notation: 'YAML 1.2', ext: 'yaml', libraries: ['yaml'], printer: 'library (yaml Document, flow style for scalar arrays)',
    stringify(value) {
      const doc = new YAML.Document(value);
      YAML.visit(doc, { Seq(_, node) { if (node.items.every((n) => YAML.isScalar(n))) node.flow = true; } });
      return doc.toString({ lineWidth: 0, minContentWidth: 0, flowCollectionPadding: false });
    },
    parse(text) {
      const doc = YAML.parseDocument(text, { uniqueKeys: true, prettyErrors: true });
      if (doc.errors.length) { const e = doc.errors[0]; throw errorAt(e.message.split('\n')[0], e.linePos?.[0]?.line, e.linePos?.[0]?.col); }
      return doc.toJS({ maxAliasCount: 100 });
    },
    edit(text, ops) {
      const doc = YAML.parseDocument(text);
      for (const op of ops) {
        if (op.op === 'set') doc.setIn(op.path, doc.createNode(op.value, { flow: false }));
        else if (op.op === 'delete') doc.deleteIn(op.path);
        else if (op.op === 'insert') doc.getIn(op.path, true).items.splice(op.index, 0, doc.createNode(op.value));
        else if (op.op === 'move') { const seq = doc.getIn(op.path, true); const [x] = seq.items.splice(op.from, 1); seq.items.splice(op.to, 0, x); }
      }
      YAML.visit(doc, { Seq(_, node) { if (!node.flow && node.items.length && node.items.every((n) => YAML.isScalar(n))) node.flow = true; } });
      return doc.toString({ lineWidth: 0, minContentWidth: 0, flowCollectionPadding: false });
    },
    locate(text, path) {
      const lc = new YAML.LineCounter(); const doc = YAML.parseDocument(text, { lineCounter: lc, keepSourceTokens: true });
      for (let n = path.length; n >= 0; n--) { const node = doc.getIn(path.slice(0, n), true); if (node?.range) return lc.linePos(node.range[0]); }
      return null;
    },
  },
  json: {
    notation: 'JSON (RFC 8259)', ext: 'json', libraries: [], printer: 'JSON.stringify(v, null, 2) (built-in)',
    stringify: (value) => `${JSON.stringify(value, null, 2)}\n`,
    parse(text) { try { return JSON.parse(text); } catch (e) { const m = /position (\d+)/.exec(e.message); const p = m ? lineCol(text, Number(m[1])) : {}; throw errorAt(e.message, p.line, p.col); } },
    edit: (text, ops) => jsoncEdit(text, ops),
    locate: (text, path) => jsoncLocate(text, path),
  },
  'json-layout': {
    notation: 'JSON (RFC 8259)', ext: 'json', libraries: ['jsonc-parser'], printer: 'project-owned layout printer (scalar arrays inline)',
    stringify: (value) => `${layout(value, 'json')}\n`,
    parse: (text) => CODECS.json.parse(text),
    edit: (text, ops) => jsoncEdit(text, ops),
    locate: (text, path) => jsoncLocate(text, path),
  },
  json5: {
    notation: 'JSON5 1.0', ext: 'json5', libraries: ['json5'], printer: 'library json5.stringify(v, null, 2)',
    stringify: (value) => `${JSON5.stringify(value, null, 2)}\n`,
    parse(text) { try { return JSON5.parse(text); } catch (e) { throw errorAt(e.message, e.lineNumber, e.columnNumber); } },
    edit: null, locate: null,
  },
  'json5-layout': {
    notation: 'JSON5 1.0', ext: 'json5', libraries: ['json5'], printer: 'project-owned layout printer (unquoted keys, trailing commas)',
    stringify: (value) => `${layout(value, 'json5')}\n`,
    parse: (text) => CODECS.json5.parse(text),
    edit: null, locate: null,
  },
  hjson: {
    notation: 'Hjson 3', ext: 'hjson', libraries: ['hjson'], printer: 'library Hjson.stringify (condense 80, braces same line)',
    stringify: (value) => `${Hjson.stringify(value, { condense: 80, bracesSameLine: true, quotes: 'min', multiline: 'std', separator: false, space: 2, emitRootBraces: true })}\n`,
    parse(text) { try { return Hjson.parse(text); } catch (e) { const m = /line (\d+):(\d+)/.exec(e.message); throw errorAt(e.message.split('\n')[0], m && Number(m[1]), m && Number(m[2])); } },
    edit(text, ops) {
      // Hjson "round trip" API: comments are attached to the parsed object.
      const o = Hjson.rt.parse(text);
      const v = applyOpsInPlace(o, ops);
      return `${Hjson.rt.stringify(v, { condense: 80, bracesSameLine: true, quotes: 'min', multiline: 'std', separator: false, space: 2 })}\n`;
    },
    locate: null,
  },
  toml: {
    notation: 'TOML 1.0', ext: 'toml', libraries: ['@decimalturn/toml-patch', 'smol-toml'], printer: 'library toml-patch stringify (multilineArray=false); null mapped to { "$null" = true }',
    stringify: (value) => TOMLP.stringify(tomlEncode(value), tomlFormat()),
    parse(text) { try { return tomlDecode(SMOL.parse(text)); } catch (e) { throw errorAt(e.message.split('\n')[0], e.line, e.column); } },
    edit: (text, ops) => TOMLP.patch(text, tomlEncode(applyOps(tomlDecode(SMOL.parse(text)), ops))),
    locate: (text, path) => tomlLocate(text, path),
  },
  'toml-rows': {
    notation: 'TOML 1.0', ext: 'toml', libraries: ['@decimalturn/toml-patch', 'smol-toml'], printer: 'toml-patch stringify + project-owned reflow of arrays-of-arrays one row per line',
    stringify: (value) => tomlReflowRows(TOMLP.stringify(tomlEncode(value), tomlFormat())),
    parse: (text) => CODECS.toml.parse(text),
    edit: (text, ops) => TOMLP.patch(text, tomlEncode(applyOps(tomlDecode(SMOL.parse(text)), ops))),
    locate: (text, path) => tomlLocate(text, path),
  },
  kdl: {
    notation: 'KDL 2.0 via JSON-in-KDL (JiK 4.0.0)', ext: 'kdl', libraries: ['@bgotink/kdl'], printer: 'library JiK stringify (indentation 2)',
    stringify: (value) => `${KJ.stringify(value, { indentation: 2 })}\n`,
    parse(text) { try { return KJ.parse(text); } catch (e) { const loc = e.errors?.[0]?.start ?? e.start; throw errorAt(e.message.split('\n')[0], loc?.line, loc?.column); } },
    edit: (text, ops) => kdlEdit(text, ops),
    locate(text, path) {
      const doc = KDL.parse(text, { storeLocations: true });
      for (let n = path.length; n >= 0; n--) { const hit = kdlResolve(doc, path.slice(0, n)); const el = hit?.entry ?? hit?.node; const loc = el && KDL.getLocation(el); if (loc) return { line: loc.start.line, col: loc.start.column }; }
      return null;
    },
  },
  edn: {
    notation: 'EDN', ext: 'edn', libraries: ['edn-data'], printer: 'project-owned layout printer (edn-data emits one line)',
    stringify: (value) => `${layout(value, 'edn')}\n`,
    parse(text) { return EDN.parseEDNString(text, { mapAs: 'object', keywordAs: 'string', listAs: 'array' }); },
    edit: null, locate: null,
  },
  'edn-oneline': {
    notation: 'EDN', ext: 'edn', libraries: ['edn-data'], printer: 'library toEDNStringFromSimpleObject (single line)',
    stringify: (value) => `${EDN.toEDNStringFromSimpleObject(value)}\n`,
    parse: (text) => CODECS.edn.parse(text),
    edit: null, locate: null,
  },
  ron: {
    notation: 'RON (ron 0.12.3, untyped serde_json bridge)', ext: 'ron', libraries: ['ron crate 0.12.3 via ron-bridge (Rust CLI)'], printer: 'ron PrettyConfig (compact_arrays=false)',
    stringify: (value) => execFileSync(RON_BRIDGE, ['from-json'], { input: JSON.stringify(value) }).toString(),
    parse: (text) => ronParse(text),
    edit: null, locate: null,
  },
  'ron-compact': {
    notation: 'RON (ron 0.12.3, untyped serde_json bridge)', ext: 'ron', libraries: ['ron crate 0.12.3 via ron-bridge (Rust CLI)'], printer: 'ron PrettyConfig (compact_arrays=true)',
    stringify: (value) => execFileSync(RON_BRIDGE, ['from-json-compact'], { input: JSON.stringify(value) }).toString(),
    parse: (text) => ronParse(text),
    edit: null, locate: null,
  },
  xml: {
    notation: 'XML 1.0, W3C XPath 3.1 JSON representation', ext: 'xml', libraries: ['@xmldom/xmldom'], printer: 'project-owned writer of the W3C fn:json-to-xml vocabulary',
    stringify: (value) => `<?xml version="1.0" encoding="UTF-8"?>\n${toXml(value)}\n`,
    parse: (text) => fromXmlElement(parseXmlDom(text).documentElement),
    edit(text, ops) {
      const doc = parseXmlDom(text);
      const make = (v, key, depth) => parseXmlDom(toXml(v, '  '.repeat(depth), key).replace(/^\s+/, '').replace(/^<(\w+)/, `<$1 xmlns="${FN}"`)).documentElement;
      for (const op of ops) {
        if (op.op === 'set') {
          const el = xmlPathElement(doc, op.path); const key = typeof op.path.at(-1) === 'number' ? undefined : op.path.at(-1);
          const parent = xmlPathElement(doc, op.path.slice(0, -1)); const fresh = doc.importNode(make(op.value, key, op.path.length), true); fresh.removeAttribute('xmlns');
          if (el) parent.replaceChild(fresh, el); else { parent.insertBefore(doc.createTextNode('  '), parent.lastChild); parent.insertBefore(fresh, parent.lastChild); parent.insertBefore(doc.createTextNode(`\n${'  '.repeat(op.path.length - 1)}`), parent.lastChild); }
        } else if (op.op === 'delete') { const el = xmlPathElement(doc, op.path); const prev = el.previousSibling; if (prev?.nodeType === 3) prev.parentNode.removeChild(prev); el.parentNode.removeChild(el); }
        else if (op.op === 'insert') { const arr = xmlPathElement(doc, op.path); const kids = Array.from(arr.childNodes).filter((n) => n.nodeType === 1); const fresh = doc.importNode(make(op.value, undefined, op.path.length + 1), true); fresh.removeAttribute('xmlns'); const ref = kids[op.index] ?? arr.lastChild; arr.insertBefore(fresh, ref); arr.insertBefore(doc.createTextNode(`\n${'  '.repeat(op.path.length + 1)}`), ref); }
        else if (op.op === 'move') { const arr = xmlPathElement(doc, op.path); const kids = Array.from(arr.childNodes).filter((n) => n.nodeType === 1); const m = kids[op.from]; const ws = m.previousSibling; arr.removeChild(m); const rest = kids.filter((k) => k !== m); const ref = rest[op.to] ?? null; arr.insertBefore(m, ref ? ref : arr.lastChild); arr.insertBefore(ws?.nodeType === 3 ? ws : doc.createTextNode('\n'), m); }
      }
      return new XMLSerializer().serializeToString(doc).replace(/^(<\?xml[^>]*\?>)(?!\n)/, '$1\n') + (text.endsWith('\n') ? '\n' : '');
    },
    locate(text, path) { const doc = parseXmlDom(text); for (let n = path.length; n >= 0; n--) { const el = xmlPathElement(doc, path.slice(0, n)); if (el) return { line: el.lineNumber, col: el.columnNumber }; } return null; },
  },
};

function applyOpsInPlace(o, ops) {
  for (const op of ops) {
    const parent = getAt(o, op.path.slice(0, -1)); const key = op.path.at(-1);
    if (op.op === 'set') parent[key] = structuredClone(op.value);
    else if (op.op === 'delete') { if (Array.isArray(parent)) parent.splice(key, 1); else delete parent[key]; }
    else if (op.op === 'insert') getAt(o, op.path).splice(op.index, 0, structuredClone(op.value));
    else if (op.op === 'move') { const a = getAt(o, op.path); const [x] = a.splice(op.from, 1); a.splice(op.to, 0, x); }
  }
  return o;
}
// Strict JSON open/save (#1783): the input must parse as RFC 8259 JSON before
// any edit (an empty edit list is a real parse + save, not a pass-through), and
// the edited text must parse again.
function jsoncEdit(text, ops) {
  CODECS.json.parse(text);
  const fo = { formattingOptions: { insertSpaces: true, tabSize: 2, eol: /\r\n/.test(text) ? '\r\n' : '\n' } };
  for (const op of ops) {
    if (op.op === 'set') text = JSONC.applyEdits(text, JSONC.modify(text, op.path, op.value, fo));
    else if (op.op === 'delete') text = JSONC.applyEdits(text, JSONC.modify(text, op.path, undefined, fo));
    else if (op.op === 'insert') text = JSONC.applyEdits(text, JSONC.modify(text, [...op.path, op.index], op.value, { ...fo, isArrayInsertion: true }));
    else if (op.op === 'move') { const v = getAt(JSONC.parse(text), [...op.path, op.from]); text = JSONC.applyEdits(text, JSONC.modify(text, [...op.path, op.from], undefined, fo)); text = JSONC.applyEdits(text, JSONC.modify(text, [...op.path, op.to], v, { ...fo, isArrayInsertion: true })); }
  }
  CODECS.json.parse(text);
  return text;
}
function jsoncLocate(text, path) {
  const tree = JSONC.parseTree(text);
  for (let n = path.length; n >= 0; n--) { const node = JSONC.findNodeAtLocation(tree, path.slice(0, n)); if (node) { const target = node.parent?.type === 'property' ? node.parent : node; return lineCol(text, target.offset); } }
  return null;
}
function tomlLocate(text, path) {
  // Walk the toml-eslint-parser AST, computing each key/value's logical path.
  const ast = TomlAst.parseTOML(text);
  let best = null, bestLen = -1;
  const counters = new Map();
  for (const table of ast.body[0].body) {
    let base = [];
    if (table.type === 'TOMLTable') {
      const keys = table.resolvedKey;
      base = keys.map((k) => k);
      const consider = (p, node) => { const n = commonPrefix(p, path); if (n === p.length && n > bestLen) { bestLen = n; best = node; } };
      consider(base, table);
      for (const kv of table.body) visitKv(kv, base, consider);
    } else if (table.type === 'TOMLKeyValue') visitKv(table, [], (p, node) => { const n = commonPrefix(p, path); if (n === p.length && n > bestLen) { bestLen = n; best = node; } });
  }
  void counters;
  return best ? { line: best.loc.start.line, col: best.loc.start.column + 1 } : null;
}
function visitKv(kv, base, consider) {
  const p = [...base, ...kv.key.keys.map((k) => k.name ?? k.value)];
  consider(p, kv);
  const walk = (node, prefix) => {
    if (node.type === 'TOMLArray') node.elements.forEach((e, i) => { consider([...prefix, i], e); walk(e, [...prefix, i]); });
    else if (node.type === 'TOMLInlineTable') for (const k of node.body) { const q = [...prefix, ...k.key.keys.map((x) => x.name ?? x.value)]; consider(q, k); walk(k.value, q); }
  };
  walk(kv.value, p);
}
const commonPrefix = (a, b) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i; };
function ronParse(text) {
  const r = spawnSync(RON_BRIDGE, ['to-json'], { input: text });
  const out = r.stdout.toString();
  if (r.status !== 0) { const e = JSON.parse(out); throw errorAt(e.error, e.line, e.col); }
  return JSON.parse(out);
}

/** Extra candidates exercised for viability only (not full adapters). */
export async function loadViabilityProbes() {
  const ron = req('rusty-object-notation');
  const sdl = await import(pathToFileURL(join(LIBS, 'bundles/sdlang.mjs')).href);
  return { ron, sdl };
}
