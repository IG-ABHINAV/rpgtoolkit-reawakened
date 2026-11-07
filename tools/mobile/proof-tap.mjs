// Canvas tap preparation, touch dispatch and pointer event observation for mobile proof (#1621).
// Provides retriable target resolution with bounded timeout slices and backoff,
// and polls for asynchronous pointer events rather than assuming instantaneous dispatch.

export function installTapObserverScript() {
  const canvas = document.querySelector("#screen");
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error("mobile canvas is absent");
  const rect = canvas.getBoundingClientRect();
  const logical = { x: Math.floor(canvas.width / 2), y: Math.floor(canvas.height / 2) };
  window.__mobileProofPointerEvents = [];
  if (!window.__mobileProofTapObserved) {
    window.__mobileProofTapObserved = true;
    const observe = (event) => {
      const r = canvas.getBoundingClientRect();
      window.__mobileProofPointerEvents.push({
        type: event.type,
        pointerType: event.pointerType,
        trusted: event.isTrusted,
        buttons: event.buttons,
        logical: {
          x: Math.floor(Math.max(0, Math.min(canvas.width - 1, (event.clientX - r.left) * canvas.width / r.width))),
          y: Math.floor(Math.max(0, Math.min(canvas.height - 1, (event.clientY - r.top) * canvas.height / r.height))),
        },
      });
    };
    canvas.addEventListener("pointerdown", observe);
    canvas.addEventListener("pointerup", observe);
  }
  return {
    coordinateSpace: "CDP CSS viewport pixels, derived from the canvas client rect",
    logical,
    cssViewport: {
      x: rect.left + ((logical.x + 0.5) / canvas.width) * rect.width,
      y: rect.top + ((logical.y + 0.5) / canvas.height) * rect.height,
    },
    canvas: { width: canvas.width, height: canvas.height },
    rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    devicePixelRatio: window.devicePixelRatio,
  };
}

export async function prepareTapTarget(page, {
  timeoutMs = 90_000,
  initialSliceMs = 15_000,
  maxSliceMs = 45_000,
  sliceFactor = 1.5,
  initialBackoffMs = 500,
  maxBackoffMs = 4_000,
  backoffFactor = 1.5,
  delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
  protocolCall = async (_desc, op, _timeout) => op(),
} = {}) {
  const deadline = now() + timeoutMs;
  let lastError;
  let sliceMs = initialSliceMs;
  let backoffMs = initialBackoffMs;
  while (now() < deadline) {
    const remaining = deadline - now();
    const sliceTimeout = Math.max(2_000, Math.min(sliceMs, remaining));
    try {
      const target = await protocolCall(
        "reading canvas tap target and installing observers",
        () => page.evaluate(installTapObserverScript),
        sliceTimeout
      );
      return target;
    } catch (err) {
      lastError = err;
      sliceMs = Math.min(sliceMs * sliceFactor, maxSliceMs);
      const pause = Math.min(backoffMs, Math.max(0, deadline - now()));
      if (pause > 0) await delay(pause);
      backoffMs = Math.min(backoffMs * backoffFactor, maxBackoffMs);
    }
  }
  const detail = lastError instanceof Error ? lastError.message : String(lastError ?? "timeout");
  throw new Error(`reading canvas tap target and installing observers timed out after ${timeoutMs}ms; last error: ${detail}`, { cause: lastError });
}

