# Candidate facts and dispositions

This separates **notation**, **value mapping**, **parser**, **source editor**, **schema validator** and **evaluator**. A failure in one column is not evidence against every implementation of the language. See [first-pass findings](first-pass.md) for measured outcomes and [reproduction](reproduce.md) for commands.

## Data notations: exact choices

All ten received the same populated logical game documents. All ten have actual Node and Edge parse/edit/validation evidence; RON uses the official Rust parser compiled to WebAssembly. No parser was written to rescue a candidate.

| Candidate / implementation | License evidence | Exact release evidence | Primary-document disposition |
|---|---|---|---|
| JSON / native Node 26.13.0 and Edge 157 | Platform implementation; no added parser package | Exercised runtime versions | Control and viable simple option; no comments, escaped multiline source |
| YAML 1.2 / `yaml@2.9.1` | ISC, shipped license and package declaration | npm 2026-09-11 | Finalist; readable blocks and mature document API; noncanonical no-op formatting is not byte-perfect |
| KDL v2 / `@bgotink/kdl@0.4.1`, JSON-in-KDL mapping | MIT, shipped license and package declaration | npm 2026-10-13 | Finalist; tested AST source preservation and compact rows; creator-facing JiK conventions need evaluation |
| TOML / `smol-toml@1.9.1` | BSD-3-Clause, shipped license and package declaration | npm 2026-10-09 | Viable but null and nested array-table costs are substantial here |
| JSON5 / `json5@2.2.3` | MIT, shipped license and package declaration | npm 2022-12-31 | Familiar alternative; chosen serializer discards comments; not a source editor |
| Hjson / `hjson@3.2.2` | MIT, shipped license and package declaration | npm 2020-11-17 | Credible alternative; `keepWsc` preserves comments but not exact layout; default multiline is useful with declared LF normalization |
| RON / `ron@0.12.3`, `serde_json@1.0.149` | RON MIT OR Apache-2.0; serde_json MIT OR Apache-2.0 | official RON release 2026-10-28 | Viable, not dismissed as Rust-only; generic value bridge is not a comment-preserving or typed-struct editor |
| EDN / `edn-data@1.2.2` | MIT, shipped license and package declaration | npm 2026-07-24 | Compact and viable notation; chosen parser's malformed-input diagnostic behavior is a serious authoring limitation |
| XML / `fast-xml-parser@5.12.0` | MIT, shipped license and package declaration | npm 2026-11-03 | Technically viable; generic typed elements are noisy, a domain vocabulary could differ materially |
| SDLang / `sdlang@0.2.2` | npm declares ISC; no license file shipped in inspected package | npm 2021-07-24; no repository URL in package metadata | Promoted to full hands-on track; current JS parser/serializer deficiencies prevent recommending this implementation |

Dates above are **exact-version publication dates**, not vague “last modified” dates. An older release alone does not prove abandonment; a recent release alone does not establish quality. The [registry snapshot](data/npm-metadata.json), [official releases](data/releases.json), and [repository activity/license metadata](data/repository-evidence.json) preserve the distinction. The SDLang license/package provenance gap must be resolved before adoption; no workspace dependency was added.

### Mapping and source-edit costs

