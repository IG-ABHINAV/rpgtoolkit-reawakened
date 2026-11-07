// Playwright's Android API is experimental. In particular, webView.page() has no
// timeout or cancellation: never start a second attachment while one may hang.
export class UncancelledAttachError extends Error {}

export async function boundedAttach(description, operation, timeoutMs, onLate = () => {}) {
  let timer;
  let expired = false;
  const pending = Promise.resolve().then(operation);
  pending.then((value) => {
    if (expired) Promise.resolve(onLate(value)).catch(() => {});
  }, () => {});
  try {
    return await Promise.race([
      pending,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          expired = true;
          reject(new UncancelledAttachError(`timed out after ${timeoutMs}ms: ${description}; operation may still be pending`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// Match adb's server selection: socket overrides ANDROID_ADB_SERVER_ADDRESS/PORT.
// Playwright only supports TCP endpoints, not adb's Unix-domain socket specs.
export function adbServerOptions(env) {
  const socket = env.ADB_SERVER_SOCKET;
  let host = env.ANDROID_ADB_SERVER_ADDRESS || undefined;
  let port = env.ANDROID_ADB_SERVER_PORT || undefined;
  if (socket) {
    const match = /^tcp:(?:(\[[^\]]+\]|[^:]+):)?(\d+)$/u.exec(socket);
    if (match === null) throw new Error(`Playwright Android requires a TCP ADB_SERVER_SOCKET, got ${socket}`);
    host = match[1]?.replace(/^\[|\]$/gu, "");
    port = match[2];
  }
  const options = {};
  if (host) options.host = host;
  if (port !== undefined) {
    const number = Number(port);
    if (!/^\d+$/u.test(port) || !Number.isInteger(number) || number < 1 || number > 65535) {
      throw new Error(`Invalid ADB server port: ${port}`);
    }
    options.port = number;
  }
  // adb resolves its default server host as localhost; Playwright defaults to 127.0.0.1.
  if (!options.host) options.host = "localhost";
  return options;
}


export async function closeDevice(device, timeoutMs) {
  await boundedAttach(`closing Android device ${device.serial()}`, () => device.close(), timeoutMs);
}

export async function selectDevice(android, serial, timeoutMs, serverOptions) {
  const deadline = Date.now() + timeoutMs;
  const closeAll = (devices) => Promise.allSettled(devices.map((device) => device.close()));
  const devices = await boundedAttach("enumerating Android devices", () => serverOptions === undefined ? android.devices() : android.devices(serverOptions), timeoutMs, closeAll);
  const matches = devices.filter((device) => device.serial() === serial);
  const target = matches.length === 1 ? matches[0] : undefined;
  try {
    await Promise.all(devices.filter((device) => device !== target).map((device) =>
      closeDevice(device, Math.max(1, deadline - Date.now()))));
    if (target === undefined) throw new Error(`Playwright found ${matches.length} devices matching adb-selected serial ${serial}`);
    return target;
  } catch (error) {
    if (target !== undefined) await closeDevice(target, Math.max(1, deadline - Date.now())).catch(() => {});
    throw error;
  }
}

export async function attachPage(device, pkg, pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const view = await device.webView({ pkg }, { timeout: timeoutMs });
  if (String(view.pid()) !== pid) throw new Error(`WebView PID ${view.pid()} does not match app PID ${pid}`);
  // A view close cannot cancel page(); treat it like a timeout and do not retry.
  let closed;
  const viewClosed = new Promise((_, reject) => {
    closed = () => reject(new UncancelledAttachError("Android WebView closed while page attachment may still be pending"));
    view.once("close", closed);
  });
  const pending = view.page();
  let attached = false;
  try {
    const page = await boundedAttach("attaching Android WebView page", () => Promise.race([pending, viewClosed]), Math.max(1, deadline - Date.now()));
    if (page === undefined || page.isClosed()) throw new Error("Android WebView did not expose a live page");
    attached = true;
    return page;
  } finally {
    view.off("close", closed);
    // page() is not cancellable; dispose a context that arrives after failure.
    if (!attached) pending.then((page) => page?.context().close().catch(() => {}), () => {});
  }
}
