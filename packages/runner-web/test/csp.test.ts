import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { equal, ok } from "node:assert/strict";

const here = resolve(fileURLToPath(import.meta.url), "..", "..", "..", "..");

function read(relative: string): string {
  return readFileSync(resolve(here, relative), "utf8");
}

/** The strict policy every player/host page must carry, byte for byte. */
const STRICT_POLICY = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob:; worker-src 'self' blob:;";

/** Every .html page under a package's app directory, enumerated at test time so a new page cannot ship without a policy. */
function pages(directory: "packages/runner-web/app" | "packages/runner-desktop/app"): string[] {
  const root = resolve(here, directory);
  return readdirSync(root)
    .filter((entry) => entry.endsWith(".html"))
    .sort()
    .map((entry) => `${directory}/${entry}`);
}

test("every player/browser page carries the strict Content-Security-Policy", () => {
  const all = [...pages("packages/runner-web/app"), ...pages("packages/runner-desktop/app")];
  ok(all.length > 0, "expected pages to enumerate, found none");
  for (const relative of all) {
    const html = read(relative);
    const csp = html.match(/<meta[^>]*http-equiv="Content-Security-Policy"[^>]*content="([^"]*)"/i);
    if (csp === null) throw new Error(`${relative}: no Content-Security-Policy meta tag found`);
    const policy = csp[1] ?? "";
    ok(!/unsafe-eval/.test(policy), `${relative}: CSP must not allow unsafe-eval`);
    ok(/script-src 'self'/.test(policy), `${relative}: CSP must restrict scripts to same origin`);
    equal(
      policy.trim().replace(/\s+/g, " "),
      STRICT_POLICY,
      `${relative}: CSP must match the shared strict policy exactly`,
    );
  }
});

test("desktop main process uses the event-object console-message listener", () => {
  const source = read("packages/runner-desktop/src/main.ts");
  const deprecated = source.match(/\.on\("console-message"\s*,\s*\(_event,\s*level,\s*message\)/);
  equal(deprecated, null, "console-message listener must not use the deprecated positional signature");
  ok(
    /\.on\("console-message"\s*,\s*\(event\)\s*=>\s*console\.error\(`renderer\[\$\{event\.level\}\]:\s*\$\{event\.message\}`\)/.test(source),
    "console-message listener must read level and message from the event object",
  );
});
