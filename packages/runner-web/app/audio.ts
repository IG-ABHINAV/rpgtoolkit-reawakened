/**
 * The audio page: the cue player and the PCM sink running together in a real browser (entry 9.5).
 *
 * The scenario is the spec's own three rules, each asserted as a fact rather than listened to:
 *
 * 1. **The autoplay lock is a delayed late start.** A looping music cue at tick 100 is played while locked, becomes
 *    ready, and the first gesture arrives at tick 145: the song joins at `(145 − 100) mod length`.
 * 2. **The 15-tick drop is measured from ready.** An effect whose voice becomes ready at lateness 14 starts at its
 *    caught-up position; one ready at lateness 15 is stopped, never played, and never ends.
 * 3. **The focus hold pauses without losing position.** `focus.lost` sends `pause`, `focus.gained` sends `resume`.
 *
 * The audio itself is asserted by pulling frames through the sink — the same call an `AudioContext` graph makes — and
 * measuring their energy, so the lane distinguishes silence from sound without a speaker. A real graph is attached too;
 * with the autoplay policy disabled for the lane, its analyser reads non-silent output for about the same duration the
 * sink reports, and both the energy and the elapsed seconds are asserted.
 */

import type { AudioCue } from "@tk-reawakened/core";
import { BUNDLED_BANK, CuePlayer, type AudioMessage } from "@tk-reawakened/synth";
import { connectSinkToGraph, defaultWorkletUrl, PcmSink, ticksToSeconds } from "../src/audio-sink.ts";

type AudioReport = {
  readonly musicLengthTicks: number | null;
  readonly effectLengthTicks: number | null;
  readonly scheduled: readonly { readonly voice: number; readonly track: string; readonly positionTicks: number; readonly loop: boolean }[];
  readonly unlockPosition: number | null;
  readonly lateSound: { readonly played: boolean; readonly positionTicks: number | null };
  readonly droppedSound: { readonly played: boolean; readonly stopped: boolean };
  readonly focus: { readonly pause: boolean; readonly resume: boolean };
  readonly energy: number;
  readonly seconds: number;
  readonly graphStarted: boolean;
  readonly analyserEnergy: number | null;
  readonly analyserSeconds: number | null;
  /** The kind of graph node the shipped path attached (`worklet` or `script`). */
  readonly graphKind: "worklet" | "script" | null;
  /** The graph's own onset latency in seconds (render quantum or buffer size + base latency). */
  readonly graphLatencySeconds: number | null;
  /** The ScriptProcessorNode buffer size, when the fallback path was used. */
  readonly graphBufferSize: number | null;
  readonly errors: readonly string[];
  /** The bundled SoundFont: its hash as the cache keyed it, and the MIDI the bank rendered in this browser. */
  readonly bankSha: string | null;
  readonly midiEnergy: number;
  readonly midiLengthTicks: number | null;
};

declare global {
  interface Window {
    __audio?: AudioReport;
  }
}

const MUSIC = "pcm8-mono-8000.wav"; // 30 ticks
const EFFECT = "pcm16-mono-8000.wav"; // 15 ticks
const MIDI = "midi0-480-default-tempo.mid"; // 120 ticks, rendered through the bundled bank
const BANK = "media/soundfonts/TK-16.sf2";

function cue(cueId: number, tick: number, kind: AudioCue["kind"], track: string, asset: string | null, extra: Partial<AudioCue> = {}): AudioCue {
  return {
    cueId,
    tick,
    kind,
    track,
    voice: 0,
    asset: (asset === null ? null : `media/${asset}`) as AudioCue["asset"],
    loop: null,
    flags: null,
    positionTicks: 0,
    volume: 100,
    targetVolume: null,
    durationTicks: null,
    ...extra,
  };
}

