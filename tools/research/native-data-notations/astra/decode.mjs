// Research host: existing public decoders only, never executes RPGCode.
import { CORE_DECODERS } from '@tk-reawakened/core';
import { createReadStream, createWriteStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';

const scratch = process.argv[2];
const sink = createWriteStream(join(scratch, 'decoded.jsonl'));
const counts = {};
for await (const line of createInterface({ input: createReadStream(join(scratch, 'payloads.jsonl')), crlfDelay: Infinity })) {
  const { base64, ...asset } = JSON.parse(line);
  const bytes = Buffer.from(base64, 'base64');
  const format = asset.prior.format;
  let result;
  if (format === 'program') {
    result = bytes[0] === 0 ? { ok: false, error: 'compiled source not inspected' }
      : { ok: true, value: { source: new TextDecoder('windows-1252').decode(bytes) }, warnings: [] };
  } else {
    try { result = CORE_DECODERS[format].decode(bytes, {}); }
    catch (error) { result = { ok: false, error: String(error) }; }
  }
  const key = `${asset.game}:${format}:${result.ok ? 'decoded' : 'failed'}`;
  counts[key] = (counts[key] ?? 0) + 1;
  sink.write(JSON.stringify({ ...asset, result }, (_key, value) => ArrayBuffer.isView(value) ? Array.from(value) : value) + '\n');
}
sink.end();
console.log(JSON.stringify(counts, null, 2));
