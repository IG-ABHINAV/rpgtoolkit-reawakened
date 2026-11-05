import { execFileSync } from "node:child_process";

export const ADB_INSTALL_TIMEOUT_MS = 120_000;

// Preserve empty stderr for exit-1 pidof, which means the process is absent.
export function adbFailure(error) {
  const status = error.status ?? null;
  let stderr = String(error.stderr || (status === null ? error.message : "") || "").trim();
  if (status === null) {
    const details = [error.code && `code ${error.code}`, error.signal && `signal ${error.signal}`].filter(Boolean);
    if (details.length) stderr = [stderr, details.join(", ")].filter(Boolean).join("; ");
  }
  return {
    status,
    stdout: String(error.stdout ?? "").trim(),
    stderr,
    code: error.code ?? null,
    signal: error.signal ?? null,
    message: String(error.message ?? ""),
  };
}

export function runAdbWithTimeout(timeoutMs, ...args) {
  try {
    return {
      status: 0,
      stdout: execFileSync("adb", args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: timeoutMs,
        maxBuffer: 20 * 1024 * 1024,
      }).trim(),
      stderr: "",
    };
  } catch (error) {
    return adbFailure(error);
  }
}

export function describeAdbFailure(result, timeoutMs) {
  const details = [];
  if (result.status !== null) details.push(`exit ${result.status}`);
  if (result.code !== null) details.push(result.code === "ETIMEDOUT" ? `timed out after ${timeoutMs}ms` : `code ${result.code}`);
  if (result.signal !== null) details.push(`signal ${result.signal}`);
  const output = [result.stderr && `stderr: ${result.stderr}`, result.stdout && `stdout: ${result.stdout}`].filter(Boolean).join("; ");
  return `${details.length ? ` (${details.join(", ")})` : ""}: ${output || result.message || "no output"}`;
}

export function adbWithTimeout(timeoutMs, ...args) {
  const result = runAdbWithTimeout(timeoutMs, ...args);
  if (result.status !== 0) throw new Error(`adb ${args.join(" ")} failed${describeAdbFailure(result, timeoutMs)}`);
  return result.stdout;
}

export function installApk(apk, run = adbWithTimeout) {
  return run(ADB_INSTALL_TIMEOUT_MS, "install", "-r", apk);
}
