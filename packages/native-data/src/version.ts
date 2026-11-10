/**
 * The form of a version string (docs/spec/formats/native-contracts.md#versions):
 *
 *     MAJOR.MINOR.PATCH[-pre.N][+build]
 *
 * `MAJOR`, `MINOR` and `PATCH` are whole numbers with no leading zeros, all
 * three always written. The optional pre-release is `pre.N`. The optional build
 * suffix is dotted Semantic Versioning build identifiers (letters, digits and
 * hyphens), non-empty, and is ignored by precedence.
 */

export type VersionParse =
  | {
      readonly ok: true;
      readonly major: string;
      readonly minor: string;
      readonly patch: string;
      /** The number after `pre.`, or `null` when there is no pre-release. */
      readonly pre: string | null;
      /** The text after `+`, or `null` when there is no build suffix. */
      readonly build: string | null;
    }
  | { readonly ok: false; readonly reason: string };

const WHOLE_NUMBER = /^[0-9]+$/;
const BUILD_IDENTIFIER = /^[0-9A-Za-z-]+$/;

function fail(reason: string): VersionParse {
  return { ok: false, reason };
}

/** Why a `MAJOR`, `MINOR` or `PATCH` part is not allowed, or `null` when it is. */
function partProblem(name: string, part: string, first: boolean): string | null {
  if (part === "") return `${name} is empty`;
  if (first && /^[A-Za-z]/.test(part)) return "a prefix is not part of the version";
  if (!WHOLE_NUMBER.test(part)) return `${name} \`${part}\` is not a whole number`;
  if (part.length > 1 && part.startsWith("0")) return `${name} \`${part}\` has a leading zero`;
  return null;
}

export function parseVersion(text: string): VersionParse {
  if (text === "") return fail("the version is empty");

  let rest = text;
  let build: string | null = null;
  const plus = text.indexOf("+");
  if (plus >= 0) {
    build = text.slice(plus + 1);
    rest = text.slice(0, plus);
    if (build === "") return fail("the build suffix after `+` is empty");
    for (const identifier of build.split(".")) {
      if (identifier === "") return fail("the build suffix has an empty identifier");
      if (!BUILD_IDENTIFIER.test(identifier)) {
        return fail(`the build suffix identifier \`${identifier}\` may hold only letters, digits and hyphens`);
      }
    }
  }

  let core = rest;
  let pre: string | null = null;
  const dash = rest.indexOf("-");
  if (dash >= 0) {
    const preRelease = rest.slice(dash + 1);
    core = rest.slice(0, dash);
    if (preRelease === "") return fail("the pre-release after `-` is empty");
    const match = /^pre\.([0-9]+)$/.exec(preRelease);
    if (match === null) return fail(`the pre-release \`${preRelease}\` is not \`pre.N\``);
    const number = match[1]!;
    if (number.length > 1 && number.startsWith("0")) {
      return fail(`the pre-release number \`${number}\` has a leading zero`);
    }
    pre = number;
  }

  const parts = core.split(".");
  if (parts.length < 3) return fail(parts.length === 2 ? "patch is missing" : "minor and patch are missing");
  if (parts.length > 3) return fail("a version has exactly three numeric parts");
  const names = ["major", "minor", "patch"] as const;
  for (let index = 0; index < 3; index += 1) {
    const problem = partProblem(names[index]!, parts[index]!, index === 0);
    if (problem !== null) return fail(problem);
  }
  return { ok: true, major: parts[0]!, minor: parts[1]!, patch: parts[2]!, pre, build };
}
