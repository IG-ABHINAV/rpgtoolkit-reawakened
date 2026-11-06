// Real AudioWorklet probe, loaded only by the desktop CSP integration test.
import { CuePlayer } from "@tk-reawakened/synth";
import { connectSinkToGraph, PcmSink } from "../src/audio-sink.ts";

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

async function measure(meter, frames = 24000) {
  const result = waitMessage(meter.port, "measured");
  meter.port.postMessage({ kind: "measure", frames });
  return (await result).energy;
}

export async function probeWorkletDecoder(url) {
  const bank = new Uint8Array(await (await fetch("/packages/synth/test/fixtures/test-minimal.sf3")).arrayBuffer());
  const midi = new Uint8Array(await (await fetch("/packages/core/test/fixtures/audio/files/midi0-480-default-tempo.mid")).arrayBuffer());
  const session = await setup(url);
  const { context, control, processor, meter } = session;
  try {
    const send = (message) => processor.port.postMessage({ kind: "message", message });
    const events = [];
    processor.port.addEventListener("message", ({ data }) => {
      if (["ready", "ended", "error", "bank.accepted", "decoder.error"].includes(data.kind)) events.push(data);
    });
    const ready = waitMessage(processor.port, "ready");
    send({ kind: "setBank", bankKind: "soundfont", bank: { source: "bundled", id: "test", sha256: null }, bankBytes: bank, bankSha: "test" });
    send({ kind: "load", voice: 1, track: "music", asset: "media/test.mid", data: midi });
    send({ kind: "play", voice: 1, cue: 1, loop: true, volume: 100, positionTicks: 0 });
    const before = await measure(meter);
    const released = waitMessage(control.port, "released");
    control.port.postMessage({ kind: "resolve-held" });
    await released;
    // Force the measurement window to elapse after the release ack but before the decoder finishes.
    const during = await measure(meter);
    control.port.postMessage({ kind: "finish" });
    const voiceReady = await ready;
    if (voiceReady.lengthTicks !== 120) throw new Error(`unexpected MIDI fixture length: ${voiceReady.lengthTicks}`);
    // Cover a complete loop, including the fixture's silent tail, regardless of measurement phase.
    const after = await measure(meter, Math.ceil(context.sampleRate * voiceReady.lengthTicks / 60) + 128);
    const compressedWindows = [await measure(meter), await measure(meter), await measure(meter)];
    // Compare controls in the same graph without turning a failed compressed-bank assertion green.
    send({ kind: "stop", voice: 1 });
    const wav = new Uint8Array(await (await fetch("/packages/core/test/fixtures/audio/files/pcm16-mono-8000.wav")).arrayBuffer());
    send({ kind: "load", voice: 2, track: "sfx", asset: "media/test.wav", data: wav });
    send({ kind: "play", voice: 2, cue: 2, loop: true, volume: 100, positionTicks: 0 });
    const pcm = [await measure(meter), await measure(meter), await measure(meter)];
    send({ kind: "stop", voice: 2 });
    const plain = new Uint8Array(await (await fetch("/packages/synth/test/fixtures/test-minimal.sf2")).arrayBuffer());
    const accepted = waitMessage(processor.port, "bank.accepted");
    send({ kind: "setBank", bankKind: "soundfont", bank: { source: "bundled", id: "plain", sha256: null }, bankBytes: plain, bankSha: "plain" });
    await accepted;
    const plainReady = waitMessage(processor.port, "ready");
    send({ kind: "load", voice: 3, track: "music", asset: "media/test.mid", data: midi });
    await plainReady;
    send({ kind: "play", voice: 3, cue: 3, loop: true, volume: 100, positionTicks: 0 });
    const plainMidi = [await measure(meter), await measure(meter), await measure(meter)];
    return { before, during, after, compressedWindows, pcm, plainMidi, events, sampleRate: context.sampleRate, state: context.state, currentTime: context.currentTime };
  } finally {
    await context.close();
  }
}

export async function probeWorkletFailure(url) {
  const { context, control, processor, meter } = await setup(url);
  try {
    const plainBank = new Uint8Array(await (await fetch("/packages/synth/test/fixtures/test-minimal.sf2")).arrayBuffer());
    const accepted = waitMessage(processor.port, "bank.accepted");
    processor.port.postMessage({ kind: "message", message: { kind: "setBank", bankKind: "soundfont", bank: { source: "bundled", id: "plain", sha256: null }, bankBytes: plainBank, bankSha: "plain" } });
    await accepted;
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
    const midi = new Uint8Array(await (await fetch("/packages/core/test/fixtures/audio/files/midi0-480-default-tempo.mid")).arrayBuffer());
    send({ kind: "load", voice: 3, track: "music", asset: "media/test.mid", data: midi });
    send({ kind: "play", voice: 3, cue: 3, loop: false, volume: 100, positionTicks: 0 });
    const plainEnergy = await measure(meter);
    return { ...error, pcmEnergy, plainEnergy };
  } finally {
    await context.close();
  }
}

