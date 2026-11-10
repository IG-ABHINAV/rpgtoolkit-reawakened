// ADR 0025 "What 11.2 does first" item 4 (lint half): the repository's ESLint configuration reads `.tsx` files, so the
// guard-rail rules (G2, G3) and the suppression rules apply to the editor's views. Fixture sources are linted as text
// under a synthetic path, as packages/core/test/lint-rules.test.ts does, so nothing is written to the tree.
import { test } from "node:test";
import { deepEqual, equal } from "node:assert/strict";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const eslint = new ESLint({ cwd: repoRoot });

async function lint(path, code) {
  const [result] = await eslint.lintText(code, { filePath: join(repoRoot, path) });
  if (result === undefined) throw new Error(`no lint result for ${path}`);
  return result.messages.map((message) => ({ rule: message.ruleId, severity: message.severity, text: message.message }));
}

const rules = (messages) => [...new Set(messages.map((message) => message.rule))].sort();

const cleanView = `
import { useState } from "preact/hooks";
export function View({ title }: { readonly title: string }) {
  const [open, setOpen] = useState(false);
  return <section aria-label={title}><button type="button" onClick={() => setOpen(!open)}>{open ? "close" : "open"}</button></section>;
}
`;

test("lint parses JSX in a .tsx file and finds nothing wrong with a clean view", async () => {
  deepEqual(await lint("packages/editor-ui/src/view.tsx", cleanView), []);
});

test("lint applies the core guard-rails to a .tsx file (a Node built-in import)", async () => {
  const messages = await lint(
    "packages/core/src/view.tsx",
    `import { readFileSync } from "node:fs";\nexport const View = () => <p>{readFileSync.name}</p>;\n`,
  );
  deepEqual(rules(messages), ["no-restricted-imports"]);
});

test("lint applies the core guard-rails to a .tsx file (a DOM global)", async () => {
  const messages = await lint("packages/core/src/view.tsx", `export const View = () => <p>{document.title}</p>;\n`);
  deepEqual(rules(messages), ["no-restricted-globals"]);
});

// `packages/editor-ui` does not exist yet, and the rule classifies packages by their `package.json`, so an existing
// package stands in: the point is that the rule reads `.tsx`.
test("lint refuses a .tsx file that reaches a sibling package by a relative path", async () => {
  const messages = await lint(
    "packages/runner-web/src/view.tsx",
    `import { core } from "../../core/src/index.ts";\nexport const View = () => <p>{core}</p>;\n`,
  );
  deepEqual(rules(messages), ["guardrails/no-escaping-relative-import"]);
  equal(messages[0]?.severity, 2);
});

test("lint refuses inline suppression in a .tsx file", async () => {
  const messages = await lint(
    "packages/editor-ui/src/view.tsx",
    `// eslint-disable-next-line no-restricted-imports\nexport const View = () => <p>x</p>;\n`,
  );
  equal(rules(messages).includes("guardrails/no-unmarked-suppression"), true, JSON.stringify(messages));
});
