import { UncancelledAttachError } from "./proof-android.mjs";

// One deadline covers observation, attachment, cleanup and backoff across attempts.
export async function launchAndConnect(stage, serial, timeoutMs, {
  now, observe, start, select, attach, live, close, delay, attempts, log,
  appId, protocolTimeoutMs, initialBackoffMs, maxBackoffMs,
}) {
  const startedAt = now();
  const deadline = startedAt + timeoutMs;
  let lastError;
  let attempt = 0;
  let backoffMs = initialBackoffMs;
  while (now() < deadline) {
    attempt += 1;
    const observation = observe(stage, attempt, startedAt, deadline);
    log(`Android WebView attach ${stage} attempt ${attempt}: process=${observation.processState}${observation.pid === null ? "" : ` (${observation.pid})`}; logcat=${JSON.stringify(observation.logcat.output)}`);
    if (observation.processState === "unknown") {
      const result = observation.pidof;
      const description = `exit ${result.exitCode ?? "unknown"}: ${result.stderr || (result.output ? "stdout: " + result.output : "no error output")}`;
      observation.attachError = `pidof failed or returned an invalid response: ${description}`;
      lastError = new Error(observation.attachError);
    } else if (observation.processState === "absent") {
      const result = now() < deadline ? start(deadline) : { status: null, stdout: "", stderr: "attach deadline expired before am start" };
      observation.activityStart = { exitCode: result.status, output: result.stdout, stderr: result.stderr };
      lastError = new Error(`Android process ${appId} was absent at attach attempt ${attempt}`);
      if (result.status !== 0) {
        observation.attachError = `am start failed (exit ${result.status ?? "unknown"}): ${result.stderr || result.stdout || "no output"}`;
        lastError = new Error(observation.attachError);
      }
    } else {
      let device;
      try {
        const remaining = () => {
          const time = deadline - now();
          if (time <= 0) throw new Error("Android WebView connection exhausted the startup deadline");
          return Math.min(protocolTimeoutMs, time);
        };
        device = await select(serial, remaining());
        const page = await attach(device, appId, observation.pid, remaining());
        await live(page, remaining());
        observation.connected = true;
        observation.elapsedMs = now() - startedAt;
        attempts.push(observation);
        log(`Android WebView attach ${stage} succeeded after ${observation.elapsedMs}ms (${attempt} attempts)`);
        return { device, page };
      } catch (error) {
        lastError = error;
        observation.attachError = String(error);
        if (device !== undefined) {
          try {
            await close(device, Math.min(protocolTimeoutMs, Math.max(1, deadline - now())));
          } catch (closeError) {
            observation.closeError = String(closeError);
            lastError = new UncancelledAttachError(`${String(error)}; closing the failed connection also failed: ${String(closeError)}`, { cause: error });
          }
        }
        if (error instanceof UncancelledAttachError || lastError instanceof UncancelledAttachError) {
          attempts.push(observation);
          throw new Error(`Android WebView attachment stopped without retrying an uncancelled operation: ${String(lastError)}`, { cause: lastError });
        }
      }
    }
    attempts.push(observation);
    const remaining = deadline - now();
    if (remaining <= 0) break;
    await delay(Math.min(backoffMs, remaining));
    backoffMs = Math.min(backoffMs * 2, maxBackoffMs);
  }
  throw new Error(`could not expose the Android WebView page within ${timeoutMs}ms after ${attempt} attach attempts: ${String(lastError ?? "no attempt completed")}`, { cause: lastError });
}