| Candidate | Null, structure and inline source mapping | Tested source/edit path | Validation and diagnostic path |
|---|---|---|---|
| JSON | `null`; ordinary maps/arrays; newline escapes in strings | Native parse/stringify; no comment syntax | Ajv2020 after parse; native syntax offsets; duplicate keys already collapsed |
| YAML | `null`; string-key maps/sequences; LF source can use literal blocks | `parseDocument`, `setIn`, `toString`; comments and lexical forms retained, some layout normalized | Unique keys enabled; Ajv2020; real scalar range mapped through `LineCounter` |
| KDL | JiK objects/arrays; `#null`; fields emitted as child nodes rather than compact properties | Parse/format AST; replace argument value; untouched formatting preserved in tested cases | JiK rejects duplicate object keys; Ajv2020; actual argument-node locations |
| TOML | No native null: explicit `__tkr_null` object marker, recursively escaped when that spelling is actual data; arrays-of-tables for records | Parse/stringify; comments lost and some key ordering changed | Parser rejects duplicate keys and unsafe integer; Ajv2020 after marker decoding; parser line/caret errors |
| JSON5 | Native null; comments/trailing commas; line continuation is not a literal newline in a string | Object parse/stringify loses comments | Ajv2020; syntax line/column; duplicate keys collapse |
| Hjson | Native null, optional punctuation, multiline strings; normalize LF explicitly | `rt.parse`/`keepWsc`; comments survive but whitespace and numeric spelling can change | Ajv2020; parser diagnostics; duplicate keys collapse |
| RON | Serde JSON-domain values; null is unit `()` in this bridge; arrays remain ordered | Official parse/pretty serialize; comments not retained; no handwritten RON parser | Ajv2020 after conversion; official span diagnostics; generic map duplicate keys collapse |
| EDN | `nil`, string-key maps, ordered vectors; EDN scalar escaping supplied by library | Small labeled **layout emitter**, not a parser; stock emitter is one line; no CST retention | Ajv2020; malformed truncated inputs return null, losing useful syntax location; duplicate keys collapse |
| XML | Generic typed `<v>` tree; null; document order controls arrays; **XML 1.0-forbidden characters rejected** | XMLBuilder/XMLParser; numeric tab/LF/CR references preserve legal keys under independent Python/Edge parsers; no CST editing | XML lexical checks plus Ajv2020; typed booleans require exact `true`/`false`; **XSD not exercised**; duplicate-key behavior belongs to this mapping |
| SDLang | Generic typed `entry` tree; null marker avoids broken native-null parser; decimal suffix; strings explicitly escaped | Small labeled emitter because stock serializer does not escape quotes; unchanged SdlReader parser | Ajv2020; native-null, unsuffixed-decimal and exponent failures reproduced; no native schema engine claimed |

The TOML escape case is deliberately injective: an actual `{__tkr_null: true}` must not become null. This adds nesting and is not presented as ordinary TOML ergonomics. XML/SDLang generic trees repeat type/key labels for every scalar; their size and readability results **must not be generalized to a carefully designed domain schema**. Conversely, the reduced punctuation in EDN/KDL is not itself a human-readability measurement.

Post-review XML details and negative controls are in [the correction record](review-corrections.md). The original local-parser-only roundtrip evidence concealed attribute-whitespace normalization and invalid-character acceptance. The corrected profile is deliberately narrower than arbitrary JavaScript strings; it rejects, rather than strips or silently replaces, forbidden characters. This does not disqualify XML as a notation.

The RON bridge intentionally does not exploit named structs/enums/typed extensions. Those would require an explicitly designed model and JS mapping, not an unnoticed change to the common fixture. EDN keywords, tags, sets and arbitrary map keys are similarly outside the chosen value profile. Arbitrary execution/evaluation is never enabled by parsing an extension payload.

## Browser/TypeScript and dependency cost

Actual measured standalone minified export bundles, **raw / gzip bytes**:

| Library | Bytes |
|---|---:|
| YAML | 103,914 / 32,125 |
| KDL core only | 36,362 / 10,631 |
| TOML | 16,864 / 6,624 |
| JSON5 | 32,424 / 9,951 |
| Hjson browser bundle | 18,404 / 7,599 |
| EDN | 8,945 / 2,707 |
| XML | 78,828 / 25,146 |
| SDLang | 29,210 / 6,900 |
| Ajv2020 | 134,717 / 40,639 |
| Official RON WebAssembly bridge | 349,235 / 121,614 |

These are **not equal-scope application bundle measurements**. KDL's separately imported JSON mapping and bridge glue are not in its standalone core figure. RON's figure includes the unoptimized-for-size Rust/Serde bridge, but not Ajv. Native JSON adds no package. The complete actual browser probe imported all necessary mapping pieces and passed; raw/gzip figures are dependency observations, not an adoption budget.

