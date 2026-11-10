# ADR 0025 — The `editor-ui` framework is Preact with TSX

* **Status:** Accepted (owner decision, 2026-11-09). Documentation only: no package is installed and no code is claimed by this ADR.
* **Date:** 2026-11-09
* **Answers:** [ADR 0022](0022-shared-editor-authoring-contracts.md) question 3 (D7.3: "which UI framework does `editor-ui` use?"). Refs [#1699](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1699) (entry 11.1) and unblocks story 11.2 ([#1700](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1700)); closes neither.
* **Amends:** ADR 0022 only by pointing D7.3 and question 3 here. It does not answer any other ADR 0022 question and does not change that ADR's status.
* **Does not amend:** [ADR 0015](0015-web-build-and-test-toolchain.md) (esbuild only, Vite not installed; no tool is added to its list), [ADR 0013](0013-desktop-shell-electron.md) (Electron), [ADR 0021](0021-monaco-code-editor.md) (Monaco), or G1 to G7.
* **Context documents:** [guardrails.md](../guardrails.md) (G2, G6, G7), [ADR 0022](0022-shared-editor-authoring-contracts.md) (D2, D7), [the evidence](../findings/editor-ui-framework/README.md), [epic editor-foundation](../../_bmad-output/initiative-rpgtoolkit-reawakened/epic-editor-foundation/epic-editor-foundation.md)

## Summary

In plain terms:

1. **The editor's screens are written in Preact, in `.tsx` files.** Preact is a small library for building screens (trees, tabs, forms, dialogs) out of components. TSX is TypeScript with HTML-like markup inside it. The compiler we already use, `tsc`, checks it, and the bundler we already use, esbuild, builds it. We add one package, `preact`, and nothing else.
2. **The parts that must be right do not depend on Preact.** Documents, undo history, validation, keyboard rules, the code editor and the canvases stay plain TypeScript, and each screen is handed to the host through one small contract (`mount(el, ctx)`, which returns something to `dispose`). That is what makes the choice cheap to undo.
3. **It was the owner's call.** A spike built the same small editor in five frameworks. None broke a hard rule, so the choice was a matter of cost and preference. The owner chose Preact. He was partial to Vue, said it did not have to be Vue, and said he would go Vue if Vite were available.
4. **This ADR does not choose a docking library, a router or a state library, and it does not decide how Monaco's styles are handled.** Those are separate decisions, and the open ones are listed at the end.

## The owner's decision

Jensen, 2026-11-09, answering ADR 0022 question 3: "good tsx files here we come. lets go prereact", which this ADR reads as Preact. Context he gave in the same exchange, paraphrased: he was partial to Vue, it does not have to be Vue, and he would go Vue if Vite were available.

That is all the owner said. The measurements and the costs below are the spike's, not his words. He did not ask for Vite to be admitted, and this ADR says nothing about Vite beyond what [ADR 0015](0015-web-build-and-test-toolchain.md) already says (decision 2: Vite is not installed; if it is ever wanted, an ADR for `lightningcss`, MPL-2.0, comes first).

## Context

**What `editor-ui` has to run in.** One build runs in three places ([ADR 0022](0022-shared-editor-authoring-contracts.md) D2; [guardrails.md](../guardrails.md) G2):

* a **VS Code webview**, under a CSP with a per-load script nonce and a `style-src` limited to `'self'` and VS Code's CDN origin. Monaco is not loaded there, because VS Code uses its native text editors ([ADR 0021](0021-monaco-code-editor.md) decision 2);
* the **browser PWA**, under a strict CSP with no `unsafe-eval`, shipped as esbuild single-file IIFE bundles with no runtime `import()` ([ADR 0015](0015-web-build-and-test-toolchain.md) decision 1; architecture spine, Operations);
* the **Electron `app://` shell** ([ADR 0013](0013-desktop-shell-electron.md)), a privileged scheme served by the main process, never `loadFile`.

**What the UI has to build.** From the UX research and the design notes: a Figma-style outline tree, tabs, resizable split panes, a properties panel that changes with the selection, schema-driven forms (settings rows with label, help, effective source and reset), searchable lists with a detail form, dialogs, canvases, Monaco, and docking. Canvases and Monaco are imperative by nature; the rest is where a framework helps.

**Rules that bound the choice.**

* G2: `editor-ui` reaches the host only through platform-services and imports no `host-*` package. The lint and dependency-graph checks must therefore be able to read the framework's source files.
* G6: only Bronze-or-better licences in shipped trees, and every production package named in `THIRD_PARTY_NOTICES` (the checker, `tools/licences/check.mjs`, fails on one that is not).
* G7: the provenance scan reads source files by extension; `tools/provenance/markers.json` lists `.ts` and `.tsx` and does not list `.vue` or `.svelte`.
* ADR 0015: esbuild bundles every browser artefact; Vite is not installed.

**The evidence.** A spike built one app of about 200 lines (a resizable split, a keyboard tree, a tab strip, a catalogue-driven form with validation, a native dialog, a command-stack toolbar and a Monaco mount) in Vue 3.5.45, Preact 11.2.0, Lit 3.3.3, Svelte 5.57.3 and React 19.3.1, over shared framework-free model and test code, and ran each in four CSP configurations, a real VS Code 1.145.2 webview and Electron 45.2.1 over `app://`. The method, every number and the unverified list are in [the findings record](../findings/editor-ui-framework/README.md); the spike's own reports were scratch work and are not committed. The result:

| | Vue 3.5.45 | **Preact 11.2.0** | Lit 3.3.3 | Svelte 5.57.3 | React 19.3.1 |
|---|---|---|---|---|---|
| App bundle, min / gzip | 73.5 KB / 29.0 KB | **21.8 KB / 8.9 KB** | 33.0 KB / 12.6 KB | 70.2 KB / 26.1 KB | 231.0 KB / 72.0 KB |
| Compiler plugin we would own | yes | **no** | no | yes | no |
| CSP violations, strict, after load | 0 | **0** | 5 | 0 | 0 |
| Keyboard and ARIA probe, strict | 14/14 | **14/14** | 12/14 | 14/14 | 14/14 |
| Production packages (G6) | 23 | **1** | 6 | 19 | 3 |
| Checked by `tsc -b` | no | **yes** | classes only | no | yes |

No candidate failed a hard constraint. The differences are cost, size and maintenance risk.

## Decision

1. **Preact with TSX is the component layer of `editor-ui`.** It is used for the shell, the outline tree, tabs, split panes, forms, lists, tables and dialogs. The version is **Preact 11.x**, pinned to one exact version in `package.json` (no range; the repository pins `esbuild` and `typescript` the same way). The spike measured 11.2.0, published 2026-11-06. A version bump is its own change and must pass the DOM and ARIA suite and the CSP probe of decisions 6 and 8. Preact 10 is not used.
2. **JSX is compiled by esbuild's built-in JSX transform, with no plugin, and type-checked by `tsc -b`.** There is no Babel, no Vite and no Preact preset. TSX files sit inside the existing ESLint scope (`**/*.{ts,tsx,mts,cts}`) and the G7 provenance scan (`.tsx` is in its extension list), as measured at `f8f6f245`. The exact `tsconfig` and esbuild JSX keys (the automatic runtime with `preact` as the import source is the expected shape) are set and proved in 11.2; they are not recorded here because the spike's settings were scratch.
3. **`preact/compat` is not admitted.** It is added only when a React-only library is unavoidable, and then by an ADR that names the library, why no alternative exists, and what the compatibility layer costs (see [open question 3](#open-questions)).
4. **The core stays framework-free behind a view-handle contract.** `editor-model`, platform-services, the settings catalogue and validation, keyboard-navigation logic, canvases and the Monaco bridge do not import Preact. A view is handed over as `mount(el, ctx) -> { dispose }`, which is what [ADR 0022](0022-shared-editor-authoring-contracts.md) D7.1 already means by "a dock holds a view handle". A Preact component binds to a document through `getSnapshot()` and `subscribe()` only, with one small hook; the spike's hook was eight lines of `useState` and `useEffect`. The model needs no change for the framework. A framework swap is then a job for the template layer alone.
5. **The dependency set is `preact` alone.** `preact/hooks` is part of that package. `@preact/signals`, `preact-iso` (router), `@testing-library/preact`, a headless accessibility library (the spike did not test Zag.js, which lists a Preact adapter) and any state library each need their own ADR. The accessible widgets (tree, tabs, separator, dialog, focus return) are written against the W3C ARIA Authoring Practices on shared, framework-free key logic, as in the spike, and proved by DOM-level tests.
6. **CSP rules for `editor-ui` bundles**, from what was measured.
   * **Scripts.** `script-src` is `'self'` or a nonce; `unsafe-eval` is never allowed. No shipped `editor-ui` bundle may contain `eval(` or `new Function`. The strict policy measured was exactly `default-src 'none'; script-src 'self'; style-src 'self'`, and the nonce variant (the VS Code webview shape) was `script-src 'nonce-N'; style-src 'self' 'nonce-N'`. Preact produced **0 violations** after load under both policies and **0** in a real VS Code webview (Monaco not loaded); the 32 violations that appear under strict and nonce policies come only from opening Monaco, and in Electron over `app://` the strict policy's only console errors were Monaco's (12, the same for every framework).
   * **Styles.** A style reaches the page as a class in a stylesheet served from `'self'`, or through the CSSOM (Preact's `style` prop, `element.style.x = …`, `style.setProperty`). The Preact `style` forms measured under the strict policy (object, dynamic string, static literal) all applied with 0 violations. Nothing may route a `style` attribute through markup: no `dangerouslySetInnerHTML`, `innerHTML` or `insertAdjacentHTML` carrying `style="…"`, no `setAttribute("style", …)`, and no injected `<style>` element, because those need `style-src 'unsafe-inline'` or a nonce.
   * **Monaco is decided separately.** The spike found that Monaco 0.57.0, not the framework, needs `style-src 'unsafe-inline'` where it is embedded: it creates unnonced `<style>` elements and style attributes (32 violations under strict, the same for every framework), and a nonce does not help. The VS Code webview does not embed Monaco and can keep the strict `style-src`. What the PWA and Electron profiles do about Monaco is not decided here ([open question 2](#open-questions)).
7. **Docking is not decided here.** [ADR 0022](0022-shared-editor-authoring-contracts.md) D7's adoption gate stands. What the research found: dockview's MIT core is vanilla and hosts any framework's panels (it rendered Preact panels in jsdom); keyboard docking is only in `dockview-enterprise`, which is proprietary and blocked by G6; no library examined passes the keyboard gate out of the box. A keyboard and focus layer of our own is needed whichever framework is used. It is estimated, not prototyped, at 300 to 700 lines on dockview's MIT API, or 2,000 to 3,300 lines for a panel manager of our own. D7.2's table is out of date for dockview (`dockview` is now the vanilla package; React is `dockview-react`, Vue is `dockview-vue`), which the docking decision will correct.
8. **Tests run under `node:test` with a DOM shim, and in the Playwright lane for browser behaviour.** The spike's headless suite bundled the test and the component with esbuild and ran `node --test` on `@happy-dom/global-registrator` 21.0.4 (MIT, dev-only, one maintainer). It is named here with its licence, as [G6](../guardrails.md#g6--licence-gate) and ADR 0015 decision 5 ask of any never-shipped tool; 11.2 may substitute another permissively licensed shim by amending this line. Tests assert on DOM and ARIA, not framework internals, so the same suite checks any future replacement. Real-browser checks (focus, tab order, CSP violation counts, Monaco mount and dispose) use the Playwright lane of ADR 0015 decision 3.
9. **Licence.** Preact is MIT and its production tree is one package. The `THIRD_PARTY_NOTICES` entry lands with the first install, in 11.2, not in this change.

## Consequences

**What it buys.**

* The smallest bundle measured: 21.8 KB minified and 8.9 KB gzip, against 73.5 KB and 29.0 KB for Vue and 231.0 KB and 72.0 KB for React, with Monaco excluded from all (Monaco alone is 2.7 MB minified).
* One production package and one `THIRD_PARTY_NOTICES` line, against 23 for Vue.
* No compiler plugin to own and no second type checker. TSX is checked by `tsc -b` on TypeScript 7 in 0.25 s with the repository's strict and `exactOptionalPropertyTypes` settings, and the five negative type checks the spike tried (wrong prop type, missing required prop, explicit `undefined` for an optional prop, wrong callback payload, unknown prop) all errored.
* TSX is already inside the lint and provenance scopes, so G2's restricted imports and G7's scan read the editor's views with no change to either.
* It runs in a real VS Code webview (0 CSP violations), in Electron over `app://` and in the browser; under the strict policy the only violations were Monaco's.

**What it costs.**

* **Preact 11 is new and thinly maintained.** Preact 11.0.0 was published on 2026-09-30, about five weeks (5.7) before this decision. In the last 12 months one committer wrote 72.4% of the commits (205 of 283), against 67.0% for Vue's core and 21.7% for React; the spike's ecosystem notes put the nominal bus factor near 1.5. There is no foundation or company behind it, only Open Collective funding. Against that: 22 stable releases in the same 12 months, six npm maintainers, SLSA provenance on the package, an upgrade guide that calls 11 "minimally breaking" from 10.x, and one advisory since 2025, against 10.x only. This is a risk accepted by the owner with that evidence in view. The **revisit triggers** are in the next section.
* **Accessibility widgets are written by hand.** The spike measured this for every candidate: none supplies tree, tablist, separator or focus-return behaviour. Our own framework-free key logic and DOM-level tests carry the work, and a headless library would be a dependency needing its own ADR. WCAG conformance, screen-reader behaviour and contrast were not measured by the spike and remain a target to verify, not a claim.
* **A smaller ecosystem for the docking route.** The React-only docking libraries run only through `preact/compat`, which decision 3 gates behind an ADR, and the compat smoke test used Preact 10.29.8, not 11.
* **A keyboard docking layer is ours whatever the framework.** This cost is not caused by this choice.
* **Preact needs a build step for JSX.** esbuild does it with no plugin, and the repository already bundles with esbuild.

**Follow-up work (not done here; this is a documentation-only change).** What 11.2 does first:

1. Add `preact` as the one dependency, pinned exactly, with its `THIRD_PARTY_NOTICES` entry (the licence check requires it for every production package).
2. Set the JSX options in the TypeScript configuration and in the esbuild build, and show `tsc -b` and the bundle agree.
3. Add a check that no `editor-ui` bundle contains `eval(` or `new Function`, and a strict-CSP probe in the Playwright lane that counts violations outside Monaco.
4. Check that the dependency-graph check reads `.tsx` and that a `.tsx` file importing a `host-*` package fails lint (the spike read the lint and provenance scopes from their file globs and did not run them; the graph check was not run on `.tsx` either).
5. Name the DOM shim at install (decision 8) and, if it is `@happy-dom/global-registrator`, its licence line.

**Revisit triggers for the framework** (set here, on the evidence above; the owner may change the thresholds):

* a security advisory against Preact 11.x with no patched release within 30 days;
* no stable Preact 11 release for six months;
* the commit concentration above getting worse, to a single committer with no other maintainer active in a 12-month window;
* a requirement the framework cannot meet in 11.2 or later, found by the proofs the spike did not run (scale, a packaged host, docking).

If one fires, the first step is to write an ADR that weighs Vue and React again, not to swap.

## Alternatives considered

* **Vue 3.5.45.** Passed every hard constraint with real runs: G2, G6 (23 MIT, ISC or BSD packages), esbuild with a single IIFE, no `unsafe-eval` (runtime-only build), 14/14 keyboard and ARIA checks, and 0 CSP violations in a real VS Code webview and in Electron. 73.5 KB minified and 29.0 KB gzip. It was **the owner's stated leaning**, has 21 stable releases a year and a 3.x line since 2020, and has an official docking wrapper (`dockview-vue` 8.9.0). The spike's report recommended it. The measured costs: a 25-line esbuild plugin over `@vue/compiler-sfc` that we would own because Vite is not installed (it covers only `<script setup lang="ts">` and templates); `vue-tsc` runs only on the TypeScript 6 API, which TypeScript 7 does not ship, so type-checking `.vue` needs a second checker beside `tsc -b`; at `f8f6f245` ESLint, the G7 provenance scan and the dependency graph do not see `.vue`; up to 23 `THIRD_PARTY_NOTICES` entries; one compiler hazard (static hoisting drops `style="…"` under a strict CSP, fixed by `hoistStatic: false`); about 51 KB more minified than Preact; and core commits concentrated in one person (67% over 12 months). **Vue is the documented fallback.** It is reconsidered only if both conditions hold: (a) Vite is admitted for builds by an ADR (ADR 0015's revisit trigger, with `lightningcss`, MPL-2.0, handled there as a dev-only tool), and (b) the guardrail gaps for `.vue` are closed, meaning ESLint, the provenance scan and the dependency graph read `.vue`, and the type-check of `.vue` has a supported path on the TypeScript in use. This ADR does not say Vite is allowed or forbidden beyond what ADR 0015 says. The spike also showed that the Vue SFC route works through an esbuild plugin without Vite, so condition (a) is about who owns the build integration, not about whether Vue can be built.
* **Svelte 5.57.3.** 0 CSP violations, 14/14 checks, 91 stable releases and 58 authors in 12 months, and the only compile-time accessibility lint. 70.2 KB minified and 26.1 KB gzip, 19 production packages, and a compiler plugin that is a single hobbyist's 0.x project (`esbuild-svelte`, 93.8% of commits); `svelte-check` needs TypeScript 6 and its `--tsgo` path has open defects; `.svelte` sits outside `tsc -b`, ESLint and the G7 scan.
* **Lit 3.3.3.** Standards-based, no plugin, 6 production packages, used by GitLens and Nx Console for webviews. 33.0 KB minified and 12.6 KB gzip. Five CSP violations: `styleMap` on first render and `style="${x}"` are blocked by `style-src` without `'unsafe-inline'`, which broke the tree indent and split width (12/14 steps under the strict policy). Shadow DOM breaks `label for` and `aria-describedby` across roots (0 labels measured), so views would have to use light DOM; templates are not type-checked; two stable releases in 12 months.
* **React 19.3.1.** Same TSX workflow as Preact, so it is the cheapest fallback in the TSX family (the spike's Preact-to-React port changed 62 of 191 lines in under an hour). Owned by the React Foundation since 2026-02-24, 29 stable releases a year, the best docking-library support (`dockview-react`, `flexlayout-react`, `rc-dock`, native), 3 production packages. 231.0 KB minified and 72.0 KB gzip, about ten times Preact, and no docking library supplies keyboard docking anyway.
* **Plain web components, hand-rolled.** Not built separately; the Lit measurements (light DOM) and the framework-free modules cover what it would be. It would duplicate framework work for forms-heavy screens.
* **Solid.** Not prototyped: its esbuild plugin has had no release since 2024-05-05 and carries no provenance attestation.
* **A different framework per panel.** Rejected: it multiplies bundles and toolchains. The handle contract of decision 4 allows an exception only by ADR.

## Open questions

1. **Docking library and keyboard layer** (ADR 0022 D7.3). Does dockview's MIT core plus our own keyboard layer pass the adoption gate in a packaged host, or is a panel manager of our own needed? Needs the D7.3 proof.
2. **The Monaco CSP split.** The PWA and Electron profiles need `style-src` with `'unsafe-inline'` while Monaco 0.57 is embedded, and Monaco's worker CSP (`worker-src`, blob workers) was never exercised. Accept that, or wait for or replace Monaco's style injection? This amends ADR 0021's integration obligations when decided.
3. **Whether `preact/compat` is ever admitted.** The one candidate use is `flexlayout-react`; it rendered like React 19 in jsdom on Preact 10.29.8, with no field reports found. `dockview-react` on compat is untested, and nothing was run on Preact 11.
4. **Accessibility approach beyond the first widgets.** Hand-written patterns on shared key logic (what the spike did), or a headless library evaluated under CSP and keyboard tests.
5. **What the spike left unverified that matters** (the full list is in [the findings record](../findings/editor-ui-framework/README.md#what-the-spike-could-not-verify)):
   * a packaged host: Electron ran as a scratch main process, and the VS Code run used synthetic key events with no Monaco; `vscode.dev`, `retainContextWhenHidden`, `getState`/`setState` and the custom-editor lifecycle were not run;
   * Monaco workers under CSP, and Monaco's behaviour at any version but 0.57.0;
   * screen readers, WCAG conformance, contrast, zoom and reflow;
   * real docking: nothing was proven against D7.3, and Monaco shortcut collisions, two views over one dirty document and focus restoration are untested;
   * scale: performance, memory, large lists and trees, virtualisation, drag and drop and canvas-heavy editors;
   * Chromium only (no WebKit or Firefox) and Node 26.13.0 rather than the pinned 24.21.0;
   * whether `dependency-cruiser` and the lint scope read `.tsx` as measured by file globs, which were not run;
   * second-hand registry, GitHub and docking-library facts that were not re-fetched, and contributor shares that indicate bus factor but not review authority.