/** The real cue player must not receive ready before the actual worklet can open its bank. */
export async function probeCueReadiness(url) {
  const bank = new Uint8Array(await (await fetch("/packages/synth/test/fixtures/test-minimal.sf3")).arrayBuffer());
  const midi = new Uint8Array(await (await fetch("/packages/core/test/fixtures/audio/files/midi0-480-default-tempo.mid")).arrayBuffer());
  const { context, control, meter } = await setup(url);
  let graph;
  try {
    let player;
    let readyCount = 0;
    let resolveReady;
    const bothReady = new Promise((resolve) => { resolveReady = resolve; });
    const sink = new PcmSink({
      outputRateHz: context.sampleRate,
      readAsset: () => midi,
      readBank: () => bank,
      onEvent(event) {
        if (event.kind === "ready") {
          queueMicrotask(() => {
            player.ready(event.voice, event.lengthTicks);
            if (++readyCount === 2) resolveReady();
          });
        }
      },
    });
    graph = await connectSinkToGraph(context, sink, { workletUrl: url });
    player = new CuePlayer({
      send: (message) => graph.send(message),
      readAsset: () => midi,
      bankLayers: { player: null, runner: null, bundled: { source: "bundled", id: "test", sha256: null } },
    });
    const cue = (cueId, kind, track, loop) => ({
      cueId, tick: 0, kind, track, voice: 0, asset: kind === "soundfont.set" ? null : "media/test.mid",
      loop, flags: null, positionTicks: 0, volume: 100, targetVolume: null, durationTicks: null,
    });
    player.advance([cue(1, "soundfont.set", null, null), cue(2, "media.play", "music", true), cue(3, "media.play", "sfx", false)]);
    await measure(meter);
    const early = sink.scheduled.length;
    player.reach(30);
    const released = waitMessage(control.port, "released");
    control.port.postMessage({ kind: "resolve" });
    await released;
    await Promise.race([bothReady, new Promise((_, reject) => setTimeout(() => reject(new Error("cue readiness timed out")), 5000))]);
    return { early, scheduled: sink.scheduled };
  } finally {
    graph?.disconnect();
    await context.close();
  }
}

/** A rejected compressed swap retains the old bank in both the graph and its host mirror. */
export async function probeGraphFallback(url) {
  const plain = new Uint8Array(await (await fetch("/packages/synth/test/fixtures/test-minimal.sf2")).arrayBuffer());
  const compressed = new Uint8Array(await (await fetch("/packages/synth/test/fixtures/test-minimal.sf3")).arrayBuffer());
  const midi = new Uint8Array(await (await fetch("/packages/core/test/fixtures/audio/files/midi0-480-default-tempo.mid")).arrayBuffer());
  const { context, control, meter } = await setup(url);
  let graph;
  try {
    const sink = new PcmSink({ outputRateHz: context.sampleRate, readAsset: () => midi, readBank: (bank) => bank.id === "plain" ? plain : compressed });
    graph = await connectSinkToGraph(context, sink, { workletUrl: url });
    graph.node.connect(meter);
    const setBank = (bank) => graph.send({ kind: "setBank", bankKind: "soundfont", bank });
    const plainRef = { source: "bundled", id: "plain", sha256: null };
    let accepted = waitMessage(graph.node.port, "bank.accepted");
    setBank(plainRef);
    await accepted;
    const failure = waitMessage(graph.node.port, "decoder.error");
    setBank({ source: "bundled", id: "compressed", sha256: null });
    control.port.postMessage({ kind: "reject" });
    await failure;
    const retained = sink.currentBank?.id;
    const ready = waitMessage(graph.node.port, "ready");
    graph.send({ kind: "load", voice: 4, track: "music", asset: "media/test.mid", data: midi });
    const { lengthTicks } = await ready;
    if (lengthTicks !== 120) throw new Error(`unexpected MIDI fixture length: ${lengthTicks}`);
    graph.send({ kind: "play", voice: 4, cue: 4, loop: true, volume: 100, positionTicks: 0 });
    // Let the audio thread advance past the original one-shot's end before observing the retained bank.
    // A delayed renderer must not miss the only sounding portion; sample a complete loop including its silent tail.
    await measure(meter, Math.ceil(context.sampleRate * (lengthTicks / 60 + 1)));
    const energy = await measure(meter, Math.ceil(context.sampleRate * lengthTicks / 60) + 128);
    graph.send({ kind: "stop", voice: 4 });
    accepted = waitMessage(graph.node.port, "bank.accepted");
    setBank(null);
    await accepted;
    const reset = sink.currentBank === null;
    accepted = waitMessage(graph.node.port, "bank.accepted");
    setBank(plainRef);
    await accepted;
    return { retained, energy, reset, restored: sink.currentBank?.id };
  } finally {
    graph?.disconnect();
    await context.close();
  }
}

