// This probe runs in the real Electron page; it is slower than a unit test because it reloads a live game.
import { build } from "esbuild";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export async function probeDesktopCsp(page, evaluate, root, sleep) {
  const filename = `desktop-csp-probe-${process.pid}.js`;
  const output = join(root, "apps", filename);
  const workletFilename = `desktop-worklet-probe-${process.pid}.js`;
  const workletOutput = join(root, "apps", workletFilename);
  const runnerFilename = `desktop-worklet-runner-${process.pid}.js`;
  const runnerOutput = join(root, "apps", runnerFilename);
  const liveWorklet = join(root, "apps", "audio-worklet.js");
  const originalWorklet = readFileSync(liveWorklet);
  const waitFor = async (expression) => {
    for (let n = 0; n < 150; n += 1) {
      try { if (await evaluate(expression)) return; } catch (error) {
        if (!/context|navigation/i.test(String(error))) throw error;
      }
      await sleep(100);
    }
    throw new Error(`desktop CSP probe timed out: ${expression}`);
  };
  try {
    // Run in the loaded app:// player, not an HTTP stand-in or a DevTools-injected script (which bypasses CSP).
    // CDP only creates the element; Chromium must decide whether its inline body may execute.
    const inline = await evaluate(`new Promise((resolve) => {
      const probe = document.createElement('script');
      const playerScript = [...document.scripts].find((script) => new URL(script.src, location.href).pathname === '/apps/player-desktop-live.js');
      const result = { url: location.href, tick: window.__live?.tick ?? null, board: window.__live?.board ?? null,
        playerScript: playerScript?.src ?? null, executed: false, violation: null };
      const finish = () => {
        document.removeEventListener('securitypolicyviolation', onViolation);
        probe.remove();
        result.executed = window.__desktopInlineCspProbe === true;
        delete window.__desktopInlineCspProbe;
        resolve(result);
      };
      const timer = setTimeout(finish, 2000);
      const onViolation = (event) => {
        if (event.effectiveDirective !== 'script-src-elem' || event.blockedURI !== 'inline') return;
        result.violation = { directive: event.effectiveDirective, blockedURI: event.blockedURI };
        clearTimeout(timer);
        finish();
      };
      document.addEventListener('securitypolicyviolation', onViolation);
      probe.textContent = 'window.__desktopInlineCspProbe = true';
      document.head.appendChild(probe);
    })`);
    if (!inline.url.startsWith("app://player/") || inline.tick === null || inline.tick <= 0 || inline.board === null
      || inline.playerScript !== "app://player/apps/player-desktop-live.js" || inline.executed
      || inline.violation?.directive !== "script-src-elem" || inline.violation.blockedURI !== "inline") {
      throw new Error(`desktop inline CSP enforcement failed: ${JSON.stringify(inline)}`);
    }
    await build({ entryPoints: [join(root, "packages/synth/test/browser-csp-probe.mjs")], outfile: output, bundle: true, format: "esm", platform: "browser", target: "chrome120", logLevel: "silent" });
    const sound = await evaluate(`import('/apps/${filename}').then(m => m.probeCompressedAudio())`);
    if (!sound.ended || sound.energy <= 0.0001 || !sound.evalBlocked) throw new Error(`desktop CSP/audio probe failed: ${JSON.stringify(sound)}`);
    await build({
      entryPoints: [join(root, "packages/runner-web/src/audio-worklet.ts")], outfile: workletOutput,
      bundle: true, format: "iife", platform: "browser", target: "chrome120", logLevel: "silent",
      banner: { js: readFileSync(join(root, "packages/runner-web/test/worklet-decoder-banner.js"), "utf8") },
    });
    await build({ entryPoints: [join(root, "packages/runner-web/test/worklet-decoder-probe.mjs")], outfile: runnerOutput, bundle: true, format: "esm", platform: "browser", target: "chrome120", logLevel: "silent" });
    const race = await evaluate(`import('/apps/${runnerFilename}').then(m => m.probeWorkletDecoder('/apps/${workletFilename}'))`);
    if (race.before !== 0 || race.during !== 0 || race.after <= 0.0001) throw new Error(`worklet decoder race: ${JSON.stringify(race)}`);
    const cueReadiness = await evaluate(`import('/apps/${runnerFilename}').then(m => m.probeCueReadiness('/apps/${workletFilename}'))`);
    if (cueReadiness.early !== 0 || cueReadiness.scheduled.length !== 1
      || cueReadiness.scheduled[0].track !== "music" || cueReadiness.scheduled[0].positionTicks !== 30) {
      throw new Error(`worklet cue readiness/late drop failed: ${JSON.stringify(cueReadiness)}`);
    }
    const workletFailure = await evaluate(`import('/apps/${runnerFilename}').then(m => m.probeWorkletFailure('/apps/${workletFilename}'))`);
    if (!String(workletFailure.detail).includes("worklet-decoder-probe-failure")
      || workletFailure.pcmEnergy <= 0.0001 || workletFailure.plainEnergy <= 0.0001) {
      throw new Error(`worklet decoder failure or ordinary audio: ${JSON.stringify(workletFailure)}`);
    }
    const fallback = await evaluate(`import('/apps/${runnerFilename}').then(m => m.probeGraphFallback('/apps/${workletFilename}'))`);
    if (fallback.retained !== "plain" || fallback.energy <= 0.0001 || !fallback.reset || fallback.restored !== "plain") {
      throw new Error(`worklet bank fallback/reset failed: ${JSON.stringify(fallback)}`);
    }
    const isolation = await evaluate(`import('/apps/${runnerFilename}').then(m => m.probePendingIsolation('/apps/${workletFilename}'))`);
    if (isolation.paused !== 0 || isolation.muted !== 0 || isolation.stopped !== 0
      || isolation.resumed <= 0.0001 || isolation.unrelated <= 0.0001 || isolation.superseded <= 0.0001 || !isolation.reset) {
      throw new Error(`pending decoder blocked independent audio: ${JSON.stringify(isolation)}`);
    }
    for (const replacement of ["plain", "none", "compressed"]) {
      const installed = await evaluate(`import('/apps/${runnerFilename}').then(m => m.probeReleasedSupersession('/apps/${workletFilename}', '${replacement}'))`);
      const expected = replacement === "none" ? null : replacement;
      if (installed.length !== 1 || installed[0] !== expected) {
        throw new Error(`stale bank installed after decoder release (${replacement}): ${JSON.stringify(installed)}`);
      }
    }

    // Exercise the actual desktop graph and status display with the decoder rejected in its own realm.
    writeFileSync(liveWorklet, readFileSync(workletOutput));
    await page.send("Page.enable");
    const injection = await page.send("Page.addScriptToEvaluateOnNewDocument", { source: `{
      const Original = window.AudioWorkletNode;
      window.AudioWorkletNode = class extends Original {
        constructor(context, name, options) {
          super(context, name, options);
          if (name === 'tkr-pcm-processor') {
            window.__probeProcessor = this;
            window.__probeControl = new Original(context, 'decoder-probe-control');
            window.__probeControl.connect(context.destination);
            window.__probeContext = context;
          }
        }
      };
    }` });
    await page.send("Page.reload");
    await waitFor("!!window.__probeControl");
    await evaluate(`fetch('/packages/synth/test/fixtures/test-minimal.sf3').then(r => r.arrayBuffer()).then(bytes => {
      window.__probeProcessor.port.postMessage({kind:'message', message:{kind:'setBank', bankKind:'soundfont', bank:{source:'bundled',id:'test',sha256:null}, bankBytes:new Uint8Array(bytes), bankSha:'test'}});
      window.__probeContext.resume();
      window.__probeControl.port.postMessage({kind:'reject'});
      return true;
    })`);
    await waitFor("document.querySelector('#live-status')?.textContent.includes('worklet-decoder-probe-failure')");
    await page.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: injection.identifier });
    writeFileSync(liveWorklet, originalWorklet);
    await evaluate("delete window.__probeControl; delete window.__live; true");
    await page.send("Page.reload");
    await waitFor("window.__live?.tick > 0 || !!window.__live?.error");
    if (await evaluate("!!window.__live?.error")) throw new Error("desktop failed to restart after worklet failure probe");

    // Defer the real WebAssembly initializer before the next document executes. An unguarded player would start
    // immediately and could open a compressed bank before its decoder is ready.
    await page.send("Page.enable");
    await page.send("Page.addScriptToEvaluateOnNewDocument", { source: `{
      const query = Document.prototype.querySelector;
      Document.prototype.querySelector = function(selector) {
        if (selector === '#screen') window.__desktopPassedDecoderGate = true;
        return query.call(this, selector);
      };
      const original = WebAssembly.instantiate;
      WebAssembly.instantiate = (...args) => new Promise((resolve, reject) => {
        window.__resolveWasmProbe = () => original(...args).then(resolve, reject);
        window.__rejectWasmProbe = () => reject(new Error('decoder-probe-failure'));
      });
    }` });
    await page.send("Page.reload");
    await waitFor("typeof window.__resolveWasmProbe === 'function'");
    if (await evaluate("window.__desktopPassedDecoderGate === true")) throw new Error("desktop game passed its startup gate before decoder readiness");
    await evaluate("window.__resolveWasmProbe(); true");
    await waitFor("window.__desktopPassedDecoderGate === true");
    await waitFor("window.__live?.tick > 0 || !!window.__live?.error");
    const started = await evaluate("window.__live");
    if (started.error !== undefined) throw new Error(`desktop startup failed after decoder readiness: ${started.error}`);
    // Do not mistake the previous document's callback for the new one if CDP observes the old context first.
    await evaluate("delete window.__rejectWasmProbe; true");

    await page.send("Page.reload");
    await waitFor("typeof window.__rejectWasmProbe === 'function'");
    await evaluate("window.__rejectWasmProbe(); true");
    await waitFor("!!window.__live?.error");
    const failure = await evaluate("window.__live.error");
    if (!String(failure).includes("decoder-probe-failure")) throw new Error(`decoder failure was not reported: ${failure}`);
    return { inline, energy: sound.energy, evalBlocked: sound.evalBlocked, readinessWaited: true, failureReported: true, workletRace: race, workletFailureVisible: true };
  } finally {
    writeFileSync(liveWorklet, originalWorklet);
    rmSync(output, { force: true });
    rmSync(workletOutput, { force: true });
    rmSync(runnerOutput, { force: true });
  }
}
