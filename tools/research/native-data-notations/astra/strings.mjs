// Syntax-specific manual spelling experiment; not the common serializer size comparison.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadAdapters } from './inspect.mjs';
const scratch = process.argv[2];
const { adapters } = await loadAdapters(scratch);
const source = 'mwin("Hello");\n// path C:\\games\\demo\n';
const text = {
  JSON: JSON.stringify({ source }, null, 2),
  YAML: 'source: |\n  mwin("Hello");\n  // path C:\\games\\demo\n',
  KDL: '- {\n  source #"""\n    mwin("Hello");\n    // path C:\\games\\demo\n\n    """#\n}\n',
  TOML: "source = '''\nmwin(\"Hello\");\n// path C:\\games\\demo\n'''\n",
  JSON5: '{ source: ' + JSON.stringify(source) + ' }',
  Hjson: "{\n source: '''\n  mwin(\"Hello\");\n  // path C:\\games\\demo\n\n  '''\n}\n",
  EDN: '{"source" "mwin(\\"Hello\\");\n// path C:\\\\games\\\\demo\n"}',
  XML: '<v type="object"><v key="source" type="string"><![CDATA[' + source + ']]></v></v>',
  SDLang: 'entry "" type="object" {\n entry "source" `' + source + '` type="string"\n}\n',
  RON: '{"source": r#"' + source + '"#}',
};
const out = join(scratch, 'native-string-examples'); mkdirSync(out, { recursive: true });
const results = {};
for (const [name, document] of Object.entries(text)) {
  writeFileSync(join(out, 'source.' + adapters[name].ext), document);
  try {
    const parsed = adapters[name].decode(document);
    const changed = document.replace('Hello', 'Welcome');
    const edited = adapters[name].decode(changed);
    results[name] = { sourceEqual: parsed.source === source, rawTextEditEqual: edited.source === source.replace('Hello', 'Welcome'),
      newlinePreserved: parsed.source.endsWith('\n'), document };
  } catch (error) { results[name] = { error: String(error), document }; }
}
writeFileSync(join(scratch, 'native-string-results.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
