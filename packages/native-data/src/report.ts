/**
 * Plain-language text for each report, for people reading a terminal. The
 * structured report is the contract; this is its one-line rendering.
 */

import type { CheckReport, FixSide } from "./check.ts";

const quote = (text: string): string => JSON.stringify(text);
export const code = (text: string): string => `\`${text}\``;

/** `a`, `b` and `c`: each item in code quotes, joined for a sentence. */
export function list(items: readonly string[]): string {
  const quoted = items.map(code);
  if (quoted.length <= 2) return quoted.join(" and ");
  return `${quoted.slice(0, -1).join(", ")} and ${quoted[quoted.length - 1]!}`;
}

function fixText(fix: FixSide): string {
  if (fix === "owner") return " Fix the owner.";
  if (fix === "plugin") return " Fix the plugin document.";
  return "";
}

export function formatReport(report: CheckReport): string {
  switch (report.class) {
    case "stamp": {
      const where = report.line === null ? report.path : `${report.path}:${report.line}`;
      const found =
        report.found.length === 0
          ? ""
          : `; found ${report.found.map(quote).join(", ")}${report.problem === "not-first" ? " first" : ""}`;
      if (report.key === null) return `${where}: stamp cannot be read: ${report.reason}${found}`;
      const state = { missing: "missing", repeated: "repeated", malformed: "malformed", "not-first": "not among the first two keys", unreadable: "unreadable" }[report.problem];
      if (report.problem === "missing") return `${where}: stamp key ${code(report.key)} is missing`;
      return `${where}: stamp key ${code(report.key)} is ${state}: ${report.reason}${found}`;
    }
    case "duplicate-id":
      return `duplicate ID ${code(report.id)}: ${list(report.paths)} ${report.paths.length === 2 ? "both" : "all"} resolve to it`;
    case "fold-collision":
      return `${list(report.paths)} fold to the same ID ${code(report.foldedId)}: IDs are compared with only A to Z folded to a to z`;
    case "plugin-no-owner":
      return `${report.path}: plugin document ${code(report.id)} names the owner ${code(report.owner)}, but ${report.reason}.${fixText(report.fix)}`;
    case "owner-no-back-link": {
      const target = report.plugin.path === null ? "no such document" : code(report.plugin.path);
      return `${report.owner.path}: owner ${code(report.owner.id)} names the plugin document ${code(report.plugin.named)} (${target}), but ${report.reason}.${fixText(report.fix)}`;
    }
    case "extension-contract-mismatch":
      return `${report.path}: the extension ${code(report.extension)} is registered for the contract ${code(report.registered)}, but the stamp names ${code(report.stamp)}. Either the extension or the stamp is wrong; the checker cannot tell which.`;
    case "mismatched-link": {
      const [first, second] = report.ends;
      const names = (end: typeof first): string =>
        `${end.role} ${code(end.id)} (${end.path}) names ${end.names.length === 0 ? "nothing" : end.names.map(code).join(", ")}`;
      return `mismatched link: ${names(first)}; ${names(second)}: ${report.reason}.${fixText(report.fix)}`;
    }
  }
}
