# Document-kind identification in structured-text ecosystems

Question: for TK Reawakened's native on-disk format (YAML authored, JSON derived, each document opens with a `contract:` and `version:` stamp, path is the ID), should a document's kind be carried by:
- (1) `name.<kind>.yaml` (e.g. `walk.clip.yaml`);
- (2) plain `.yaml`, relying on folders and the in-file stamp;
- (3) per-kind custom extensions, including reusing legacy `.anm`, `.brd`, `.tem`, `.itm`, `.ene` that will coexist during migration?

Scope: primary sources only. Every claim below names the URL and what was read there. Unverified items are kept in a separate section.

---

## 1. Schema association by editors and language servers (yaml-language-server, VS Code, SchemaStore)

### 1a. yaml-language-server README
URL: https://github.com/redhat-developer/yaml-language-server/blob/main/README.md (read lines 299–423 of 643: priority list, custom tags, client list).

- A file can declare its own schema with a modeline `# yaml-language-server: $schema=<url-or-path>`, or with a top-level inline `$schema:` property, or via the `yaml.schemas` setting.
- Priority, highest first: modeline; inline `$schema`; registered custom schema provider; `yaml.disableSchemaDetection`; `yaml.schemas`; `json/schemaAssociations` notification; SchemaStore.
- `yaml.schemas` maps a schema to glob(s); `!` excludes; at least one positive pattern is required.
- Relative modeline and inline paths resolve from the YAML file; relative `yaml.schemas` paths resolve from the workspace root.
- `yaml.schemaStore.enable` defaults to true and uses `https://www.schemastore.org/api/json/catalog.json`.

### 1b. VS Code JSON documentation
URL: https://code.visualstudio.com/docs/languages/json (read in full).

- Association is either an in-file `$schema` key or the `json.schemas` setting. The doc warns that the in-file key "changes the JSON itself" and that consumers may fail validation.
- `json.schemas` supports `*` and `!`. A leading `/` anchors to the root. An association matches if a pattern matches and the last matching pattern is not an exclusion.
- `files.associations` maps filenames/patterns to language modes.

### 1c. SchemaStore CONTRIBUTING
URL: https://raw.githubusercontent.com/SchemaStore/schemastore/master/CONTRIBUTING.md (read lines 1–523 of 756).

