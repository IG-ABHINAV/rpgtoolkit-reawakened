# Text-editor walkthrough (Opus, #1778)

Part of the [Opus independent report](README.md). **Everything recorded under "Agent rehearsal" was performed by an AI agent with scripted plain-text edits. It is not observed human usability.** The "Try it yourself" section is a short walkthrough for Jensen.

## Try it yourself (about 10 minutes, no graphical editor)

Use the **authored** mini project, which contains no game data. The same project is written in nine notations under [`examples/`](examples/): `yaml`, `json-layout`, `json5-layout`, `hjson`, `toml-rows`, `kdl`, `edn`, `ron-compact`, `xml`. Pick two notations, for example `yaml` and `kdl`, and do the steps in each:

1. Open `examples/<n>/scenes/courtyard/scene.<ext>`. Find placement `gatekeeper-2`. Its `actor` value names a document: open `examples/<n>/actors/gatekeeper.<ext>` (rule: actor IDs live in `actors/<id>`).
2. In that actor, find what core owns (`presence`, `behaviour`) and what a plugin owns (`extensions` → `org.example.dialogue-portraits`). Ask yourself whether the file tells you who owns each part.
3. Change the gatekeeper's walking speed: `secondsPerFrame` `0.3` → `0.25`.
4. In the scene, add a second line to placement `gatekeeper-1`'s inline script, e.g. `wait();`.
5. Add a third placement `gatekeeper-3` at `[160, 64, 1]` by copying the second.
6. Misspell its actor (`gatekeepr`) and run the checker. You should see a `file:line:col` broken-reference error (no location for JSON5, Hjson, EDN or RON):

```sh
# from the repository root, with the scratch library install present
node tools/research/native-data-notations/opus/check.mjs \
  docs/findings/native-data-notations/opus/examples/<n> --skip-external
```

7. Run it on `examples/<n>-invalid`. It reports a schema error (layer `0`), a plugin-schema error (`hail`), a syntax error in `scenes/hall`, and the two invalid files' references to the actor that this deliberately partial directory omits.

Please note, per notation: where you hesitated, which punctuation you had to get right, and whether you had to hold the rest of the file in your head. That is the human evidence this report does not have.

`check.mjs` loads its libraries from the isolated scratch install (`NOTATION_LIBS`, default `/private/tmp/tkr-1778-opus-experiments`). Recreate that install with the commands in [README § Reproduce](README.md#reproduce).

## Agent rehearsal on the real demo projection

`walkthrough.mjs` wrote the real demo projection in each notation, performed the edits below as plain string edits on the files, then ran `check.mjs`. Results are in `/private/tmp/tkr-1778-opus-experiments/results/walkthrough.json`; trees are in `.../walkthrough/<notation>/`.

| Task | YAML | JSON | JSON5 | Hjson | TOML | KDL | EDN | RON | XML |
|---|---|---|---|---|---|---|---|---|---|
| Placement → actor definition: line located by tooling | line 183 | line 246 | none | none | line 236 | line 159 | none | none | yes |
| Change `secondsPerFrame` | 1-line diff | 1 | 1 | 1 (inline `{…}` line) | 1 (inline table line) | 1 (property) | 1 | 1 | 1 |
| Add a 2nd statement to inline RPGCode | block scalar `\|-`, readable | `\n` escape inside a quoted string | same as JSON | same | same | same (the writer used an escaped string, though KDL supports `"""` blocks) | same | same | literal newline in element text |
| Result exactly as intended | yes | yes | yes | yes | yes | yes | yes | yes | yes |
| Lines touched to add a placement (minimal hunk) | 5 | 8 (incl. a comma on the previous line) | 8 | 6 | 6 | 4 | 8 | 1–n (compact) | ~10 |
| Broken actor reference found | `scene.yaml:194:12` | `scene.json:260:7` | file only | file only | `scene.toml:244:1` | `scene.kdl:165:19` | file only | file only | line |
| Rename clip project-wide (`renameReference`) | format-preserving, 0 broken after | format-preserving | re-emit (no editor lib) | format-preserving | format-preserving | format-preserving | re-emit | re-emit | format-preserving |
| Rename scene `out` → `harbour`: inline `send("out.brd", …)` | **2 script-literal warnings**; code not rewritten | same | same | same | same | same | same | same | same |
| Rename scene `out` → `harbour` (corrected, #1787): folder move | `scene` and sibling `tiles` moved to `scenes/harbour/`, 0 errors after | same | same | same | same | same | same | same | same |
| Rename clip onto existing `start-defend` (corrected, #1788) | **refused before any write**; files unchanged | same | same | same | same | same | same | same | same |

Excerpts (real demo data, short):

```diff
# YAML: adding a statement turns the scalar into a block (readable)
     whilePresent:
-      inline: itemPath("source", tkMV_WAYPOINT_LINK,  "wp_oldman", 0);
+      inline: |-
+        itemPath("source", tkMV_WAYPOINT_LINK,  "wp_oldman", 0);
+        mwin("Lovely weather.");
```

```diff
# KDL (JiK): one property per line is easy; scripts become escaped strings
-      whilePresent inline="itemPath(\"source\", tkMV_WAYPOINT_LINK,  \"wp_oldman\", 0);"
+      whilePresent inline="itemPath(\"source\", tkMV_WAYPOINT_LINK,  \"wp_oldman\", 0);\nmwin(\"Lovely weather.\");"
```

```diff
# TOML (toml-patch writer): nested values become long inline tables
-timing = { secondsPerFrame = 0.3, idleAfterSeconds = 3 }
+timing = { secondsPerFrame = 0.25, idleAfterSeconds = 3 }
```

## Agent observations (judgement, not measurement)

- **Locating:** every format needs a convention (`actor: oldman` → `actors/oldman.*`). No notation provides cross-file navigation; the checker and the project rules do. Where the library gives no locations (JSON5, Hjson, EDN, RON), the checker can name only the file.
- **Ownership:** an `extensions` block keyed by reverse-DNS namespace was equally clear in every notation. The checker's `unvalidated-no-schema` info line was the only place ownership was explained.
- **Scripts:** readability depends on whether the *writer* emits a multi-line string form. YAML (`|-`), XML and Hjson did; the JSON-family, TOML, KDL, EDN and RON writers emitted one escaped line, although TOML (`'''`), KDL (`#"""…"""#`), RON (`r#"…"#`) and EDN support multi-line text. Hand-typed pitfalls observed:
  - YAML `|` (instead of `|-`) silently adds a final newline.
  - TOML `"""` with an unescaped `\` is rejected with an error.
  - KDL `"""` with `\ ` silently drops the backslash and following whitespace.
- **Context to hold in mind:** JSON's trailing-comma rule touched the previous line on every append. TOML required knowing which `[[table]]` a following `[table.sub]` attaches to. Indentation-sensitive YAML and the bracket nesting of EDN/RON each impose their own load. This report does not rank those loads; that needs human testing.
