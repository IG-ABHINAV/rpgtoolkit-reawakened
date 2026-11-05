import { existsSync, readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { equal, ok } from "node:assert/strict";

const here = resolve(fileURLToPath(import.meta.url), "..", "..", "..", "..");

function read(relative: string): string {
  return readFileSync(resolve(here, relative), "utf8");
}

/** The browser policy and the desktop-only allowance for the SoundFont decoder. */
const STRICT_POLICY = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob:; worker-src 'self' blob:;";
const DESKTOP_POLICY = STRICT_POLICY.replace("script-src 'self';", "script-src 'self' 'wasm-unsafe-eval';");
const DESKTOP_PAGES = ["packages/runner-desktop/app/player.html", "packages/runner-desktop/app/player-measure.html"];

/** Every .html page under each runner package's app directory (`packages/<runner>/app`), walked recursively at test time, so a new runner target or a new page cannot ship without a policy and no list needs maintaining. Returns repo-relative paths. */
function pages(): string[] {
  const found: string[] = [];
  const runners = readdirSync(resolve(here, "packages"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("runner-"));
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(resolve(directory, entry.name));
      else if (entry.name.endsWith(".html")) found.push(relative(here, resolve(directory, entry.name)));
    }
  };
  for (const runner of runners) {
    const app = resolve(here, "packages", runner.name, "app");
    if (!existsSync(app)) continue;
    walk(app);
  }
  return found.sort();
}

test("every player/browser page carries the strict Content-Security-Policy", () => {
  const all = pages();
  ok(all.length > 0, "expected pages to enumerate, found none");
  for (const relative of all) {
    const html = read(relative);
    const csp = html.match(/<meta[^>]*http-equiv="Content-Security-Policy"[^>]*content="([^"]*)"/i);
    if (csp === null) throw new Error(`${relative}: no Content-Security-Policy meta tag found`);
    const policy = csp[1] ?? "";
    ok(!policy.includes("'unsafe-eval'"), `${relative}: CSP must not allow JavaScript unsafe-eval`);
    ok(/script-src 'self'/.test(policy), `${relative}: CSP must restrict scripts to same origin`);
    equal(
      policy.trim().replace(/\s+/g, " "),
      DESKTOP_PAGES.includes(relative) ? DESKTOP_POLICY : STRICT_POLICY,
      `${relative}: CSP must match the approved policy exactly`,
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