- Each schema's `catalog.json` entry has a `fileMatch` used by IDEs and language servers.
- VS Code ignores catalog.json (cites microsoft/vscode#26289). yaml-language-server, taplo, tombi, and vscode-json-languageservice (VS Code, Zed, Emacs lsp-mode) use it.
- Quote: with yaml-language-server, `fileMatch` "will not work as expected if no `.ya?ml` extension is supplied with a custom file extension" (cites yaml-language-server#790 and SchemaStore PR #3982).
- "Avoid Generic `fileMatch` Patterns": a `config.toml` pattern was rejected for false positives (Hugo). Fixes listed: have the tool read a more specific file, omit `fileMatch`, or prepend a directory (e.g. `"**/micro/runtime/syntax/*.yaml"`).
- "Use Simple `fileMatch` Patterns": avoid `{...}` alternations and extended globs.

### 1d. yaml-language-server issue #790 (read directly, not via SchemaStore)
URL: https://github.com/redhat-developer/yaml-language-server/issues/790 (open; last updated 2023-08-04; read via GitHub API).

- Title: "JSON Schema (still) not applied for custom file extension". Reporter: schemas are not applied to files with custom extensions configured through `files.associations`.
- Reporter's diagnosis: the custom extension is pushed as the entire pattern (e.g. `*.bu`) and then matched with `indexOf` against the schema `fileMatch`, so the asterisk breaks the match.
- Maintainer (gorkem, 2022-11-18): "The string matching is too simple for that case and we should do a glob match."
- sam-mccall (2022-12-29) argues that the LSP says the editor decides whether a file is YAML, so yaml-language-server should not filter SchemaStore patterns by extension. He notes the mechanism fails when a user manually sets the language to YAML in the editor, and that `files.associations` is VS Code-specific, so other editors send nothing.
- gorkem (2023-01-03): yaml-language-server builds its schema index from `files.associations`; incremental indexing on `didOpen` is a possible fix. The team is "not staffed to test/implement the LSP on editors other than VSCode."

### 1e. VS Code issue #26289 (read directly)
URL: https://github.com/microsoft/vscode/issues/26289 (open; read via GitHub API).

- VS Code does not default to the SchemaStore catalog. Associations from user settings and extensions win. Catalog is a fallback only (aeschli, 2020-01-27).
- The issue is still open. A SchemaStore maintainer (2026-08-28) asked that the catalog URL be used if VS Code adopts it. A PR (#327628) is referenced as in progress.
- Net effect: a file whose kind is identified only by a custom extension gets no automatic schema in VS Code unless the user configures it (see 1b).

---

## 2. Filename and folder-based dispatch (kind carried by path or name)

### 2a. Jest default `testMatch`
URL: https://raw.githubusercontent.com/jestjs/jest/main/docs/Configuration.md (read by grep for `testMatch`).

- Default: `[ "**/__tests__/**/*.?([mc])[jt]s?(x)", "**/?(*.)+(spec|test).?([mc])[jt]s?(x)" ]`.
- Text: matches "any files with a suffix of `.test` or `.spec` (e.g. `Component.test.js`)". Also "files called `test.js` or `spec.js`".
- Relevance: a major tool keys on a kind-suffix placed before the language extension. This is the precedent for option (1). It also shows the tool uses extglob-style patterns and an explicit fallback for names without a stem.

### 2b. TypeScript `.d.ts` (read via grep of the d.ts-from-js handbook page)
URL: https://www.typescriptlang.org/docs/handbook/declaration-files/dts-from-js.html

- `.d.ts` is a double-suffix kind marker on a `.ts`-family extension. The page treats it as a declaration file kind, emitted from `.js` with `outDir`.
- Relevance: second precedent for a kind carried by a two-part suffix. Also shows the kind's files are placed by `package.json` resolution (`types`, `main`), i.e. by in-file/config pointers, not by name alone.

### 2c. Terraform files (read via grep)
URL: https://developer.hashicorp.com/terraform/language/files

- "There is also a JSON-based variant of the language that is named with the `.tf.json` file extension." A module is "a collection of `.tf` and/or `.tf.json` files."
- Relevance: the same language in two syntaxes is distinguished by a double extension (`.tf` vs `.tf.json`). This is a dialect discriminator, not a kind discriminator, but it is precedent for option (1)'s shape.

### 2d. GitHub Actions workflow files
URL: https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions (read via grep).

- "Workflow files use YAML syntax, and must have either a `.yml` or `.yaml` file extension."
- "You must store workflow files in the `.github/workflows` directory of your repository."
- Relevance: kind is determined by folder; the extension only has to be YAML. This is evidence for option (2). It does not show the kind is ever read from the file, which weakens it as a complete precedent.

---

## 3. In-file kind and version markers

### 3a. Kubernetes object manifests
URL: https://kubernetes.io/docs/concepts/overview/working-with-objects/ (read lines 59–123 of 511).

- "By convention, manifests are YAML (you could also use JSON format)."
- Required fields: `apiVersion` ("Which version of the Kubernetes API you're using"), `kind` ("What kind of object you want to create"), `metadata`.
- Relevance: the kind and version live inside a plain YAML file, with no extension distinction. Strongest in-file precedent for option (2).

### 3b. OpenAPI 3.1.1 `openapi` field
URL: https://spec.openapis.org/oas/v3.1.1.html (grep of the Document Structure table).

- `openapi`: "***REQUIRED***. This string *MUST* be the version number of the OpenAPI Specification that the OpenAPI Document uses. The `openapi` field *SHOULD* be used by tooling to interpret the OpenAPI Document. This is *not* related to the API `info.version` string."
- Relevance: a required in-file version stamp that tooling uses to interpret the document. Same role as our `version:`. Also separates document-format version from content version.

### 3c. Godot TSCN format (scene files)
URL: https://docs.godotengine.org/en/stable/engine_details/file_formats/tscn.html (grep of the file).

- "Scenes and resources saved with Godot 4.x contain `format=3` in their header, whereas Godot 3.x uses `format=2` instead."
- The header looks like `[gd_scene format=3 uid="uid://..."]` and "should be the first entry in the file."
- Relevance: Godot 3 and 4 both use `.tscn`. Version coexistence is handled by an in-file stamp, not by a new extension. This is the closest precedent to our migration question, and it argues against reusing legacy extensions to signal a new format.
- Note: `load_steps` is "deprecated and should be ignored" in 4.6+. The `uid` field is a stable identity independent of path.

### 3d. Unity text-serialized scenes
URL: https://docs.unity.com/en-us/engine/6000.6/manual/working-with-scenes/text-scene-format/format-description.md (read in full, via alternate markdown).

- Each object is a separate YAML document introduced by `---`. The class is identified in-file by a tag: `--- !u!1 &6`, where the number after `!u!` is the class ID and the number after `&` is the in-file object ID.
- Compact primitive arrays use a trailing type character (e.g. `m_Array: 0100000002000000i`). Unity says that "tools ... such as a merge tool or a validation script ... make sure those tools accept the trailing type character."
- Relevance: kind is an in-file tag inside YAML. Also an explicit warning that external tooling must parse Unity's YAML subset.
- Not established from this doc: Unity's asset file extensions. See UNVERIFIED.

---

## 4. Editor and OS behaviour for extensions

### 4a. Windows: extension drives application association
URL: https://support.microsoft.com/en-us/windows/common-file-name-extensions-in-windows-da4a4430-8e76-89c5-59f7-1cdbbc75cb01 (read via grep).

- "Windows file names have two parts separated by a period: first, the file name, and second, a three- or four-character extension that defines the file type." Example: `expenses.xlsx`.
- "Extensions tell your computer which application created or can open the file and which icon to use for the file."
- "You can change a file name extension, but that won't convert the file to another format or change anything else about it except the file name."
- Relevance: association is keyed on the final extension. `walk.clip.yaml` is a YAML file to the OS. A legacy `.anm` file is opened by whatever app is bound to `.anm`. Renaming does not convert content, so a file keeps the old extension's meaning if its name is not changed.

### 4b. GitHub linguist overrides
URL: https://raw.githubusercontent.com/github-linguist/linguist/main/docs/overrides.md (grep of the file; earlier read of the rendered doc).

- `.gitattributes` `linguist-language=<name>` sets highlighting and classification on GitHub.com. Takes effect only after the `.gitattributes` is committed.
- "Languages that are not yet mentioned in `languages.yml` will not be included in the language statistics, even if you specify ... `linguist-language=MyCoolLang linguist-detectable`."
- Relevance: a custom extension is not a clean path for GitHub stats. It needs a mapping to an existing language name. Mapping `.anm`/`.brd` to a language is a repo-level change that GitHub applies per commit.

---

## 5. Evidence table

| Option | Evidence for | Evidence against |
|---|---|---|
| **(1) `name.<kind>.yaml`** | Jest default `testMatch` keys on a `.test`/`.spec` suffix before the language extension (2a). TypeScript `.d.ts` and Terraform `.tf.json` use two-part suffixes (2b, 2c). Windows keys association on the last extension, so `*.yaml` stays YAML to the OS (4a). yaml-language-server's `.ya?ml` requirement (1c) is satisfied because the last segment is `.yaml` (inference; see UNVERIFIED). | Duplicates identity: kind lives in both name and stamp, so drift is possible (inference). SchemaStore warns against generic `fileMatch`, so a `*.clip.yaml` pattern must be specific (1c). No source checked here shows a kind-suffix pattern working end-to-end in yaml-language-server (unverified). Adds a naming convention every tool must know. |
| **(2) plain `.yaml`, folders + in-file stamp** | Kubernetes carries `apiVersion`/`kind` in plain YAML by convention (3a). OpenAPI requires an in-file version stamp that tooling uses (3b). Godot keeps format version in-file (`format=3`) and avoids a new extension (3c). GitHub Actions dispatches by folder with only a YAML extension requirement (2d). yaml-language-server supports a modeline that is a comment and does not add a key (1a). | `fileMatch` on generic `.yaml` is rejected by SchemaStore (1c), so folder-scoped globs are needed (`"**/dir/*.yaml"`). Without a modeline or a `yaml.schemas` entry, editors cannot tell kind from the name (1a, 1b). VS Code does not default to the SchemaStore catalog (1e), so it needs explicit config. Inline `$schema:` in VS Code changes the JSON (1b), so the modeline is the cleaner choice. |
| **(3) per-kind custom extensions** (incl. reuse of `.anm`, `.brd`, `.tem`, `.itm`, `.ene`) | Godot uses distinct extensions per type (`.tscn`/`.tres`) with an in-file version stamp (3c). Extension makes kind visible to the filesystem, Explorer, and grep without opening the file (4a). | yaml-language-server does not match custom extensions unless the pattern contains `.ya?ml` (1c). Open issue #790 reports `files.associations` custom extensions not applied (1d). Other editors send no `files.associations` (1d, sam-mccall). Reusing legacy extensions means old and new files share a suffix and the OS association; the in-file stamp is then the only discriminator (4a). GitHub has no mapping for unknown names, so highlighting needs `.gitattributes` after commit (4b). |

---

## 6. What this suggests for us (with honest uncertainty)

The evidence points one way on option (3) and leaves (1) versus (2) open.

- **Option (3) is the weakest on current evidence.** Editor support for custom extensions in the YAML ecosystem is documented as incomplete (#790, open). Reusing legacy extensions also makes the OS and any extension-keyed tool treat new documents as the old kind. Godot's choice to keep one extension and bump an in-file `format=` stamp across versions is the closest precedent, and it argues against reuse.
- **The in-file stamp should be authoritative.** Kubernetes, OpenAPI, and Godot all put kind or version inside the document. Our `contract:`/`version:` stamp fits that pattern. Tooling that needs the kind before opening a file can read a yaml-language-server modeline or a `yaml.schemas` entry, which is outside the document's data model.
- **Between (1) and (2), the evidence does not decide.** Option (2) matches Kubernetes and GitHub Actions. Option (1) matches Jest and TypeScript, and the OS handles it correctly. Its cost is a second source of identity that can drift from the stamp. A hybrid may be the least risky: plain `.yaml` plus folder placement plus the in-file stamp, with a per-file modeline if editor schema validation is needed. Add a kind suffix only if a tool we need cannot key on folders or stamps. This is my inference, not a finding from the sources.
- **Before choosing (1), test glob behaviour.** Whether `*.clip.yaml` works with yaml-language-server `yaml.schemas` and SchemaStore `fileMatch` is not verified here. Run it against our actual tooling.

Uncertainty: I did not read any source that tests a kind-suffix on a YAML file in yaml-language-server. The SchemaStore `.ya?ml` rule and #790 concern custom extensions, not double extensions. Treat the (1)-viability claim as inference until tested.

---

## 7. UNVERIFIED (recalled or search-snippet only; not fetched and read)

- yaml-language-server CHANGELOG 1.25.0 mentions "negated schema file-match patterns in `yaml.schemas`." Seen only as a search snippet. Not fetched.
- SchemaStore catalog snippet with `"fileMatch": ["/def//*.yaml"]`. Seen only as a search snippet.
- Vitest default `include` (believed to be `**/*.{test,spec}.?(c|m)[jt]s?(x)`). The grep of vitest.dev did not return the pattern. Not confirmed.
- Storybook `*.stories.*` convention: not checked.
- Unity asset file extensions (`.unity`, `.prefab`): not in the fetched doc; not checked.
- GitHub rendering of a custom extension with no linguist mapping (plain text vs. unhighlighted): not verified. linguist overrides says only that such names are excluded from stats.
- macOS APFS case-insensitivity and Windows NTFS behaviour for name collisions across case: not checked. Git `core.ignorecase` not checked.
- Explorer "Hide extensions for known file types" and double-extension display: the Microsoft page covers how to show extensions but was not fully read for hide-by-default behaviour.

## 8. Not covered (out of time budget)

- Compose spec top-level `name`/`services` as kind markers; AsyncAPI `asyncapi:` field; JSON-LD `@type`; Home Assistant packages.
- Adobe and Blender text-format conventions.
- Microsoft Office `.doc` → `.docx` migration and content sniffing (only the Windows extension doc was read).
- Glob semantics `**/` vs root-relative `/` in yaml-language-server specifically (VS Code's semantics were read in §1b).
