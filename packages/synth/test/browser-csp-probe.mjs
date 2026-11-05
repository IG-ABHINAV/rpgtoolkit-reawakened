// Test-only module bundled by probe-input.mjs and loaded under the live desktop page's CSP.
import { createSpessaMidiSource, soundFontDecoderReady } from "../src/index.ts";

export async function probeCompressedAudio() {
  await soundFontDecoderReady;
  const bank = new Uint8Array(await (await fetch("/packages/synth/test/fixtures/test-minimal.sf3")).arrayBuffer());
  const midi = new Uint8Array(await (await fetch("/packages/core/test/fixtures/audio/files/midi0-480-default-tempo.mid")).arrayBuffer());
  const result = createSpessaMidiSource({ bank, maxBufferSize: 256 }).open(midi, {
    outputRateHz: 22_050,
    bank: { source: "bundled", id: "test", sha256: null },
  });
  if (!result.ok) throw new Error(`compressed bank did not open: ${result.error.code}`);
  result.value.start(0, false);
  const left = new Float32Array(256);
  const right = new Float32Array(256);
  let energy = 0;
  for (let frames = 0; frames < 44_100 && !result.value.ended; frames += 256) {
    result.value.render(left, right, 256);
    for (let i = 0; i < 256; i += 1) energy += Math.abs(left[i] ?? 0) + Math.abs(right[i] ?? 0);
  }
  let evalBlocked = false;
  try { new Function("return 1")(); } catch (error) { evalBlocked = error instanceof EvalError; }
  return { energy, ended: result.value.ended, evalBlocked };
}
