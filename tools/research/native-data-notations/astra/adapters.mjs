// Research value mappings, not new parsers. Dependencies are supplied by the host.
// All notations receive identical JSON-domain data; object key order is not semantic.
export function createAdapters({ YAML, KDL, KJSON, TOML, JSON5, Hjson, EDN, XML, SDL }) {
  const json = value => JSON.stringify(value, null, 2) + '\n';
  function mapNull(value) {
    if (value === null) return { __tkr_null: true };
    if (Array.isArray(value)) return value.map(mapNull);
    if (typeof value !== 'object') return value;
    const entries = Object.entries(value).map(([k, v]) => [k, mapNull(v)]);
    const object = Object.fromEntries(entries);
    return entries.length === 1 && ['__tkr_null', '__tkr_escaped_object'].includes(entries[0][0])
      ? { __tkr_escaped_object: object } : object;
  }
  function unmapNull(value) {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(unmapNull);
    if (Object.keys(value).length === 1 && value.__tkr_null === true) return null;
    const object = Object.keys(value).length === 1 && '__tkr_escaped_object' in value ? value.__tkr_escaped_object : value;
    return Object.fromEntries(Object.entries(object).map(([k, v]) => [k, unmapNull(v)]));
  }
  const set = (object, path, value) => { let node = object; for (const key of path.slice(0, -1)) node = node[key]; node[path.at(-1)] = value; };
  function yamlDocument(text) {
    const doc = YAML.parseDocument(text, { version: '1.2', keepSourceTokens: true, uniqueKeys: true });
    if (doc.errors.length) throw doc.errors[0];
    return doc;
  }
  const xmlOptions = { ignoreAttributes: false, parseTagValue: false, parseAttributeValue: false,
    trimValues: false, format: true, indentBy: '  ', isArray: name => name === 'v', processEntities: true, htmlEntities: true };
  const xmlParser = new XML.XMLParser(xmlOptions);
  // Attribute-value normalization would fold tab/newline/CR to spaces, so keys
  // use numeric references there. Character data keeps literal tab/newline for
  // readability; CR must be referenced or parsers normalize it to LF.
  const escapeText = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('\r', '&#13;');
  const escapeAttribute = text => escapeText(text).replaceAll('"', '&quot;').replaceAll("'", '&apos;')
    .replaceAll('\t', '&#9;').replaceAll('\n', '&#10;');
  const xmlBuilder = new XML.XMLBuilder({ ...xmlOptions, processEntities: false,
    tagValueProcessor: (_name, value) => escapeText(value),
    attributeValueProcessor: (_name, value) => escapeAttribute(value) });
  const xmlCharAllowed = code => code === 9 || code === 10 || code === 13 ||
    (code >= 0x20 && code <= 0xd7ff) || (code >= 0xe000 && code <= 0xfffd) || (code >= 0x10000 && code <= 0x10ffff);
  function assertXmlCharacters(text) {
    for (const char of text) if (!xmlCharAllowed(char.codePointAt(0))) throw new Error('XML10_FORBIDDEN_CHARACTER U+' + char.codePointAt(0).toString(16).toUpperCase().padStart(4, '0'));
  }
  function assertXmlReferences(text) {
    // Lexical character-reference guard only; CDATA, comments and PIs contain
    // literal text, not expanded character references. XML parsing stays in FXP.
    for (const match of text.matchAll(/<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|&#(?:x([0-9a-fA-F]+)|([0-9]+));/g)) {
      if (match[1] === undefined && match[2] === undefined) continue;
      const code = Number.parseInt(match[1] ?? match[2], match[1] === undefined ? 10 : 16);
      if (!xmlCharAllowed(code)) throw new Error('XML10_FORBIDDEN_REFERENCE ' + match[0]);
    }
  }
  function xmlNode(value, key = '') {
    assertXmlCharacters(key);
    if (typeof value === 'string') assertXmlCharacters(value);
    const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    const result = { '@_key': key, '@_type': type };
    if (type === 'array') result.v = value.map((v, i) => xmlNode(v, String(i)));
    else if (type === 'object') result.v = Object.entries(value).map(([k, v]) => xmlNode(v, k));
    else if (type !== 'null') result['#text'] = String(value);
    return result;
  }
  function fromXml(node) {
    assertXmlCharacters(node['@_key'] ?? '');
    if (typeof node['#text'] === 'string') assertXmlCharacters(node['#text']);
    const type = node['@_type'];
    if (type === 'null') return null;
    if (type === 'object') return Object.fromEntries((node.v ?? []).map(v => [v['@_key'], fromXml(v)]));
    if (type === 'array') return (node.v ?? []).map(fromXml);
    if (type === 'number') return Number(node['#text']);
    if (type === 'boolean') {
      if (node['#text'] !== 'true' && node['#text'] !== 'false') throw new Error('XML_BOOLEAN_LEXICAL_VALUE must be true or false');
      return node['#text'] === 'true';
    }
    return node['#text'] ?? '';
  }
  // The published SDLang serializer omits string escaping, and its parser
  // rejects native null. This explicitly labelled mapping uses a null type
  // marker and a small emitter; parsing still uses the unmodified library.
  function sdlText(value, key = '', depth = 0) {
    const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    const prefix = '  '.repeat(depth) + 'entry ' + JSON.stringify(key);
    if (type === 'null') return prefix + ' type="null"\n';
    if (type !== 'array' && type !== 'object') return prefix + ' ' + JSON.stringify(value) + (type === 'number' && !Number.isInteger(value) ? 'd' : '') + ' type="' + type + '"\n';
    const children = type === 'array' ? value.map((v, i) => [String(i), v]) : Object.entries(value);
    return prefix + ' type="' + type + '" {\n' + children.map(([k, v]) => sdlText(v, k, depth + 1)).join('') + '  '.repeat(depth) + '}\n';
  }
  function fromSdl(node) {
    const type = node.getAttributeString('type');
    if (type === 'null') return null;
    if (type === 'object') return Object.fromEntries(node.children.map(c => [c.getValueString(0), fromSdl(c)]));
    if (type === 'array') return node.children.map(fromSdl);
    return node.values[1].value.value;
  }
  // Layout-only serializer: scalar escaping remains the EDN library's job.
  // The stock EDN serializer emits a whole project on one line.
  function ednText(value, depth = 0) {
    if (!value || typeof value !== 'object') return EDN.toEDNStringFromSimpleObject(value);
    const indent = '  '.repeat(depth), child = indent + '  ';
    if (Array.isArray(value)) return value.every(v => !v || typeof v !== 'object')
      ? '[' + value.map(v => ednText(v, depth + 1)).join(' ') + ']'
      : '[\n' + value.map(v => child + ednText(v, depth + 1)).join('\n') + '\n' + indent + ']';
    return '{\n' + Object.entries(value).map(([k, v]) => child + EDN.toEDNStringFromSimpleObject(k) + ' ' + ednText(v, depth + 1)).join('\n') + '\n' + indent + '}';
  }
  const adapters = {
    JSON: { ext: 'json', comment: '', encode: json, decode: JSON.parse },
    YAML: { ext: 'yaml', comment: '# creator note\n', encode: value => YAML.stringify(value, { lineWidth: 0 }), decode: text => yamlDocument(text).toJS(),
      noop: text => yamlDocument(text).toString({ lineWidth: 0 }),
      edit: (text, path, value) => { const doc = yamlDocument(text); doc.setIn(path, value); return doc.toString({ lineWidth: 0 }); } },
    KDL: { ext: 'kdl', comment: '// creator note\n', encode: value => KDL.format(KJSON.fromJson(value, { indentation: 2, allowEntriesInObjects: false })), decode: KJSON.parse,
      noop: text => KDL.format(KDL.parse(text)),
      edit: (text, path, value) => {
        const doc = KDL.parse(text); let node = doc.nodes[0];
        for (const part of path) node = typeof part === 'number' ? node.children.nodes[part] : node.children.nodes.find(n => n.getName() === part);
        node.getArgumentEntry(0).setValue(value); return KDL.format(doc);
      } },
    TOML: { ext: 'toml', comment: '# creator note\n', encode: value => TOML.stringify(mapNull(value)), decode: text => unmapNull(TOML.parse(text)) },
    JSON5: { ext: 'json5', comment: '// creator note\n', encode: value => JSON5.stringify(value, null, 2) + '\n', decode: JSON5.parse },
    Hjson: { ext: 'hjson', comment: '# creator note\n', encode: value => Hjson.stringify(value, { space: 2, multiline: 'off' }) + '\n', decode: Hjson.parse,
      noop: text => Hjson.stringify(Hjson.rt.parse(text), { keepWsc: true, multiline: 'off' }),
      edit: (text, path, value) => { const data = Hjson.rt.parse(text); set(data, path, value); return Hjson.stringify(data, { keepWsc: true, multiline: 'off' }); } },
    EDN: { ext: 'edn', comment: '; creator note\n', encode: value => ednText(value) + '\n',
      decode: text => EDN.parseEDNString(text, { mapAs: 'object', keywordAs: 'string' }) },
    XML: { ext: 'xml', comment: '<!-- creator note -->\n', encode: value => xmlBuilder.build({ v: [xmlNode(value)] }),
      decode: text => { assertXmlCharacters(text); assertXmlReferences(text); const check = XML.XMLValidator.validate(text); if (check !== true) throw new Error(JSON.stringify(check)); return fromXml(xmlParser.parse(text).v[0]); } },
    SDLang: { ext: 'sdl', comment: '// creator note\n', encode: value => sdlText(value), decode: text => fromSdl(new SDL.SdlReader(text).toAst().children[0]) },
  };
  for (const adapter of Object.values(adapters)) {
    adapter.noop ??= text => adapter.encode(adapter.decode(text));
    adapter.edit ??= (text, path, value) => { const data = adapter.decode(text); set(data, path, value); return adapter.encode(data); };
  }
  return adapters;
}
