import { spawn } from "node:child_process";

/**
 * Schedule a background reaper process on Linux to terminate any lingering Android
 * emulator processes (such as crashpad_handler, qemu-system, or netsimd) that can
 * remain alive after `adb emu kill` returns OK and cause android-emulator-runner to hang (#1651).
 *
 * Runs detached with stdio ignored so it does not block node process exit.
 */
export function scheduleEmulatorCleanup({
  platform = process.platform,
  delaySeconds = 15,
  processPatterns = "qemu-system|crashpad_handler|netsimd",
  spawnFn = spawn,
} = {}) {
  if (platform !== "linux") return null;
  const script = `sleep ${delaySeconds}; pkill -9 -f '${processPatterns}' || true`;
  try {
    const reaper = spawnFn("sh", ["-c", script], {
      detached: true,
      stdio: "ignore",
    });
    if (reaper && typeof reaper.unref === "function") {
      reaper.unref();
    }
    return reaper;
  } catch (error) {
    console.warn(`Failed to schedule emulator cleanup reaper: ${String(error)}`);
    return null;
  }
}
