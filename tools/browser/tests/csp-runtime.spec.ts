import { expect, test, type Route } from "@playwright/test";

const PLAYER_PAGE = "/packages/runner-web/app/index.html?game=demo&package=fixtures/packages/demo.tpk&tracer=1";
const POLICY = /<meta\s+http-equiv="Content-Security-Policy"[^>]*>/i;

test("runner page boots a package with allowed scripts and blocks injected inline script at runtime", async ({ page }) => {
  let routeInvoked = false;
  if (process.env.CSP_PROBE_WEAKENED === "1") {
    await page.route((url) => url.pathname.endsWith("/index.html"), async (route: Route) => {
      routeInvoked = true;
      const response = await route.fetch();
      const html = await response.text();
      expect(html).toMatch(POLICY);
      await route.fulfill({ response, body: html.replace(POLICY, "") });
    });
  }

  await page.addInitScript(() => {
    window.addEventListener("securitypolicyviolation", (event) => {
      const target = window as Window & { __cspViolations?: { directive: string; blockedURI: string }[] };
      (target.__cspViolations ??= []).push({ directive: event.effectiveDirective, blockedURI: event.blockedURI });
    });
  });

  const allowedScript = page.waitForResponse((response) =>
    response.url().endsWith("/apps/player.js") && response.ok(),
  );
  await page.goto(PLAYER_PAGE);
  await allowedScript;
  if (process.env.CSP_PROBE_WEAKENED === "1") expect(routeInvoked).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as Window & { __report?: { error?: string; tick?: number } }).__report)).toMatchObject({ tick: 120 });
  await expect(page.locator("#report")).toContainText("demo tick 120");
  await expect(page.locator("#report")).not.toContainText(/player:|load failed/);

  await page.evaluate(() => {
    const script = document.createElement("script");
    script.textContent = "window.__cspDisallowedScriptRan = true;";
    document.body.append(script);
  });
  await expect.poll(() => page.evaluate(() => (window as Window & { __cspDisallowedScriptRan?: boolean }).__cspDisallowedScriptRan)).toBeUndefined();
  await expect.poll(() => page.evaluate(() => (window as Window & { __cspViolations?: { directive: string; blockedURI: string }[] }).__cspViolations ?? []))
    .toContainEqual({ directive: "script-src-elem", blockedURI: "inline" });
});
