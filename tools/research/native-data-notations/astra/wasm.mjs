// Real Node and Chromium calls into official ron-rs compiled to WebAssembly.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
const scratch = process.argv[2];
const req = createRequire(join(scratch, 'package.json'));
const wasm = readFileSync(join(scratch, 'ron-target/wasm32-unknown-unknown/release/notation_ron_probe.wasm'));
const data = JSON.parse(readFileSync(join(scratch, 'fixtures/Caoquest.json'), 'utf8'));
const schema = JSON.parse(readFileSync(join(scratch, 'schemas/core.json'), 'utf8'));
const args = { bytes: Array.from(wasm), data, schema };
async function probe({ bytes, data, schema }) {
  const start = performance.now();
  const { instance } = await WebAssembly.instantiate(new Uint8Array(bytes));
  const api = instance.exports;
  const encoder = new TextEncoder(), decoder = new TextDecoder();
  function convert(text, encode) {
    const input = encoder.encode(text), ptr = api.input_alloc(input.length);
    new Uint8Array(api.memory.buffer, ptr, input.length).set(input);
    const descriptor = api.convert(ptr, input.length, encode);
    api.input_free(ptr, input.length);
    const outPtr = Number(descriptor & 0xffffffffn), len = Number(descriptor >> 32n);
    const output = decoder.decode(new Uint8Array(api.memory.buffer, outPtr, len));
    api.input_free(outPtr, len);
    const result = JSON.parse(output);
    if (!result.ok) throw new Error(result.error);
    return encode ? result.text : result.value;
  }
  const serialized = convert(JSON.stringify(data), true);
  const roundtrip = convert(serialized, false);
  const edited = structuredClone(roundtrip); edited.actor.name = 'browser-wasm-review';
  const back = convert(convert(JSON.stringify(edited), true), false);
  const validate = new globalThis.Ajv2020({ allErrors: true }).compile(schema);
  const valid = validate(roundtrip); const invalid = structuredClone(roundtrip); invalid.scene.width = -1;
  let syntaxError = null; try { convert('{"x": [', false); } catch (error) { syntaxError = String(error); }
  return { roundtrip: JSON.stringify(roundtrip) === JSON.stringify(data), edited: back.actor.name === 'browser-wasm-review',
    valid, invalidRejected: !validate(invalid), syntaxError, bytes: encoder.encode(serialized).length,
    elapsedIncludingInstantiationMs: performance.now() - start, parser: 'official ron-rs 0.12.3; custom ABI only' };
}
globalThis.Ajv2020 = req('ajv/dist/2020.js').default;
const result = { wasmBytes: wasm.length, gzipBytes: gzipSync(wasm).length, node: await probe(args) };
const bundle = await req('esbuild').build({ stdin: { contents: "import Ajv2020 from 'ajv/dist/2020.js';globalThis.Ajv2020=Ajv2020;", resolveDir: scratch }, bundle: true, platform: 'browser', write: false });
const browser = await req('playwright').chromium.launch({ executablePath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', headless: true });
try {
  result.browserVersion = await browser.version();
  const page = await browser.newPage();
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  result.browser = await page.evaluate(probe, args);
} finally { await browser.close(); }
writeFileSync(join(scratch, 'wasm-results.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