/** A decoder that never settles must not hold unrelated voices or a replacement bank hostage. */
export async function probePendingIsolation(url) {
  const wav = new Uint8Array(await (await fetch("/packages/core/test/fixtures/audio/files/pcm16-mono-8000.wav")).arrayBuffer());
  const midi = new Uint8Array(await (await fetch("/packages/core/test/fixtures/audio/files/midi0-480-default-tempo.mid")).arrayBuffer());
  const compressed = new Uint8Array(await (await fetch("/packages/synth/test/fixtures/test-minimal.sf3")).arrayBuffer());
  const plain = new Uint8Array(await (await fetch("/packages/synth/test/fixtures/test-minimal.sf2")).arrayBuffer());
  const { context, processor, meter } = await setup(url);
  try {
    const send = (message) => processor.port.postMessage({ kind: "message", message });
    const fence = async () => {
      const response = waitMessage(processor.port, "latency");
      processor.port.postMessage({ kind: "latency" });
      await response;
    };
    const load = (voice) => send({ kind: "load", voice, track: "sfx", asset: "media/test.wav", data: wav });
    const play = (voice) => send({ kind: "play", voice, cue: voice, loop: true, volume: 100, positionTicks: 0 });
    load(1); play(1);
    send({ kind: "setBank", bankKind: "soundfont", bank: { source: "bundled", id: "compressed", sha256: null }, bankBytes: compressed, bankSha: "compressed" });
    send({ kind: "pause", voice: 1 });
    await fence();
    const paused = await measure(meter);
    send({ kind: "resume", voice: 1 });
    await fence();
    const resumed = await measure(meter);
    send({ kind: "setVolume", scope: "master", voice: null, bus: null, volume: 0 });
    await fence();
    const muted = await measure(meter);
    send({ kind: "setVolume", scope: "master", voice: null, bus: null, volume: 100 });
    send({ kind: "stop", voice: 1 });
    await fence();
    const stopped = await measure(meter);
    load(2); play(2);
    await fence();
    const unrelated = await measure(meter);
    send({ kind: "stop", voice: 2 });
    send({ kind: "load", voice: 3, track: "music", asset: "media/test.mid", data: midi });
    const ready = waitMessage(processor.port, "ready");
    send({ kind: "setBank", bankKind: "soundfont", bank: { source: "bundled", id: "plain", sha256: null }, bankBytes: plain, bankSha: "plain" });
    await ready;
    play(3);
    await fence();
    const superseded = await measure(meter, 48000);
    send({ kind: "setBank", bankKind: "soundfont", bank: { source: "bundled", id: "compressed", sha256: null }, bankBytes: compressed, bankSha: "compressed" });
    const resetAck = waitMessage(processor.port, "bank.accepted");
    send({ kind: "setBank", bankKind: "soundfont", bank: null, bankBytes: null, bankSha: null });
    const reset = (await resetAck).bank === null;
    return { paused, resumed, muted, stopped, unrelated, superseded, reset };
  } finally {
    await context.close();
  }
}

/** Release the decoder after replacing a pending bank and observe every actual bank installation. */
export async function probeReleasedSupersession(url, replacement) {
  const compressed = new Uint8Array(await (await fetch("/packages/synth/test/fixtures/test-minimal.sf3")).arrayBuffer());
  const plain = new Uint8Array(await (await fetch("/packages/synth/test/fixtures/test-minimal.sf2")).arrayBuffer());
  const { context, control, processor } = await setup(url);
  try {
    const installed = [];
    processor.port.addEventListener("message", ({ data }) => {
      if (data.kind === "bank.accepted") installed.push(data.bank?.id ?? null);
    });
    const sendBank = (id, bytes) => processor.port.postMessage({ kind: "message", message: {
      kind: "setBank", bankKind: "soundfont", bank: id === null ? null : { source: "bundled", id, sha256: null },
      bankBytes: bytes, bankSha: id,
    } });
    sendBank("old", compressed);
    const accepted = replacement === "compressed" ? null : waitMessage(processor.port, "bank.accepted");
    sendBank(replacement === "none" ? null : replacement, replacement === "none" ? null : replacement === "plain" ? plain : compressed);
    if (accepted !== null) await accepted;
    const decoded = waitMessage(control.port, "decoded");
    control.port.postMessage({ kind: "resolve" });
    await decoded;
    const fence = waitMessage(processor.port, "latency");
    processor.port.postMessage({ kind: "latency" });
    await fence;
    return installed;
  } finally {
    await context.close();
  }
}
