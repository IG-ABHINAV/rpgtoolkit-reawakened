import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import { bundleOptions } from "../bundle-options.mjs";

// The strict-CSP probe of ADR 0025 decision 6 (and "What 11.2 does first" item 3): the toolchain fixture, bundled with
// the browser build's options, runs under exactly the strict policy the spike measured, `default-src 'none';
// script-src 'self'; style-src 'self'`, and reports zero `securitypolicyviolation` events. Monaco is not involved. The
// page and bundle are served by `page.route`, so the policy is the one this spec sets, not a server's.
const POLICY = "default-src 'none'; script-src 'self'; style-src 'self'";
const PAGE = "/__editor-ui-toolchain__/index.html";
const BUNDLE = "/__editor-ui-toolchain__/main.js";
const HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>editor-ui toolchain</title></head><body><div id="root"></div><script src="main.js"></script></body></html>`;

type Violation = { directive: string; blockedURI: string };
type Probe = Window & { __cspViolations?: Violation[] };

let bundle = "";

test.beforeAll(async () => {
  const result = await build({
    ...bundleOptions,
    entryPoints: ["tools/editor-ui-toolchain/fixtures/main.tsx"],
    outfile: "main.js",
    write: false,
  });
  bundle = result.outputFiles[0]?.text ?? "";
  expect(bundle).not.toBe("");
});

async function open(page: Page, script: string): Promise<void> {
  await page.addInitScript(() => {
    window.addEventListener("securitypolicyviolation", (event) => {
      const target = window as Probe;
      (target.__cspViolations ??= []).push({ directive: event.effectiveDirective, blockedURI: event.blockedURI });
    });
  });
  await page.route((url) => url.pathname === PAGE, (route) =>
    route.fulfill({ contentType: "text/html", headers: { "content-security-policy": POLICY }, body: HTML }),
  );
  await page.route((url) => url.pathname === BUNDLE, (route) =>
    route.fulfill({ contentType: "text/javascript", body: script }),
  );
  await page.goto(PAGE);
}

const violations = (page: Page): Promise<Violation[]> =>
  page.evaluate(() => (window as Probe).__cspViolations ?? []);

test("the Preact fixture renders, handles a click and applies a style under the strict policy with 0 violations", async ({ page }) => {
  await open(page, bundle);
  const button = page.getByRole("button", { name: "Count" });
  await expect(button).toHaveText("Count: 0");
  await button.click();
  await expect(button).toHaveText("Count: 1");
  // The style prop goes through the CSSOM, which `style-src 'self'` allows.
  await expect(button).toHaveCSS("min-width", /^(?!auto$|0px$).+/);
  expect(await violations(page)).toEqual([]);
});

test("the probe sees a violation: eval in the bundle and a style attribute in markup are both reported", async ({ page }) => {
  await open(page, `${bundle}\n;try { eval("1"); } catch (error) { void error; }`);
  await expect(page.getByRole("button", { name: "Count" })).toBeVisible();
  await page.evaluate(() => document.body.insertAdjacentHTML("beforeend", '<i style="color:red">x</i>'));
  await expect.poll(async () => (await violations(page)).map((violation) => violation.directive)).toEqual(
    expect.arrayContaining(["script-src", "style-src-attr"]),
  );
});
