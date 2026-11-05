// This probe runs in the real Electron page; it is slower than a unit test because it reloads a live game.
import { build } from "esbuild";
import { rmSync } from "node:fs";
import { join } from "node:path";

export async function probeDesktopCsp(page, evaluate, root, sleep) {
  const filename = `desktop-csp-probe-${process.pid}.js`;
  const output = join(root, "apps", filename);
  try {
    await build({ entryPoints: [join(root, "packages/synth/test/browser-csp-probe.mjs")], outfile: output, bundle: true, format: "esm", platform: "browser", target: "chrome120", logLevel: "silent" });
    const sound = await evaluate(`import('/apps/${filename}').then(m => m.probeCompressedAudio())`);
    if (!sound.ended || sound.energy <= 0.0001 || !sound.evalBlocked) throw new Error(`desktop CSP/audio probe failed: ${JSON.stringify(sound)}`);

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
    const waitFor = async (expression) => {
      for (let n = 0; n < 150; n += 1) {
        try { if (await evaluate(expression)) return; } catch (error) {
          if (!/context|navigation/i.test(String(error))) throw error;
        }
        await sleep(100);
      }
      throw new Error(`desktop CSP probe timed out: ${expression}`);
    };
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
    return { energy: sound.energy, evalBlocked: sound.evalBlocked, readinessWaited: true, failureReported: true };
  } finally {
    rmSync(output, { force: true });
  }
}
