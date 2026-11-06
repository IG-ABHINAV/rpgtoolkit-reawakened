// Real AudioWorklet probe, loaded only by the desktop CSP integration test.
const waitMessage = (port, kind) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    port.removeEventListener("message", handler);
    reject(new Error(`worklet did not report ${kind}`));
  }, 5000);
  const handler = (event) => {
    if (event.data.kind !== kind) return;
    clearTimeout(timer);
    port.removeEventListener("message", handler);
    resolve(event.data);
  };
  port.addEventListener("message", handler);
  port.start();
});

async function setup(url) {
  const context = new AudioContext();
  await context.audioWorklet.addModule(url);
  const control = new AudioWorkletNode(context, "decoder-probe-control");
  const processor = new AudioWorkletNode(context, "tkr-pcm-processor", { outputChannelCount: [2] });
  const meter = new AudioWorkletNode(context, "decoder-probe-meter");
  processor.connect(meter).connect(context.destination);
  control.connect(context.destination);
  await context.resume();
  const pending = waitMessage(control.port, "pending");
  control.port.postMessage({ kind: "pending" });
  await pending;
  return { context, control, processor, meter };
}

async function measure(meter) {
  const result = waitMessage(meter.port, "measured");
  meter.port.postMessage({ kind: "measure", frames: 24000 });
  return (await result).energy;
}

export async function probeWorkletDecoder(url) {
  const bank = new Uint8Array(await (await fetch("/packages/synth/test/fixtures/test-minimal.sf3")).arrayBuffer());
  const midi = new Uint8Array(await (await fetch("/packages/core/test/fixtures/audio/files/midi0-480-default-tempo.mid")).arrayBuffer());
  const session = await setup(url);
  const { context, control, processor, meter } = session;
  try {
    const send = (message) => processor.port.postMessage({ kind: "message", message });
    send({ kind: "setBank", bankKind: "soundfont", bank: { source: "bundled", id: "test", sha256: null }, bankBytes: bank, bankSha: "test" });
    send({ kind: "load", voice: 1, track: "music", asset: "media/test.mid", data: midi });
    send({ kind: "play", voice: 1, cue: 1, loop: false, volume: 100, positionTicks: 0 });
    const before = await measure(meter);
    const released = waitMessage(control.port, "released");
    control.port.postMessage({ kind: "resolve" });
    await released;
    const after = await measure(meter);
    return { before, after };
  } finally {
    await context.close();
  }
}

export async function probeWorkletFailure(url) {
  const { context, control, processor, meter } = await setup(url);
  try {
    const failure = waitMessage(processor.port, "decoder.error");
    const bank = new Uint8Array(await (await fetch("/packages/synth/test/fixtures/test-minimal.sf3")).arrayBuffer());
    processor.port.postMessage({ kind: "message", message: { kind: "setBank", bankKind: "soundfont", bank: { source: "bundled", id: "test", sha256: null }, bankBytes: bank, bankSha: "test" } });
    control.port.postMessage({ kind: "reject" });
    const error = await failure;
    const wav = new Uint8Array(await (await fetch("/packages/core/test/fixtures/audio/files/pcm16-mono-8000.wav")).arrayBuffer());
    const send = (message) => processor.port.postMessage({ kind: "message", message });
    send({ kind: "load", voice: 2, track: "sfx", asset: "media/test.wav", data: wav });
    send({ kind: "play", voice: 2, cue: 2, loop: false, volume: 100, positionTicks: 0 });
    const pcmEnergy = await measure(meter);
    const plainBank = new Uint8Array(await (await fetch("/packages/synth/test/fixtures/test-minimal.sf2")).arrayBuffer());
    const midi = new Uint8Array(await (await fetch("/packages/core/test/fixtures/audio/files/midi0-480-default-tempo.mid")).arrayBuffer());
    send({ kind: "setBank", bankKind: "soundfont", bank: { source: "bundled", id: "plain", sha256: null }, bankBytes: plainBank, bankSha: "plain" });
    send({ kind: "load", voice: 3, track: "music", asset: "media/test.mid", data: midi });
    send({ kind: "play", voice: 3, cue: 3, loop: false, volume: 100, positionTicks: 0 });
    const plainEnergy = await measure(meter);
    return { ...error, pcmEnergy, plainEnergy };
  } finally {
    await context.close();
  }
}
