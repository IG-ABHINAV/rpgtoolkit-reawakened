// Temporary #1621 probe: instrument only Playwright's utility-world viewport path.
// The messages contain stage names only, never CDP payloads or page data.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const test = require.resolve("@playwright/test/package.json");
const playwright = require.resolve("playwright/package.json", { paths: [dirname(test)] });
const core = require.resolve("playwright-core/package.json", { paths: [dirname(playwright)] });
const bundle = join(dirname(core), "lib", "coreBundle.js");
let source = readFileSync(bundle, "utf8");
function replaceOnce(before, after) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + before.length) !== -1)
    throw new Error("Unexpected Playwright bundle; diagnostic patch refused");
  source = source.slice(0, first) + after + source.slice(first + before.length);
}
replaceOnce(
  'const context = world === "main" ? await progress2.race(this.mainContext()) : await progress2.race(this.utilityContext());\n          const injectedScript = await progress2.race(context.injectedScript());',
  'if (world === "utility") console.error("[1621] utility context start");\n          const context = world === "main" ? await progress2.race(this.mainContext()) : await progress2.race(this.utilityContext());\n          if (world === "utility") console.error("[1621] utility context acquired; injected script start");\n          const injectedScript = await progress2.race(context.injectedScript());\n          if (world === "utility") console.error("[1621] injected script acquired; predicate start");',
);
replaceOnce(
  'return await progress2.race(handle.evaluateHandle((h) => h.result));',
  'const result = await progress2.race(handle.evaluateHandle((h) => h.result));\n            if (world === "utility") console.error("[1621] predicate complete");\n            return result;',
);
writeFileSync(bundle, source);
console.log("[1621] Installed bounded Playwright utility diagnostics");
