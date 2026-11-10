// Stage-level diagnostics for mobile WebView screenshot capture (#1621).
// Isolates utility context script initialization, font readiness and CDP layout
// metrics before calling page.screenshot() so stalling stages are distinguished
// in failure artifacts and the isolated automation context is warmed up.

export async function probeScreenshotStages(page, name, timeoutMs = 10_000) {
  const probe = {
    name,
    timestamp: Date.now(),
  };

  // 1. Utility context warmup probe (evaluates Playwright isolated world scripts)
  if (typeof page.locator === "function") {
    const utilityStart = Date.now();
    try {
      let timer;
      await Promise.race([
        page.locator("#screen").count(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`utility context timed out after ${timeoutMs}ms`)), timeoutMs);
        }),
      ]).finally(() => clearTimeout(timer));
      probe.utilityContext = { durationMs: Date.now() - utilityStart, ready: true };
    } catch (err) {
      probe.utilityContext = { durationMs: Date.now() - utilityStart, error: err.message };
    }
  }

  // 2. Font status probe
  const fontStatusStart = Date.now();
  try {
    let timer;
    const fonts = await Promise.race([
      page.evaluate(() => ({
        status: document.fonts ? document.fonts.status : "unsupported",
        size: document.fonts ? document.fonts.size : 0,
      })),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`fonts status timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]).finally(() => clearTimeout(timer));
    probe.fontsStatus = { durationMs: Date.now() - fontStatusStart, ...fonts };
  } catch (err) {
    probe.fontsStatus = { durationMs: Date.now() - fontStatusStart, error: err.message };
  }

  // 2. Font ready promise probe
  const fontsReadyStart = Date.now();
  try {
    let timer;
    const fontsReady = await Promise.race([
      page.evaluate(() => (document.fonts ? document.fonts.ready.then(() => "ready") : "unsupported")),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`fonts ready timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]).finally(() => clearTimeout(timer));
    probe.fontsReady = { durationMs: Date.now() - fontsReadyStart, result: fontsReady };
  } catch (err) {
    probe.fontsReady = { durationMs: Date.now() - fontsReadyStart, error: err.message };
  }

  // 3. CDP Page.getLayoutMetrics probe
  const cdpStart = Date.now();
  let cdp;
  try {
    let sessionTimer;
    cdp = await Promise.race([
      page.context().newCDPSession(page),
      new Promise((_, reject) => {
        sessionTimer = setTimeout(() => reject(new Error(`opening CDP session timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]).finally(() => clearTimeout(sessionTimer));

    let layoutTimer;
    const layoutStart = Date.now();
    const layout = await Promise.race([
      cdp.send("Page.getLayoutMetrics"),
      new Promise((_, reject) => {
        layoutTimer = setTimeout(() => reject(new Error(`CDP Page.getLayoutMetrics timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]).finally(() => clearTimeout(layoutTimer));

    probe.cdpLayoutMetrics = {
      durationMs: Date.now() - layoutStart,
      hasVisualViewport: layout?.visualViewport !== undefined,
    };
  } catch (err) {
    probe.cdpLayoutMetrics = { durationMs: Date.now() - cdpStart, error: err.message };
  } finally {
    if (cdp && typeof cdp.detach === "function") {
      await cdp.detach().catch(() => {});
    }
  }

  return probe;
}
