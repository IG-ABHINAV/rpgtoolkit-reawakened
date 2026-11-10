// ADR 0025 decision 8 and "What 11.2 does first" item 5: the DOM shim (`@happy-dom/global-registrator`, dev-only) lets a
// Preact component render under `node --test`, and a test asserts on DOM output, not on framework internals.
import { after, before, test } from "node:test";
import { equal, ok } from "node:assert/strict";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { bundleOptions } from "../../browser/bundle-options.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(resolve(here, ".."), "fixtures");

// The component and Preact's test utilities are bundled together, so they share one copy of Preact.
const entry = `
  import { render } from "preact";
  import { act } from "preact/test-utils";
  import { Counter } from "./counter.tsx";
  export function mount(el: HTMLElement, start: number) {
    act(() => render(<Counter label="Count" start={start} />, el));
  }
  export { act };
`;

let mod;

before(async () => {
  GlobalRegistrator.register();
  const result = await build({
    ...bundleOptions,
    format: "esm",
    stdin: { contents: entry, loader: "tsx", resolveDir: fixtures, sourcefile: "dom-shim-entry.tsx" },
    outfile: "dom-shim.mjs",
    write: false,
    absWorkingDir: resolve(here, "..", "..", ".."),
    tsconfigRaw: "{}",
  });
  const text = result.outputFiles[0]?.text ?? "";
  mod = await import(`data:text/javascript;base64,${Buffer.from(text).toString("base64")}`);
});

after(() => GlobalRegistrator.unregister());

test("a Preact component renders to the DOM and reacts to a click", () => {
  const host = document.createElement("div");
  document.body.append(host);
  mod.mount(host, 2);

  const button = host.querySelector("button");
  ok(button !== null, "the component rendered a <button>");
  equal(button.getAttribute("aria-label"), "Count");
  equal(button.textContent, "Count: 2");
  equal(button.style.minWidth, "4em", "the style prop reached the element through the CSSOM");

  mod.act(() => button.click());
  equal(button.textContent, "Count: 3");
});
