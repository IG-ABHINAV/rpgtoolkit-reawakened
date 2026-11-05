// The CI change classifier (ADR 0016, issue #664).
//
// A `changes` job runs this over the paths a pull request changed. Each expensive CI job
// reads the verdict and decides for itself whether its steps need to run. No job is ever skipped.
//
// The verdict is "defer" (`runExpensive: false`) only when every changed path is on the inert list below.
// Everything else, and anything uncertain, is "run". A caller must supply both sides of a rename
// (`git diff --no-renames --name-only -z`) and treat any failure to obtain or parse the list as a
// classifier failure, which selects "run" and fails the `changes` job.

import { appendFileSync, readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** How many paths a one-line reason names before it says "(+N more)". */
const REASON_PATHS = 10;

/**
 * Classify the paths of a pull request.
 *
 * `reason` is one printable line that explains the verdict: `inert: <paths>` when the job may defer,
 * `full: <path>` naming the path that forced a run, or `full: <why>` for anything uncertain.
 *
 * @param {unknown} paths repository-relative changed paths, both sides of every rename
 * @param {unknown} eventName the GitHub event name; only `pull_request` can ever defer
 * @returns {{ runExpensive: boolean, reason: string }}
 */
export function classifyChanges(paths, eventName) {
  if (eventName !== "pull_request") {
    return full(`event ${describe(eventName)} is not pull_request`);
  }
  if (!Array.isArray(paths)) return full("the changed-path list is not an array");
  if (paths.length === 0) return full("no changed paths");

  // Validate every entry first: one malformed path anywhere makes the whole list untrustworthy.
  for (let index = 0; index < paths.length; index += 1) {
    if (!(index in paths) || typeof paths[index] !== "string" || !isValidPath(paths[index])) {
      return full(`malformed path ${describe(paths[index])}`);
    }
  }

  const active = paths.filter((path) => !isInertPath(path));
  if (active.length > 0) {
    return full(active.length === 1 ? active[0] : `${active[0]} (+${active.length - 1} more not inert)`);
  }
  const unique = [...new Set(paths)];
  const shown = unique.slice(0, REASON_PATHS).join(", ");
  const rest = unique.length > REASON_PATHS ? ` (+${unique.length - REASON_PATHS} more)` : "";
  return { runExpensive: false, reason: `inert: ${shown}${rest}` };
}

function full(why) {
  return { runExpensive: true, reason: `full: ${why}` };
}

/** A short, single-line, escaped rendering of an arbitrary value for a reason. */
function describe(value) {
  if (typeof value === "string") {
    const json = JSON.stringify(value.length > 80 ? `${value.slice(0, 80)}...` : value);
    return json;
  }
  return value === null ? "null" : typeof value;
}

function isValidPath(path) {
  return (
    path.length > 0 &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !/[\x00-\x1f\x7f\ufffd]/u.test(path) &&
    !/^[a-z]:/iu.test(path) &&
    path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..")
  );
}

/**
 * The inert set: prose and planning records that no CI lane reads. See ADR 0016 for the reason each
 * entry is safe, and for everything deliberately left out.
 */
function isInertPath(path) {
  // These win over the allowlist even for Markdown: their content is executable, normative,
  // fixture or workflow input.
  if (
    /^(?:packages|tools|stock|golden)\//u.test(path) ||
    path.startsWith("docs/spec/") ||
    path.startsWith(".github/workflows/")
  ) {
    return false;
  }

  // Documentation that no CI lane reads (provenance skips `docs/`, and no tool parses these
  // Markdown files) is inert: every Markdown file under docs/ except the normative spec.
  // The spec (`docs/spec/`, including its examples) is deliberately excluded above.
  if (path.startsWith("docs/") && path.endsWith(".md") && !path.startsWith("docs/spec/")) {
    return true;
  }

  // The installed BMAD framework lives under `_bmad/` and is consumed only by manual ticket
  // tooling (never by a CI lane); provenance skips it too. Treat the whole tree as inert.
  if (path.startsWith("_bmad/")) {
    return true;
  }

  return (
    (!path.includes("/") && path.endsWith(".md")) ||
    path === "docs/guardrails.md" ||
    (path.startsWith("docs/adr/") && path.endsWith(".md")) ||
    (path.startsWith("_bmad-output/") && path.endsWith(".md")) ||
    /^\.github\/ISSUE_TEMPLATE\/.+\.(?:md|yml|yaml)$/u.test(path)
  );
}

/**
 * Parse the output of `git diff --name-only -z`: NUL-terminated UTF-8 paths. Anything else throws,
 * because a list that cannot be parsed must never be treated as "nothing changed".
 *
 * @param {Uint8Array} bytes
 * @returns {string[]}
 */
export function parseNameOnlyZ(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError("diff input must be bytes");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (text === "") return [];
  if (!text.endsWith("\0")) throw new Error("diff path list is not NUL-terminated");
  const paths = text.slice(0, -1).split("\0");
  if (paths.some((path) => path.length === 0)) throw new Error("diff path list contains an empty path");
  return paths;
}

/**
 * CLI: read the NUL-delimited diff on stdin, print the evidence, and write `full=` and `reason=` to
 * `$GITHUB_OUTPUT` (or stdout when it is not set). Exits non-zero, after writing nothing, when it
 * cannot produce a verdict; the workflow treats that as a classifier failure.
 */
function runCli() {
  const bytes = readFileSync(0);
  const paths = parseNameOnlyZ(bytes);
  const verdict = classifyChanges(paths, process.env.GITHUB_EVENT_NAME);

  console.log(`changed paths examined (${paths.length}):`);
  for (const path of paths) console.log(`  ${JSON.stringify(path)}`);
  console.log(`verdict: ${verdict.runExpensive ? "RUN" : "DEFER"} - ${verdict.reason}`);

  const lines = `full=${verdict.runExpensive}\nreason=${verdict.reason}\n`;
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines);
  else process.stdout.write(lines);
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    runCli();
  } catch (error) {
    console.error(`classifier failure: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