void (async () => {
  const musicResponse = await fetch(`/packages/core/test/fixtures/audio/files/${MUSIC}`);
  const effectResponse = await fetch(`/packages/core/test/fixtures/audio/files/${EFFECT}`);
  if (!musicResponse.ok || !effectResponse.ok) throw new Error("audio: the fixture WAVs are not served");
  const midiResponse = await fetch(`/packages/core/test/fixtures/audio/files/${MIDI}`);
  const bankResponse = await fetch(`/${BANK}`);
  if (!midiResponse.ok) throw new Error("audio: the fixture MIDI is not served");
  const bytes = new Map<string, Uint8Array>([
    [`media/${MUSIC}`, new Uint8Array(await musicResponse.arrayBuffer())],
    [`media/${EFFECT}`, new Uint8Array(await effectResponse.arrayBuffer())],
    [`media/${MIDI}`, new Uint8Array(await midiResponse.arrayBuffer())],
  ]);
  const bankBytes = bankResponse.ok ? new Uint8Array(await bankResponse.arrayBuffer()) : null;

  const sent: AudioMessage[] = [];
  const errors: string[] = [];
  const lengths = new Map<number, number | null>();
  const ready: { readonly voice: number; readonly lengthTicks: number | null }[] = [];
  let player: CuePlayer | null = null;
  const sink = new PcmSink({
    readAsset: (asset) => bytes.get(asset) ?? null,
    readBank: () => bankBytes,
    outputRateHz: 8_000,
    onEvent: (event) => {
      // A real source answers `ready` after fetching and decoding, which is the whole point of measuring lateness
      // there; the page therefore buffers the answer and delivers it at the tick the scenario chooses.
      if (event.kind === "ready") {
        lengths.set(event.voice, event.lengthTicks);
        ready.push({ voice: event.voice, lengthTicks: event.lengthTicks });
      }
      if (event.kind === "error") errors.push(`${event.code}: ${event.detail}`);
    },
  });
  // The shipped audio graph is attached once so the cue tests exercise the real worklet path; messages are forwarded
  // to both the local mirror and the renderer.
  const context = new AudioContext({ sampleRate: 8_000 });
  const graph = await connectSinkToGraph(context, sink, {
    workletUrl: defaultWorkletUrl(),
    fallbackBufferSize: 1_024,
  });
  player = new CuePlayer({
    send: (message) => {
      sent.push(message);
      sink.handle(message);
      graph.send(message);
    },
    readAsset: (asset) => bytes.get(asset) ?? null,
    // Rank 4: the bundled bank. The player and runner layers are the host's preferences and are empty here.
    bankLayers: { player: null, runner: null, bundled: BUNDLED_BANK },
  });

  /** Deliver the source's buffered `ready` answers: the tick they arrive at is when lateness is measured. */
  const deliverReady = (): void => {
    while (ready.length > 0) {
      const answer = ready.shift();
      if (answer !== undefined) player?.ready(answer.voice, answer.lengthTicks);
    }
  };

  // One monotonic timeline: R never goes back, exactly as the host drives it.
  // 1. Locked at tick 0 with music that should be playing; the first gesture arrives at tick 45.
  player.lock();
  player.reach(0);
  player.advance([cue(41, 0, "media.play", "music", MUSIC, { loop: true })]);
  player.unlock(45);
  deliverReady();

  // 2a. An effect one tick inside the threshold: cue at 60, its voice ready at 74 (lateness 14).
  player.reach(60);
  player.advance([cue(51, 60, "media.play", "sfx", EFFECT)]);
  player.reach(74);
  deliverReady();

  // 2b. An effect at exactly the threshold: cue at 100, ready at 115 (lateness 15) is dropped, never played.
  player.reach(100);
  player.advance([cue(61, 100, "media.play", "sfx", EFFECT)]);
  player.reach(115);
  deliverReady();

  // The late rule's stop is recorded before the focus section clears the message log.
  const droppedStop = sent.some((message) => message.kind === "stop" && message.voice === 61);

  // 3. The focus hold.
  player.reach(130);
  sent.length = 0;
  player.focusLost();
  const pause = sent.some((message) => message.kind === "pause");
  player.focusGained();
  const resume = sent.some((message) => message.kind === "resume");

  const played = (voice: number): { readonly voice: number; readonly track: string; readonly positionTicks: number; readonly loop: boolean } | null => {
    const found = sink.scheduled.find((entry) => entry.voice === voice);
    return found === undefined ? null : { voice: found.voice, track: found.track, positionTicks: found.positionTicks, loop: found.loop };
  };
  const music = played(41);
  const late = played(51);
  const dropped = played(61);

  // The sink's own pull: the sound the graph would hear.
  const frames = 2_400;
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  sink.render(left, right, frames);

  // A real graph, attached for the shipped path. The autoplay policy is disabled for this lane, so resume() resolves
  // and the analyser reads the actual non-silent output for about the length the sink reports.
  let graphStarted = false;
  let analyserEnergy: number | null = null;
  let analyserSeconds: number | null = null;
  let graphKind: "worklet" | "script" | null = null;
  let graphLatencySeconds: number | null = null;
  let graphBufferSize: number | null = null;
  try {
    await context.resume();
    graphStarted = context.state === "running";
    const analyser = context.createAnalyser();
    analyser.fftSize = 2_048;
    graph.node.connect(analyser);
    analyser.connect(context.destination);
    // Run the graph for about the fixture length (0.5 s) so the analyser measures real output, not a race window.
    const targetSeconds = ticksToSeconds(lengths.get(41) ?? 0);
    const deadline = performance.now() + 2_000;
    while (context.currentTime < targetSeconds && performance.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
    }
    analyserSeconds = context.currentTime;
    const buffer = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(buffer);
    analyserEnergy = PcmSink.energy(buffer, buffer.length);
    graph.disconnect();
    // Measure the shipped graph's own latency at the default sample rate.
    const defaultContext = new AudioContext();
    const defaultSink = new PcmSink({
      readAsset: () => null,
      readBank: () => null,
      outputRateHz: defaultContext.sampleRate,
    });
    const defaultGraph = await connectSinkToGraph(defaultContext, defaultSink, { workletUrl: defaultWorkletUrl() });
    graphKind = defaultGraph.node instanceof AudioWorkletNode ? "worklet" : "script";
    graphBufferSize = defaultGraph.node instanceof ScriptProcessorNode ? defaultGraph.node.bufferSize : null;
    graphLatencySeconds = await defaultGraph.latency();
    defaultGraph.disconnect();
    await defaultContext.close();
  } catch {
    graphStarted = false;
  } finally {
    void context.close();
  }

  // The bundled bank, loaded the way the runner loads it: ranks resolve, the cache hashes it, MIDI renders through it.
  // A `soundfont.set` cue carries no track and no voice; its asset is the game's `defaultSoundFont` (null here, so the
  // bundled layer is chosen).
  player.advance([{ ...cue(71, 130, "soundfont.set", "music", null), track: null, voice: null, asset: null }]);
  const bankSha = sink.currentBankSha;
  player.advance([cue(72, 130, "media.play", "music", MIDI)]);
  deliverReady();
  const midiFrames = 8_192;
  const midiLeft = new Float32Array(midiFrames);
  const midiRight = new Float32Array(midiFrames);
  sink.render(midiLeft, midiRight, midiFrames);

  window.__audio = {
    musicLengthTicks: lengths.get(41) ?? null,
    effectLengthTicks: lengths.get(61) ?? null,
    scheduled: [music, late, dropped].filter((entry) => entry !== null),
    unlockPosition: music?.positionTicks ?? null,
    lateSound: { played: late !== null, positionTicks: late?.positionTicks ?? null },
    droppedSound: { played: dropped !== null, stopped: droppedStop },
    focus: { pause, resume },
    energy: PcmSink.energy(left, frames),
    seconds: ticksToSeconds(lengths.get(41) ?? 0),
    graphStarted,
    analyserEnergy,
    analyserSeconds,
    graphKind,
    graphLatencySeconds,
    graphBufferSize,
    errors,
    bankSha,
    midiEnergy: PcmSink.energy(midiLeft, midiFrames),
    midiLengthTicks: lengths.get(72) ?? null,
  };
  window.document.title = `audio: energy ${PcmSink.energy(left, frames).toFixed(3)}`;
})();
