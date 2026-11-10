# editor-ui framework: what the spike measured

**Status: research record.** The decision is the owner's, recorded in [ADR 0025](../../adr/0025-editor-ui-framework-preact-tsx.md): `editor-ui` uses Preact with TSX. This page keeps the evidence so the decision can be checked and, if its revisit triggers fire, reopened. Nothing here changes a ruling.

The work was a spike on 2026-11-09 against `origin/main` at `f8f6f245` (the repository's own files were read from that revision, never from a lagging checkout). The spike's report, its docking-library report and its ecosystem report are **scratch evidence, not committed**: they lived in `/private/tmp` and will not survive. Everything that matters from them is in this page. The prototype app, the probes and the raw outputs were also scratch work and are not committed; the page says what each number came from so it can be reproduced.

| | |
|---|---|
| Question | [ADR 0022](../../adr/0022-shared-editor-authoring-contracts.md) question 3 / D7.3: which UI framework does `editor-ui` use? It blocks story 11.2 ([#1700](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1700)) and the docking-library choice. |
| Evidence | The same ~200-line app built in five frameworks and measured: bundle size, CSP, keyboard and ARIA behaviour, licences, docking compatibility, ecosystem health, developer experience and the cost of a later swap. |
| Result | No candidate failed a hard constraint. The owner chose Preact with TSX. The spike report had recommended Vue, with Preact as the lower-cost fallback; the owner's choice is the decision and the page records both. |

## What the repository requires of the framework

These are the hard constraints the spike checked each candidate against.

| Constraint | Source | Consequence for a framework |
|---|---|---|
| `editor-ui` reaches the host only through platform-services; it never imports `vscode`, Electron or any `host-*` package | [G2](../../guardrails.md#g2--hard-package-boundaries) | The lint and dependency-graph checks must be able to read the framework's source files. |
| Every shipped dependency is Bronze or better on the Blue Oak list, and every production package is named in `THIRD_PARTY_NOTICES` | [G6](../../guardrails.md#g6--licence-gate); `tools/licences/check.mjs:613` at `f8f6f245` | Fewer production packages means fewer notices. |
| A provenance scan reads source files for legacy markers | [G7](../../guardrails.md#g7--clean-room-provenance); `tools/provenance/markers.json` | Its extension list holds `.ts` and `.tsx` and holds neither `.vue` nor `.svelte`. |
| esbuild bundles browser artefacts as single-file IIFEs; Vite is not installed | [ADR 0015](../../adr/0015-web-build-and-test-toolchain.md) decisions 1 and 2 | A framework that needs a compiler plugin needs one for esbuild. |
| A strict CSP with no `unsafe-eval` | architecture spine, Operations | The shipped bundle must contain no runtime template compiler. |
| One build runs in a VS Code webview, a browser PWA and the Electron `app://` shell | [ADR 0013](../../adr/0013-desktop-shell-electron.md), [ADR 0022](../../adr/0022-shared-editor-authoring-contracts.md) D2 | All three hosts were exercised. |
| Monaco is a view the framework mounts but does not own; VS Code uses its native text editors | [ADR 0021](../../adr/0021-monaco-code-editor.md) | Monaco sits behind a framework-free bridge. |

At `f8f6f245` there was no `packages/editor-ui` or `packages/editor-model`, so nothing existing had to migrate.

## Method

* **One app, five builds.** The same app in Vue 3.5.45, Preact 11.2.0, Lit 3.3.3, Svelte 5.57.3 and React 19.3.1 (the last as a reference). It has a resizable split (`role=separator`), a keyboard tree (`role=tree`, roving tabindex), a tab strip, a form driven by a five-field settings catalogue with per-field validation, a native `<dialog>` confirmation, a toolbar bound to a command stack (Undo label, dirty status), a "visit" focus flow (Enter moves focus into the panel, Escape returns it) and a Monaco mount point. Each implementation is 183 to 205 non-blank lines in six or seven components.
* **Shared, framework-free code** (175 non-blank lines): a stand-in for `editor-model` (immutable snapshots, `subscribe`, a serialisable command stack with undo, redo and revert), the settings catalogue with validation, and the key logic for the tree and tabs written to the W3C ARIA Authoring Practices patterns (from memory, not diffed against the text).
* **Monaco was real** (`monaco-editor` 0.57.0) and was built once as its own bundle behind a framework-free `mount(el, text, onEdit) -> { setText, dispose }` bridge; it is excluded from every framework bundle below.
* **Build:** esbuild 0.28.2 (the repository pin), one IIFE per entry, minified, ES2022. Vue single-file components went through a 25-line esbuild plugin over `@vue/compiler-sfc`; Svelte through `esbuild-svelte` 0.9.5; Lit with standard decorators; Preact and React with esbuild's built-in JSX.
* **Drivers, identical for every candidate:** a 14-step Playwright 1.64.0 probe on Chromium 156; a five-test `node:test` file on happy-dom; a real VS Code 1.145.2 webview (an extension host, `createWebviewPanel`, Monaco not loaded); Electron 45.2.1 over a privileged `app://` scheme with `contextIsolation` and `sandbox` on, never `loadFile`; and four CSP policies (below).
* **Toolchain:** macOS arm64, Node 26.13.0 (the repository pins 24.21.0), TypeScript 7.0.2 as `@typescript/native` with `typescript` aliased to `@typescript/typescript6` 6.0.2 (the repository's layout).
* **Tests could fail.** In the Preact build, removing `aria-invalid` and making every tree row a tab stop took the Playwright probe from 14/14 to 12/14 and the `node:test` file from 5/5 to 3/5; restoring the edits restored both.

## Verdict by area

PASS means the requirement was met with measured evidence. RISK means it works but a measured cost, gap or open item needs a decision. No cell is a FAIL.

| Area | Vue 3.5.45 | **Preact 11.2.0** | Lit 3.3.3 | Svelte 5.57.3 | React 19.3.1 |
|---|---|---|---|---|---|
| App bundle, min / gzip (Monaco excluded) | 73.5 KB / 29.0 KB | **21.8 KB / 8.9 KB** | 33.0 KB / 12.6 KB | 70.2 KB / 26.1 KB | 231.0 KB / 72.0 KB |
| Of which framework, min | 63.3 KB | **13.5 KB** | 18.6 KB | 59.9 KB | 221.3 KB |
| Extra compiler plugin needed | yes (ours; Vite is out) | **no** | no | yes (`esbuild-svelte`, one hobbyist, 0.x) | no |
| CSP, strict, after load | 0 violations | **0** | **5** (`style-src-attr`) | 0 | 0 |
| Keyboard and ARIA probe, strict policy | 14/14 | **14/14** | 12/14 | 14/14 | 14/14 |
| Production packages (G6) | 23, all MIT, ISC or BSD | **1, MIT** | 6, BSD-3 or MIT | 19, MIT or Apache-2.0 | 3, MIT |
| Type-checked by `tsc -b` (TS 7) | no: needs `vue-tsc` on the TypeScript 6 API | **yes** | classes yes, templates no | no: `svelte-check` | yes |
| Source files seen by ESLint and the G7 scan at `f8f6f245` | not `.vue` | **yes (`.tsx`)** | yes (`.ts`) | not `.svelte` | yes (`.tsx`) |
| Releases in the last 12 months (stable) | 21 | **22** | 2 | 91 | 29 |
| Top committer share, last 12 months | 67.0% | **72.4%** | 27.7% | 36.5% | 21.7% |
| Backing | independent, sponsor-funded | **Open Collective, no foundation** | Google-copyright licence file, own org | Open Collective | React Foundation (Linux Foundation) |
| Latest major's age on 2026-11-09 | 3.0.0, 6.1 years | **11.0.0, 5.7 weeks** | 3.0.0, 3.1 years | 5.0.0, 2.1 years | 19.0.0, 1.9 years |

The sections below give the detail behind each row.

### Bundle size and build

`app.js` is the framework, the app and the shared logic; "framework" is the sum of the esbuild metafile's `bytesInOutput` for `node_modules` inputs. Medians over 15 warm builds.

| | min | gzip -9 | brotli | framework part | one-element app, min / gz | median build | plugin |
|---|---|---|---|---|---|---|---|
| Vue | 73,490 B | 28,966 B | 26,346 B | 63,307 B | 56,834 / 22,637 | 21 ms | SFC compiler |
| **Preact** | **21,779 B** | **8,852 B** | **8,062 B** | **13,519 B** | **10,982 / 4,697** | **4 ms** | **none** |
| Lit | 33,014 B | 12,617 B | 11,321 B | 18,629 B | 14,663 / 5,641 | 6 ms | none |
| Svelte | 70,156 B | 26,099 B | 23,646 B | 59,944 B | 40,696 / 15,355 | 24 ms | `esbuild-svelte` |
| React | 230,956 B | 72,049 B | 62,149 B | 221,260 B | 221,962 / 68,817 | 25 ms | none |

For scale, the Monaco bundle the app would also load is 2,721,506 B minified (700,976 B gzip), plus a 307,264 B worker and 90,765 B of CSS. App code in each framework bundle was 5.2 to 9.3 KB; the shared logic was 3.0 KB.

None of the five bundles contained `eval(`, `new Function` or `Function(`. Vue's full build (`vue.esm-bundler.js`) does contain one `new Function` and, under `script-src 'self'`, fails with the `unsafe-eval` error; the runtime-only build, which is what precompiled templates need, is clean. That does not touch Preact, which has no template compiler.

### CSP

Server-supplied policies: **strict** is exactly `default-src 'none'; script-src 'self'; style-src 'self'`; **nonce** is `default-src 'none'; script-src 'nonce-N'; style-src 'self' 'nonce-N'; font-src 'self'; worker-src 'self' blob:; img-src 'self' data:` (the shape a VS Code webview uses); **relaxed** is strict plus `style-src 'unsafe-inline'` and the font, worker and image sources. A `securitypolicyviolation` listener counted violations.

| Variant | Vue | Preact | React | Svelte | Lit |
|---|---|---|---|---|---|
| strict, after load | 0 | **0** | 0 | 0 | 5 `style-src-attr` |
| strict, after opening Monaco | 32 | **32** | 32 | 32 | 44 |
| strict, end of the 14 steps | 61 | **61** | 61 | 61 | 88 |
| nonce, after load / Monaco / end | 0 / 32 / 61 | **0 / 32 / 61** | 0 / 32 / 61 | 0 / 32 / 61 | 5 / 44 / 88 |
| relaxed, end | 0 | **0** | 0 | 0 | 0 |
| steps passed, strict | 14/14 | **14/14** | 14/14 | 14/14 | 12/14 |

* **No candidate needs `unsafe-eval`, or `unsafe-inline` for scripts.** All five ran under `script-src 'self'` and under a nonce-only `script-src`.
* **Monaco, not the framework, forces `style-src 'unsafe-inline'`.** The 32 violations are identical for every framework. Monaco 0.57.0 creates `<style>` elements and style attributes without a nonce. Under `style-src 'self'` the editor still accepts typing but loses its line numbers and current-line highlight. Adding a nonce does not help: with a nonce or hash in `style-src`, `'unsafe-inline'` is ignored, so Monaco needs a style policy with `'unsafe-inline'` and no nonce. With the relaxed policy there were 0 violations. **Not exercised:** no request for `editor.worker.js` was ever made, so Monaco's worker CSP is unverified.
* **Inline-style binding forms**, each under the strict policy (the colour applied means the style took effect):

  | Binding form | Preact | Vue | React | Svelte | Lit |
  |---|---|---|---|---|---|
  | object (`style={{}}`, `:style`, `style:color`, `styleMap`) | applied, 0 violations | applied, 0 | applied, 0 | applied, 0 | **blocked** on first render |
  | dynamic string | applied, 0 | applied, 0 | n/a (React rejects strings) | applied, 0 | **blocked** |
  | static literal `style="color: red"` | applied, 0 | applied, 0 | n/a | applied, one violation reported | applied, one violation reported |

  Vue has one more hazard: with the default `hoistStatic`, five or more static elements each carrying `style="..."` are stringified and parsed with `innerHTML`, and CSP drops every one (8 of 8 blocked); `hoistStatic: false` fixes it. Lit's `styleMap` writes a string to the `style` attribute on its first update. Neither is a Preact issue, and the Preact rule in ADR 0025 is stated from the CSSOM-versus-markup distinction the docking scan also found (a style set through the CSSOM is allowed; a `style` attribute, an injected `<style>` or `setAttribute('style', …)` is blocked).
* **A real VS Code 1.145.2 webview** (CSP `default-src 'none'; style-src 'self' https://*.vscode-cdn.net; script-src 'nonce-…'`): Preact, Vue, React and Svelte each rendered 4 tree items with a 24 px indent, moved focus with ArrowDown, committed a typed change as a command (`Undo: Change Game speed`) and logged **0** violations. Lit had a 4 px indent and 5 violations. Synthetic `KeyboardEvent`s; Monaco was not loaded.
* **Electron 45.2.1 over `app://`** (scheme registered `standard`, `secure`, `supportFetchAPI`, `corsEnabled` before ready): all five rendered, moved roving focus, committed a typed edit and mounted Monaco. Strict: 12 console CSP errors for Vue, Preact, React and Svelte (all from Monaco) and 17 for Lit; relaxed: 0 for all. Two harness findings: `serviceWorker in navigator` is true (the API exists; none was registered), and in a hidden Electron window React's `onBlur` commit never fired while the native `change` event used by the other four did (with `show: true` React passed).

### Accessibility and keyboard

The 14-step probe passed 14/14 for all five with no CSP, the relaxed policy and the relaxed-nonce policy, and 12/14 for Lit under strict and nonce (the two failures are the blocked inline styles). What it checked: indent and split width applied; tab order; tree ArrowDown, Right, Left, Home and End with `aria-expanded`; the focus visit (Enter focuses the panel heading, Escape returns focus to the initiating tree item); tablist arrows with roving `tabindex`; Monaco mounting on tab open, model undo updating the Monaco view, disposal on tab close and recreation from the model with the text kept; an invalid value showing a `role=alert` message with `aria-invalid` and `aria-describedby` while the model stays untouched; a valid value becoming a command with Undo and Redo; select, checkbox and string commits; a native `<dialog>` with focus entering, Escape closing and focus returning to the opener; revert; and separator resizing by arrow keys (16 px steps, `aria-valuenow`, clamp) and by pointer.

* **No candidate supplies widget accessibility.** Every one of them needed the tree (36 lines of framework-free key logic), tablist handling, separator keyboard resize, the focus visit, the validation message wiring and the live status written by hand. The platform gave `<label for>`, native `<dialog>` focus handling and `<select>`/checkbox semantics in every build. The only framework-specific part was "wait for the DOM, then focus": Preact and React use a ref flag plus `useEffect`.
* **Svelte only** has a built-in compile-time accessibility lint (four warnings; three flag patterns the Authoring Practices allow). Preact would need `eslint-plugin-jsx-a11y` 6.10.2 (MIT, exists, **not installed or tested**).
* **Lit** had to use light DOM: a `<label for>` outside a shadow root and an input inside it gave `labels.length = 0`, and `aria-describedby` across roots does not resolve.
* **Headless component libraries** exist per ecosystem (Reka UI for Vue, Bits UI for Svelte, React Aria Components, Zag.js, which lists Preact, Vue, Svelte, React and vanilla adapters). Their keyboard correctness and CSP behaviour were **not tested**.
* **Not done:** no screen-reader run, no contrast measurement, no WCAG audit. This was ARIA-tree and keyboard behaviour in Chromium only.

### Licences (G6)

Method: `npm ls --omit=dev --all`, then the `license` field, the LICENSE file and `npm view` for every installed package. Every production tree is MIT, ISC, BSD-2-Clause, BSD-3-Clause or Apache-2.0; none is copyleft or unlicensed; `npm audit --omit=dev` reported 0 vulnerabilities in every one.

| | Production packages | Licences | Dev-only tools to name |
|---|---|---|---|
| Vue | 23 | MIT 20, ISC 1, BSD-2 1, BSD-3 1 | `@vue/compiler-sfc`, `vue-tsc` and `@volar/*`, `eslint-plugin-vue` |
| **Preact** | **1: `preact`** | **MIT** | **none** |
| Lit | 6 | BSD-3 5, MIT 1 | none |
| Svelte | 19 | MIT 17, Apache-2.0 2 | `esbuild-svelte`, `svelte-check`, `eslint-plugin-svelte` |
| React | 3 | MIT | `@types/react`, `@types/react-dom` |

`THIRD_PARTY_NOTICES` had 17 headings; Vue would add up to 23 entries, Preact one. Packages one would add around Vue are heavier than Vue: `vue-router` 5.4.0 has a 69-package production tree and `pinia` 4.1.0 a 31-package tree. The Lit-recommended test stack (`@open-wc/testing`) pulls `axe-core` (MPL-2.0) and `only@0.0.2` (no licence) into the dev tree, which the licence checker's dev-dependency rule would reject; nothing in the spike needed it. The DOM shim the spike used for headless tests, `@happy-dom/global-registrator` 21.0.4, is MIT (single maintainer). Monaco 0.57.0 (MIT) depends on `marked` 14.0.0 (MIT) and `dompurify` 3.4.15, whose licence is `(MPL-2.0 OR Apache-2.0)`; the checker accepts an `OR` when one side passes (`tools/licences/check.mjs:199`), so it passes by choosing Apache-2.0. Monaco's own `ThirdPartyNotices.txt` lists 28 components and was not audited.

### Docking

The question was whether the framework limits which docking library can be used. The docking research ran in jsdom (no layout, no pointer drag) and static scans of shipped code; **nothing was proven against the ADR 0022 D7.3 gate**, and no packaged-host docking proof exists.

* **ADR 0022's D7.2 table is out of date for dockview.** On 2026-11-09 `dockview` 8.9.0 (published 2026-11-08) is the **vanilla JavaScript** package, depending only on `dockview-core`; React moved to `dockview-react`, Vue is `dockview-vue` 8.9.0 (MIT, peer `vue ^3.4.0`), Angular is `dockview-angular`. Everything except `dockview-enterprise` is MIT with a zero-dependency tree.
* **The keyboard gap is confirmed.** Dockview's licence-comparison page lists "Spatial keyboard navigation" and "Keyboard docking" in the Enterprise column only, and `dockview-enterprise` is "This is not an open-source licence" (proprietary, licence key, watermark), blocked by G6. Running the MIT build with `keyboardNavigation: true` logged that the module "ships in dockview-enterprise" and Ctrl+M, F6 and Ctrl+] did nothing. The MIT core does have `role=tablist`, `tab`, `tabpanel` and `region`, roving tabindex with arrows, Home and End, and live regions. Its splitter has no role and no keyboard handling. The MIT API (`panel.api.moveTo`, `group.api.moveTo`, `group.api.setSize`, `adjacentGroupInDirection`, `activateNext`) is a base for a keyboard layer of our own.
* **Preact specifically:** one vanilla `dockview` instance rendered panels written in Preact, Lit, Svelte 5 and Vue 3 through its framework-neutral mount contract (`createComponent` returns `{ element, init }`), in jsdom, with Preact 10.29.8 (not 11). `dockview-react` on `preact/compat` was **not tested**. `flexlayout-react` 0.11.1 (MIT, React-only) under an alias to `preact/compat` produced the same DOM as React 19 in jsdom (same roles, same Ctrl+Delete close; 215,033 B min against 421,249 B), again on Preact 10.29.8; no field reports of it were found. Its splitters have the best built-in ARIA of any library examined (`role=separator`, `aria-valuenow`, arrow-key resize) but it has **no keyboard move or dock**.
* **Others failed the keyboard gate:** `dock-spawn-ts` 4.5.4 (0 ARIA roles, no keyboard docking, resize or tab navigation, panel titles set through `innerHTML`), `golden-layout` 2.6.0 (last release 2022, 0 accessibility), `@lumino/widgets` 2.10.0 (tab ARIA and arrows, but no splitter ARIA or keyboard and no keyboard docking, 12-package tree, no LICENSE file in its npm tarballs), `rc-dock` 4.1.0 (partial, 17-package tree).
* **CSP of the libraries** (static scan of shipped JavaScript, **not run**): none of `dockview-core`, `dock-spawn-ts`, `@lumino/widgets` or `golden-layout` uses `eval`, `new Function` or `setAttribute('style')`; popout windows inject `<style>` (dockview forwards a `nonce` option). Dockview's self-injecting UMD build injects an unnonced `<style>` and must not be used; use its ESM build with the separate CSS file.
* **A pinned MIT version matters:** dockview once moved features to Enterprise by mistake (#1610) and states "the free version should aim to never be behind the competition".
* **Cost of the keyboard layer, both [INFERENCE], neither prototyped:** dockview MIT core plus our own keyboard and focus layer, 300 to 700 lines; our own panel manager, 2,000 to 3,300 lines of TypeScript plus 300 to 500 lines of CSS, anchored on reading one 4,393-line open-source panel manager. Framework glue per candidate in the second case was estimated at 60 to 120 lines for Preact (Vue 150 to 260).
* **Conclusion of the research:** the framework does not decide the docking question. A framework-agnostic mount contract hosts any framework's panels, and the keyboard layer is ours whichever framework is chosen. Possible shortcut collisions between dockview's Enterprise defaults and Monaco's key bindings were recalled from memory, not checked.

### Ecosystem and maintenance

Registry and GitHub data pulled 2026-11-09. Primary-source quotes and URLs are in the spike's ecosystem report (scratch, not committed); the facts that matter for Preact and the main alternative:

* **Preact:** `preact` 11.2.0 published 2026-11-06; 11.0.0 published 2026-09-30, 5.7 weeks before the decision. 22 stable releases in 12 months. No foundation or company: funding is Open Collective, six npm maintainers. In the last 12 months one committer, JoviDeCroock, wrote 72.4% (205 of 283 commits) and a `claude` author appears in the top three with 30 commits; the report puts the nominal bus factor near 1.5. Over all time his share is 22.6%. The v11 guide describes itself as "minimally breaking" from 10.x and says 11.x is ESM-only (`.mjs`). One advisory since 2025 (GHSA-36hm-qxxp-pg3m, high, JSON VNode injection, fixed in 10.26.10, 10.27.3 and 10.28.2; 11.x not listed). SLSA provenance attestation is present. The statement "Preact is Google-backed" has no primary source and is treated as false.
* **Vue:** 3.5.45 (2026-11-05), 21 stable releases in 12 months, 3.x since 2020, 3.6 in release candidate. In the last 12 months `vuejs/core` had 209 commits from 20 authors, 140 (67%) by one person; Evan You's last substantive core commit is 2025-01-08. Independent and sponsor-funded; VoidZero (Vite's company) joined Cloudflare on 2026-06-04 and states Vite, Vitest, Rolldown, Oxc and Vite+ stay MIT. No Vue-based VS Code webview editor was found (absence of evidence).
* **React:** since 2026-02-24 owned by the React Foundation, hosted by the Linux Foundation; 29 stable releases in 12 months.
* **Lit:** two stable releases in 12 months (last 2026-05-14); `@lit/context` none. GitLens and Nx Console use it for webviews. `@vscode/webview-ui-toolkit` is archived and npm-deprecated; Microsoft said webview UIs are again "the full responsibility of extension authors". Its community successor `@vscode-elements/elements` is Lit, one maintainer (97.1%), and its icon-font peer `@vscode/codicons` is CC-BY-4.0, a G6 question for any icon use.
* **Svelte:** 91 stable releases, 58 authors in 12 months; twelve advisories since 2025, all patched. `esbuild-svelte` is one hobbyist (93.8% of commits).
* **Solid** was not prototyped: its esbuild plugin (`esbuild-plugin-solid`) has had no release since 2024-05-05.
* **Electron and `app://`:** Electron's documentation says a `standard` scheme resolves relative and absolute resources correctly. No framework documents `app://`. A history-mode router needs an index fallback on `app://`; hash mode does not. The prototype used no router.

### Developer experience

* **TypeScript, strict with `exactOptionalPropertyTypes`** (the repository's flags minus `composite` and `declaration`, plus `noEmit`). Five negative checks (wrong prop type, missing required prop, explicit `undefined` for an optional prop, wrong callback payload, unknown prop): Preact, React and Svelte caught all five; Vue's checker missed one (a wrong payload in an inline arrow with explicit wrong annotations); Lit caught what applies, but its templates are not type-checked (`.error=${5}` compiles). Preact's TSX is checked by `tsc -b` on TypeScript 7 in 0.25 s. TSX complies with `erasableSyntaxOnly`.
* **The TypeScript 6/7 split.** TypeScript 7.0 ships no programmatic API. `vue-tsc` 3.3.14 fails on `typescript@7.0.2` and works on the repository's `@typescript/typescript6` alias; Vue upstream says real `tsgo` support waits for an API "planned for TS 7.1". `svelte-check --tsgo` works but has open defects. `tsc -b` cannot see `.vue` or `.svelte` at all.
* **Enforcement scopes at `f8f6f245`.** `eslint.config.js:16` is `["**/*.{ts,tsx,mts,cts}"]`; the provenance extension list has `.ts` and `.tsx` and no `.vue` or `.svelte`. `dependency-cruiser`'s `.vue` and `.svelte` support is documented through its FAQ and was not run.
* **Headless tests under `node:test`.** One five-test file ran unchanged against all five builds on `@happy-dom/global-registrator` 21.0.4, after an esbuild bundling step of 15 ms for Preact: 5/5 for every candidate (React first failed 2/5 because its `onChange` is the DOM `input` event). The `node --test` wall time was 0.7 s for Preact and 3.5 s for Vue's first run. Lit's documentation advises against shimming the DOM; it passed anyway. Node's type stripping runs erasable-syntax `.ts` directly, so the framework-free modules need no bundling; JSX needs the esbuild step first. Real keystrokes (`3` in the speed field, `Hi` in the title) gave exactly two commands in all five builds.
* **Binding `editor-model` to the view.** The model exposes only `getSnapshot()` and `subscribe()`. Preact: `useState` plus `useEffect(() => doc.subscribe(...))`, 8 lines; Vue 8; React 6; Lit 9; Svelte 6. Undo updated the view in all five. No framework needed the model to change.

### Cost of being wrong

* **Framework-free by construction:** 175 non-blank lines of model, catalogue, validation and key logic, plus the Monaco bridge, against 179 to 205 lines of framework-specific view code. The Playwright probe and the `node:test` file ran **unchanged** against all five builds; only the imported entry differed. That is the strongest swap-safety measure available, because any re-implementation can be checked against the same DOM and ARIA behaviour.
* **Preact to React** changed 62 of 191 lines (imports, `class` to `className`, `useSyncExternalStore`, event types, `onBlur`), under an hour of mechanical work including debugging.
* **Vue or Svelte to TSX** is a rewrite of the template layer: the script logic mostly lifts out, every template becomes JSX. Per-component view code was 25 to 40 lines. **[INFERENCE]** If forms, inspectors, lists, tables, dialogs and the shell are 30 to 50% of `editor-ui`, a swap is a multi-week project proportional to that share, not a rewrite of the editor.
* **A swap would not touch** `editor-model`, platform-services, the document and command contracts, canvases, Monaco, the dock library mounted through the handle contract, the esbuild build, or the CSP profiles.

## What the spike could not verify

Carried over from the spike's own lists; every item is open.

1. **A packaged host.** Electron was the npm 45.2.1 binary running a scratch main process, not the repository's packaged editor. The VS Code run used `--extensionDevelopmentPath` in an isolated profile with synthetic key events and no Monaco; `vscode.dev` (the web extension host), `retainContextWhenHidden`, `getState`/`setState` persistence and the custom-editor lifecycle were not run.
2. **Monaco workers under CSP.** No `editor.worker.js` request was made; Monaco's style needs were measured at 0.57.0 only.
3. **Screen readers, WCAG, contrast, zoom and reflow.** Only Chromium ARIA-tree and keyboard behaviour.
4. **Real docking.** Nothing was proven against D7.3. The docking research ran in jsdom; `dockview-react` on `preact/compat`, Monaco shortcut collisions, two views over one dirty document, and focus restoration are untested. The `preact/compat` smoke test used Preact 10.29.8, not 11.
5. **Scale.** Performance, memory, large lists, trees and tables, virtualisation, drag and drop and canvas-heavy editors were not built or measured; the prototype is about 200 lines.
6. **Browsers and Node.** Chromium 156 only (no WebKit or Firefox); Node 26.13.0, not the pinned 24.21.0.
7. **Lint and graph enforcement.** `eslint-plugin-jsx-a11y`, `eslint-plugin-vue`, `eslint-plugin-svelte` and `dependency-cruiser`'s reading of `.tsx`, `.vue` and `.svelte` were not run; the scopes above are read from file globs, not from a run.
8. **Second-hand evidence.** All docking-library facts other than the dockview licence page, and all ecosystem registry and GitHub numbers other than the React Foundation quote, the Vue core commit dates and the npm versions and licences the lead run queried, come from sub-reports and were not re-fetched. GitHub contributor shares come from the default branch's commit counts, which indicate bus factor and not review or maintenance authority; bot filtering is regex-based.
9. **The Authoring Practices patterns** were implemented from memory and not diffed against the W3C text.
10. **Mechanisms not investigated:** why Chromium suppresses `blur` in a hidden Electron window; why a static `style="..."` literal is reported as a CSP violation yet applied in Lit and Svelte.
11. **Vue and Svelte specifics** (not relevant to the Preact decision, kept for the fallback): the Vue plugin covers only `<script setup lang="ts">` with a template, not `<style scoped>`, `v-bind()` in CSS or custom blocks; third-party esbuild Vue plugins were not evaluated; the `hoistStatic` cause was measured as an effect and a fix, not traced in the compiler.
12. **Support statements.** No end-of-support statement was found for Preact 10, Svelte 4, React 18, Lit 2 or Vue 3. No framework documents `exactOptionalPropertyTypes`. No Vue or Svelte VS Code webview precedent was found.
13. **Docking commercial terms.** Dockview's pricing and the Enterprise runtime behaviour (the watermark) are from repository documentation only; the live pages are client-rendered and were not captured.
14. **Whether Zag.js, Reka UI, Bits UI or React Aria** deliver correct keyboard and ARIA behaviour under CSP: not tested.

## Reproducing

The prototype app, its probes and the raw outputs were scratch work and are not committed. The method above says what was run; the commands were `node build-candidate.mjs <name> 15` for sizes, a 14-step Playwright probe over each CSP variant, `node --test` over a bundled file for the headless suite, and `npm ls --omit=dev --all` with a licence walk for the trees. 11.2 builds the real thing and carries its own proofs.