export async function dispatchCanvasTap(page, target, {
  timeoutMs = 60_000,
  initialSliceMs = 15_000,
  maxSliceMs = 30_000,
  sliceFactor = 1.5,
  holdDelayMs = 100,
  initialBackoffMs = 1_000,
  maxBackoffMs = 4_000,
  backoffFactor = 1.5,
  delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
  protocolCall = async (_desc, op, _timeout) => op(),
} = {}) {
  const deadline = now() + timeoutMs;
  let lastError;
  let sliceMs = initialSliceMs;
  let backoffMs = initialBackoffMs;
  while (now() < deadline) {
    const remaining = deadline - now();
    const sliceTimeout = Math.max(2_000, Math.min(sliceMs, remaining));
    let cdp;
    try {
      cdp = await protocolCall("opening touch input session", () => page.context().newCDPSession(page), sliceTimeout);
      const point = { x: target.cssViewport.x, y: target.cssViewport.y, radiusX: 1, radiusY: 1, force: 1, id: 0 };
      await protocolCall("dispatching Android touch start", () =>
        cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] }), sliceTimeout);
      if (holdDelayMs > 0) await delay(holdDelayMs);
      await protocolCall("dispatching Android touch end", () =>
        cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }), sliceTimeout);
      return;
    } catch (err) {
      lastError = err;
      sliceMs = Math.min(sliceMs * sliceFactor, maxSliceMs);
      const pause = Math.min(backoffMs, Math.max(0, deadline - now()));
      if (pause > 0) await delay(pause);
      backoffMs = Math.min(backoffMs * backoffFactor, maxBackoffMs);
    } finally {
      if (cdp !== undefined) {
        await protocolCall("closing Android touch input session", () => cdp.detach(), 5_000).catch(() => {});
      }
    }
  }
  const detail = lastError instanceof Error ? lastError.message : String(lastError ?? "timeout");
  throw new Error(`dispatching Android touch events timed out after ${timeoutMs}ms; last error: ${detail}`, { cause: lastError });
}

export function assertPointerEvents(pointerEvents, target) {
  if (!Array.isArray(pointerEvents)) {
    throw new Error(`expected pointerEvents array, received: ${JSON.stringify(pointerEvents)}`);
  }
  const down = pointerEvents.find((event) => event.type === "pointerdown");
  const up = pointerEvents.find((event) => event.type === "pointerup");
  if (!down) {
    throw new Error(`pointerdown event was not captured: ${JSON.stringify(pointerEvents)}`);
  }
  if (!up) {
    throw new Error(`pointerup event was not captured: ${JSON.stringify(pointerEvents)}`);
  }
  if (down.trusted !== true || down.pointerType !== "touch" || down.buttons !== 1 ||
    down.logical.x !== target.logical.x || down.logical.y !== target.logical.y) {
    throw new Error(`touch did not reach intended canvas point ${JSON.stringify(target.logical)}: ${JSON.stringify(pointerEvents)}`);
  }
  if (up.trusted !== true || up.pointerType !== "touch" ||
    up.logical.x !== target.logical.x || up.logical.y !== target.logical.y) {
    throw new Error(`touch release did not reach intended canvas point ${JSON.stringify(target.logical)}: ${JSON.stringify(pointerEvents)}`);
  }
  return { down, up };
}

export async function waitForPointerEvents(page, {
  target,
  timeoutMs = 45_000,
  initialSliceMs = 10_000,
  maxSliceMs = 30_000,
  sliceFactor = 1.5,
  pollIntervalMs = 500,
  delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
  protocolCall = async (_desc, op, _timeout) => op(),
} = {}) {
  const deadline = now() + timeoutMs;
  let pointerEvents = [];
  let lastError;
  let sliceMs = initialSliceMs;
  while (now() < deadline) {
    const remaining = deadline - now();
    const sliceTimeout = Math.max(1_000, Math.min(sliceMs, remaining));
    try {
      pointerEvents = await protocolCall(
        "reading trusted canvas pointer events",
        () => page.evaluate(() => window.__mobileProofPointerEvents ?? []),
        sliceTimeout
      );
      const down = pointerEvents.find((event) => event.type === "pointerdown");
      const up = pointerEvents.find((event) => event.type === "pointerup");
      if (down && up) {
        assertPointerEvents(pointerEvents, target);
        return pointerEvents;
      }
    } catch (err) {
      lastError = err;
      sliceMs = Math.min(sliceMs * sliceFactor, maxSliceMs);
      if (err.message && (err.message.includes("touch did not reach intended canvas point") ||
          err.message.includes("touch release did not reach intended canvas point"))) {
        throw err;
      }
    }
    const pause = Math.min(pollIntervalMs, Math.max(0, deadline - now()));
    if (pause > 0) await delay(pause);
  }
  if (pointerEvents.length > 0) {
    assertPointerEvents(pointerEvents, target);
    return pointerEvents;
  }
  const detail = lastError instanceof Error ? lastError.message : String(lastError ?? "no events captured");
  throw new Error(`timed out waiting for canvas pointer events after ${timeoutMs}ms; last error or state: ${detail}`, { cause: lastError });
}