`yaml`, KDL, smol-toml and edn-data expose typed/modern APIs; the experiment itself is JavaScript and did not run the repository's TypeScript gates. Hjson requires its published browser distribution instead of its Node entry; SDLang's module shape differs between browser ESM and Node CJS. Official RON WASM works but introduces compilation, allocation/UTF-8 conversion, packaging and ABI maintenance. The research ABI is not a hardened public interface.

Research-only supporting tools: Ajv **8.20.0** (MIT), esbuild **0.28.2** (MIT), Playwright **1.65.0** (Apache-2.0), Rust **1.93.0**, Python **3.15.2**. Exact npm transitive versions/integrities and Rust dependencies are retained in the [isolated manifests](../../../../tools/research/native-data-notations/astra/dependencies.json), [npm lock](../../../../tools/research/native-data-notations/astra/npm-lock.json), and [Cargo lock](../../../../tools/research/native-data-notations/astra/ron/Cargo.lock). The older `hocon-parser@1.0.1` was installed during reconnaissance but **not** credited as an evaluated HOCON implementation. No complete dependency-security/G6 release clearance is claimed.

## SDLang feasibility investigation, not silent exclusion

The [official site](https://sdlang.org/) documents Java, .NET, C, D and Dart implementations, including Dart-to-JavaScript, as well as namespaces, raw strings, null, decimal types and compact matrix syntax. That is meaningful notation capability. The npm implementation was viable enough to promote and run across all four projects, in Node and in Edge.

Its native null parsing, unsuffixed decimal parsing and string serializer fail the minimal reproduced cases. The scoped emitter/mapping let us investigate the same model without inventing a parser, but exponent parsing still fails and source comments are lost. The official alternative-language implementations are real possible routes; none was ported to JS/WASM in this experiment. Thus the conclusion is **“do not adopt this JS implementation as tested,” not “SDLang cannot do it.”** The current licensing provenance gap is also implementation-specific.

## Composition/evaluation track

All five were run with official implementations and local authored source files. See [composition results](data/composition-results.json) for commands, outputs, failures and origin diagnostics.

| Candidate / version | License and maintenance evidence | Schema/evaluation semantics exercised | Editing and host implications |
|---|---|---|---|
| HOCON / Typesafe Config **1.4.10** | Apache-2.0 declared in the **exercised JAR manifest**; release 2026-11-06 | Includes/substitutions, last-value/object-merge rules, typed `getInt`, source origins; not JSON Schema | Explicit override file; native Java 27 used. Artifact manifest requires Java 11; current README examples mention older requirements. Official source model has origins; no general inverse source editor was built. |
| CUE **0.17.1** | Apache-2.0; release 2026-07-16; repository activity snapshot retained | Unification, computed constraint conflict, explicit default alternative, located type errors | Computed value must be edited at expression or deliberately made overrideable. Native Go CLI used; no browser evaluator/API port exercised. |
| Dhall **1.42.2**, dhall-json **1.7.12** | BSD-3-Clause; release 2025-01-19 | Typed imported records, computation, record override, rejection of wrong annotation | Source comments/imports are not reconstructed from normalized output. Native Haskell tools used; no browser evaluator exercised. |
| Nickel **1.18.0**, rev `e6515c4` | MIT; release 2026-09-19 | Runtime contracts, equal-priority conflict, `force` shadowing, explicit editable priorities | A lower-priority graphical edit can have no effect; must expose source/priority policy. Official native Rust binary used with recorded system-library workaround. No browser evaluator integration exercised. |
| Pkl **0.33.0** | Apache-2.0; release 2026-11-05 | Typed modules, `amends`, `super`, explicit override and located constraint failure | Edits belong in a named amendment or expression. Native evaluator used; official CLI distributions include native/Java, not the JS parser path used for data notations. No browser evaluator built. |

For each, source comments remained in untouched authored files; that is **not** evidence of comment-preserving evaluated-output write-back. JSON export removes syntax, imported definitions and expression provenance. There is no automatic unique answer to “change this computed value in the GUI”: preserve the expression, change its input, or add an override with explicit author intent. CUE/Nickel merging is language evaluation, **not Git conflict resolution**.

The fixture imports are local. HOCON's environment fallback was disabled and negatively exercised. Remote imports, environment readers and resource permissions in the other languages were not security-tested. These evaluators would live in host-side authoring/build tooling, with inputs pinned before deterministic core ingestion. Their native functionality is demonstrated; their browser/editor integrations remain unexercised, not declared impossible or absent from the entire ecosystem.

## Primary documentation

These sources support syntax/tool claims; measured behavior is in the retained results, which takes precedence over an API's marketing language.

- JSON: [RFC 8259](https://www.rfc-editor.org/rfc/rfc8259)
- YAML: [eemeli/yaml API](https://eemeli.org/yaml/), [YAML 1.2.2](https://yaml.org/spec/1.2.2/)
- KDL: [notation](https://kdl.dev/), [chosen implementation](https://github.com/bgotink/kdl), [pinned JSON-in-KDL specification](https://github.com/kdl-org/kdl/blob/76d5dd542a9043257bc65476c0a70b94667052a7/JSON-IN-KDL.md)
- TOML: [TOML 1.1 specification](https://toml.io/en/v1.1.0), [smol-toml](https://github.com/squirrelchat/smol-toml)
- JSON5: [standard](https://spec.json5.org/), [implementation](https://github.com/json5/json5)
- Hjson: [notation](https://hjson.github.io/), [hjson-js](https://github.com/hjson/hjson-js)
- RON: [official 0.12.3 README](https://github.com/ron-rs/ron/blob/v0.12.3/README.md)
- EDN: [specification](https://github.com/edn-format/edn), [edn-data API](https://github.com/jorinvo/edn-data); [jsedn alternative](https://github.com/shaunxcode/jsedn) was researched but not substituted or declared license-cleared
- XML: [XML 1.0 Fifth Edition](https://www.w3.org/TR/2008/REC-xml-20081126/), [fast-xml-parser](https://github.com/NaturalIntelligence/fast-xml-parser)
- SDLang: [specification and implementations](https://sdlang.org/), [exact npm package](https://registry.npmjs.org/sdlang/0.2.2)
- HOCON: [specification](https://github.com/lightbend/config/blob/main/HOCON.md), [official API/schema guidance](https://github.com/lightbend/config)
- CUE: [explicit defaults](https://cuelang.org/docs/howto/specify-a-default-value-for-a-field/), [official implementation](https://github.com/cue-lang/cue)
- Dhall: [language tour](https://docs.dhall-lang.org/tutorials/Language-Tour.html), [official implementation](https://github.com/dhall-lang/dhall-haskell)
- Nickel: [merge priorities](https://nickel-lang.org/user-manual/merging/), [official implementation](https://github.com/nickel-lang/nickel)
- Pkl: [language reference](https://pkl-lang.org/main/current/language-reference/index.html), [actual distribution/host options](https://pkl-lang.org/main/current/pkl-cli/index.html)
- Schema tooling: [Ajv draft-2020-12 support](https://ajv.js.org/json-schema.html), [JSON Schema 2020-12](https://json-schema.org/draft/2020-12)

## Key source files

- [Mappings and API calls](../../../../tools/research/native-data-notations/astra/adapters.mjs)
- [Browser experiment](../../../../tools/research/native-data-notations/astra/browser.mjs)
- [Official RON bridge source](../../../../tools/research/native-data-notations/astra/ron/src/lib.rs)
- [Evaluator experiments](../../../../tools/research/native-data-notations/astra/composition.py)
- [Download URLs and SHA256](../../../../tools/research/native-data-notations/astra/downloads.json)
