// adb shell pidof returns status 1 with no output when no matching process exists.
// A timeout, transport error, or malformed response is not proof of absence.
export function classifyProcess(result) {
  if (result.status === 0 && /^\d+(?:\s+\d+)*$/.test(result.stdout) && result.stderr === "") {
    return { state: "running", pid: result.stdout.split(/\s+/)[0] };
  }
  if (result.status === 1 && result.stdout === "" && result.stderr === "") {
    return { state: "absent", pid: null };
  }
  return { state: "unknown", pid: null };
}
