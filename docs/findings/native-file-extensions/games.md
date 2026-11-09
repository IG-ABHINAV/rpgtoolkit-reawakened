# How game engines and game-maker tools name and identify data files

Research for the TK Reawakened native-format extension decision.
Scope: games engines/tools only (plus one tooling datapoint for YAML schema association).
Every claim has a URL and a note on what was read. Items I could not verify are in the last section and are labelled UNVERIFIED.
No repo was modified.

Reading note: some doc pages were fetched as markdown mirrors of the current docs (Godot 4.7 docs, Unity 6000.6 docs, Bevy 0.19/main).
Several of them describe 2026 versions.

---

## 1. Per-tool findings

### Godot
**Extension scheme.**
- Text and binary forms get different extensions: `.tscn`/`.tres` (text), `.scn`/`.res` (binary).
  - Read: https://docs.godotengine.org/en/stable/tutorials/scripting/resources.html — "Anything Godot saves or loads from disk is a resource… a `.tscn` or a `.scn` file"; "save Resources as version-control-friendly text files (*.tres). Upon exporting a game, Godot serializes resource files as binary files (*.res)".
- `.tres` is ONE generic extension for all text resource kinds.
  - Kind lives in the header, e.g. `[gd_resource type="ArrayMesh" format=3 uid="uid://dww8o7hsqrhx5"]`.
  - Read: https://docs.godotengine.org/en/stable/engine_details/file_formats/tscn.html
  - Same page: `[gd_scene format=3 uid="uid://cecaux1sm7mo0"]` "should be the first entry in the file".
  - Same page: ESCN is "identical to the TSCN file format" but has a different extension, to tell Godot the file was exported from another program and must not be edited. So the extension carries provenance semantics, not just syntax.

**Identity.**
- Paths (`res://…`) are the identity.
  - Read: https://docs.godotengine.org/en/stable/tutorials/best_practices/project_organization.html — "uses the filesystem as-is, without metadata or an asset database".
- Godot 4 added 64-bit UIDs. A text file carries its own uid in its header, so "no extra files are required".
  - Read: https://github.com/godotengine/godot/pull/50786 (reduz, 2021). References store both text path and UID, "UID always has priority".
  - Stated goal in that PR: move/rename "from a file explorer, version control, or anywhere with the editor closed".
- UIDs were incomplete in 4.0 because scripts and shaders are "plain text" with nowhere to put a UID. 4.4 added `some_file.gd.uid` sidecars.
  - Read: https://godotengine.org/article/uid-changes-coming-to-godot-4-4/
  - That page also explains why they rejected the alternatives:
    - `.meta`-for-everything;
    - one central UID database (merge conflicts, add-ons break);
    - an embedded comment/annotation ("a lot of pushback").
  - It uses full-name sidecars (`.gd.uid`, `.shader.uid`) specifically "in case a script and shader file have the same name (but a different extension) within the same folder".
  - Fallback if `.uid` files are not committed: references resolve by path with warnings, which can silently swap two resources.
- Documented pain with sidecars: https://github.com/godotengine/godot-proposals/discussions/11574 (read via grep).
  - Many users hate `.uid` files: clutter, manual moves, "I would rather have 'magic' in my scripts".
  - One proposal lists "untyped .tres + untyped .uid" confusion when many files share a stem (`warrior.tscn/.glb/.gd/.png/.tres/.json/.uid`).
  - One user reports the maintainers' reply that the earlier attempt at embedded comments also met pushback, and that user feedback on `.uid` was "i used to hate it but then stopped caring".
  - Treat the last point as a user-reported paraphrase of a meeting, not an official statement.
- `.import` sidecars are `example.png.import`: full filename plus a suffix.
  - Read: https://docs.godotengine.org/en/stable/tutorials/assets_pipeline/import_process.html — "Make sure to commit these files".

**Godot 3 → 4 and same-extension evolution.**
- `format=3` is Godot 4; `format=2` is Godot 3. The extensions did not change.
  - Read: tscn doc above.
- Upgrade guide: a project converter is required.
  - Some same-extension files are simply incompatible: "If you've saved an ArrayMesh resource to a `.res` or `.tres` file, the format used in 4.0 is not compatible with the one used in 3.x. You will need to… import… and save it again."
  - Read: https://docs.godotengine.org/en/stable/tutorials/migrating/upgrading_to_godot_4.html (grep).
  - The converter has size limits: default 4 MB and 100,000 lines, above which files are not upgraded.
- Evidence for (c): extension collision and rename. `.shader` was renamed to `.gdshader` for 4.0.
  - Read: https://github.com/godotengine/godot-proposals/issues/2488 (Calinou, 2021).
  - Problem as stated: `.shader` is generic. External editors apply GLSL linting and show errors. `.shader` is also used by Quake 3's unrelated shader language. GitHub misclassifies the files as GLSL.
  - The same issue lists the downside of a custom extension: third-party tools lose syntax highlighting until extensions exist.
  - Upgrade guide (above): "The `.shader` file extension is no longer supported… rename… and update references".
- The same collision pattern again in 2024: Godot's non-standard GLSL under `.glsl` breaks glslang/IDE plugins.
  - Read: https://github.com/godotengine/godot-proposals/discussions/10880
  - A contributor prototyped kind-marker double extensions: `.vertex.glsl`, `.fragment.glsl`, `.compute.glsl`. Rationale: "keep `.glsl` at the end for compatibility with other tools".
  - This is a prototype in a discussion; I did not check whether it merged.
- Evidence for (a), double extensions: https://github.com/godotengine/godot-proposals/issues/4668 "Specify the kind of a .tres with a .kind.tres 'double extension' filenaming scheme".
  - State: OPEN, last activity 2022-07.
  - Motivations: tell the kind at a glance in a file explorer; faster icon selection (reading the header is slower); keep ResourceLoader to one extension per type.
  - Examples: `.mat.tres`, `.mesh.tres`, `.env.tres`, `.theme.tres`, `.action.tres` for a project's own `ActionData` subclass.
  - A commenter (lyuma) says "all my scripts already use .mat.tres or .mesh.tres". The proposal is explicitly only "a convention in the Save dialog", with no engine requirement.
  - It was not adopted in the sources I read. I did not check later Godot releases.
- Counter-evidence on naming: https://github.com/godotengine/godot-proposals/issues/3255 (rename `tscn`/`tres` to `scene`/`res`).
  - Closed for lack of support.
  - Maintainer views: "extensions that you use often should be kept short", underscores and dashes in extensions "look awkward", and "learning extensions doesn't take long… as long as they are distinguishable".

### Unity
**Extension scheme.**
- Kind-specific extensions for scenes and prefabs: `.unity`, `.prefab`.
- Generic `.asset`, `.mat` and `.controller` for other YAML-serialised assets.
  - Read: https://docs.unity.com/en-us/engine/6000.6/manual/get-started/project-configuration/version-control/smart-merge.md
  - UnityYAMLMerge merges `.unity`, `.prefab` and `.meta`. "By default… doesn't merge other YAML-serialized files, such as `.asset`, `.mat`, or `.controller`"; you need `--force`.
  - Setup for every VCS (Perforce, UVCS, Mercurial, TortoiseGit) is keyed by file extension, e.g. entering `.unity;.prefab`.
  - So tooling hooks attach to extensions. Generic extensions get less tooling.

**Text vs binary.**
- Asset Serialization Mode defaults to "Force Text".
  - Read: https://docs.unity.com/en-us/engine/6000.0/manual/unity-editor/editor-settings-reference/comp-manager-group/class-editor-manager — "Choose which format to use for storing serialized Assets… set to **Force Text** by default… To help with version control merges, Unity can store scene files in a text-based format".
- The same `.unity` extension is used for either form. Kind and format are distinguished by content, not extension. The doc implies this but does not state it outright.

**Text format and kind.**
- Unity's text format is "a custom subset of YAML". Each object is a separate YAML document with a header like `--- !u!1 &6`.
  - Read: https://docs.unity.com/en-us/engine/6000.6/manual/working-with-scenes/text-scene-format/format-description.md
  - The `!u!<classID>` tag gives the object class.
  - Unity's own docs say the format is not designed for hand editing.
- Unity blog: "the YAML Type is the same for every script; just MonoBehaviour. The actual script is referenced in the `m_Script` property, using the GUID of the script's meta file".
  - Read: https://unity.com/blog/engine-platform/understanding-unitys-serialization-language-yaml (grep).
  - So for `.asset` ScriptableObjects the real kind is a GUID reference into another file.

**Identity.**
- `.meta` file per asset and per folder holding the GUID and import settings. It must travel with the asset.
  - Read: https://docs.unity.com/en-us/engine/6000.6/manual/assets-and-media/import-assets/asset-metadata.md — "If an asset loses its `.meta` file, any reference to that asset is broken"; Unity generates a new one "as if it's a brand new asset".
  - Moves/renames done outside Unity need a manual `.meta` rename.
  - Folders get `.meta` too, with special logic for VCS that cannot store empty folders.
- Cross-file reference = GUID (in the `.meta`) plus a file-local `fileID`.
  - Read: the Unity blog above.

### Bevy
**Extension scheme.**
- The scene loader registers `["scn", "scn.ron"]`: kind marker plus syntax, as a double extension.
  - Read: https://raw.githubusercontent.com/bevyengine/bevy/main/crates/bevy_world_serialization/src/world_asset_loader.rs (grep, line ~73).
- `bevy_common_assets` documents the convention `JsonAssetPlugin::<Level>::new(&["level.json"])` loading `trees.level.json`. It offers the same for ron, toml, yaml, xml and others.
  - Read: https://docs.rs/bevy_common_assets/latest/bevy_common_assets/
- The engine resolves loaders by full extension, then secondary extensions: `get_full_extension()` followed by `iter_secondary_extensions`.
  - Read: https://raw.githubusercontent.com/bevyengine/bevy/main/crates/bevy_asset/src/server/loaders.rs (grep, lines ~203–213 and ~255–259).
  - So double extensions are first-class in the loader lookup.
- A planned custom extension: the new scene crate says scenes can be authored with `bsn!` or "in the future, `.bsn` asset files".
  - Read: https://raw.githubusercontent.com/bevyengine/bevy/main/crates/bevy_scene/src/lib.rs (first 300 lines).
  - Bevy moved from `.scn(.ron)` to its own new notation and a new single-segment extension. The old crate is now `bevy_world_serialization`.

**Pain.**
- Extension→loader mapping is not one-to-one.
  - https://github.com/bevyengine/bevy/issues/367 — glTF contains many asset types.
  - https://github.com/bevyengine/bevy/issues/2680 — two loaders registered for `.mp3`; "The second one was always chosen" and the type parameter was ignored.
  - Both closed. I read the issue text only, not how they were fixed.

**Identity.**
- Asset V2 uses a sidecar appended to the full name: `assets/my_sprite.png.meta`.
  - Read: https://github.com/bevyengine/bevy/pull/8624 (first ~300 lines). Meta files are optional; defaults are used if absent.
- Bevy identity is the asset path.
  - The tracking issue lists "Avoid Reprocessing on Asset Renames / Moves… 'canonical asset ids'" as an open question.
  - Read: https://github.com/bevyengine/bevy/issues/9714 (search snippet only).

### Tiled
**Extension scheme.**
- One kind per extension, per syntax: `.tmx` (XML map), `.tsx` (XML tileset), `.tmj` (JSON map), `.tsj` (JSON tileset), `.tj` (JSON template/other), `.world` (JSON), `.tiled-project`.
  - Read: https://raw.githubusercontent.com/mapeditor/tiled/master/NEWS.md — "JSON plugin: Added 'tmj', 'tsj' and 'tj' as accepted file extensions".
  - By line position this sits in the 1.8.0 section (Feb 2022). I inferred the version from line numbers, not from a heading adjacent to the line.
  - Same file: Linux file associations were added for `.tmj`, `.tsj`, `.tiled-project`, `.world`; macOS UTIs were declared for "all supported Tiled formats".
- Before `.tmj`, JSON used plain `.json`. Kind was told apart by content: the map doc has `"type": "map"` and a `version` field.
  - Read: https://doc.mapeditor.org/en/stable/reference/json-map-format/
- `.world` is documented as "a JSON file" with a custom extension.
  - Read: https://raw.githubusercontent.com/mapeditor/tiled/master/docs/manual/worlds.rst (grep).
- Mix-and-match is normal: "A TMX can have a TSJ tileset, a TMJ can have a TSX tileset, and any other combination".
  - Read: https://discourse.mapeditor.org/t/different-tileset-formats/6627
  - Importer authors must handle every combination.
- Tiled's own NEWS mentions "Fixed exporting to a file name containing multiple dots (#2149)" in 1.2.5. This is a small multi-dot bug in a game tool.

### LDtk
- `.ldtk` is "pure JSON". Optionally levels are saved as separate `*.ldtkl` files in a sub-folder named after the project.
  - Read: https://ldtk.io/docs/game-dev/json-overview/optional-separate-levels/ (grep).
  - Also read: https://raw.githubusercontent.com/deepnight/ldtk/master/docs/JSON_DOC.md (grep) — `.ldtkl` is "just a JSON file", there is a `jsonVersion` field, and `iid` unique identifiers exist for project, level, layer instance and entity instance.
- Custom extension per kind, JSON syntax, version field in-file, IDs inside the content (`iid`), no sidecars.
- I did not find documented pain about the custom extensions.

### RPG Maker MZ
- Kind comes from a hard-coded filename plus `.json` in `data/`.
  - Read: https://raw.githubusercontent.com/stak/rmmz-corescript/master/rmmz_managers.js (grep) — `DataManager._databaseFiles = [{ name: "$dataActors", src: "Actors.json" }, … "Items.json", "System.json", "MapInfos.json"]` and `"Map%1.json".format(mapId.padZero(3))`.
  - This is a community mirror of the official corescript, not Kadokawa's own repo.
- Each generation changed the extension with the format.
  - A translation-tool README lists `.ldb/.lmt/.lmu` (2000/2003), `.rxdata`, `.rvdata`, `.rvdata2`, `.json` (MV/MZ).
  - Read: https://github.com/RPG-Maker-Translation-Tools/rvpacker-txt-rs-lib — search snippet only.
  - This is evidence for (c)/(d): a binary-to-text switch came with a new extension. It is a third-party description, not RPG Maker docs.
- A fixed filename per kind does not extend to user-defined kinds. MZ uses ID-in-file (array index) with no extension kind marker.

### GameMaker
- Everything is `.yy` (resource) plus one `.yyp` (project). "JSON-like".
  - Read: https://manual.gamemaker.io/lts/en/Additional_Information/Project_Format.htm (grep).
  - Their `.gitignore` marks `.yy` as `linguist-generated`, "which prevents GitHub from identifying these as the wrong language", and forces LF line endings.
- Kind is in content: a `resourceType` field (e.g. `"GMShader"`) plus `resourceVersion`, both on nested sub-resources too.
  - Read: https://raw.githubusercontent.com/bscotch/gamemaker-info/develop/notes/gamemaker-projects.md
  - Same source: in 2.3 the `.yy` files have trailing commas, so standard JSON parsers cannot read them.
  - Same source: `resources` entries in the `.yyp` carry no IDs.
- This is a third-party reverse-engineering note, not GameMaker's own spec.
- Documented pain, from that source:
  - structure changes "may be reflected by a change to either, both, or none of the `resourceType` and `resourceVersion` fields";
  - the tool authors say it is "not clear if there is always a way to determine for sure what the structure is supposed to be";
  - their strategy is sparse edits and falling back to older versions "since GameMaker is likely to be able to convert them on load";
  - one change in 2022.8 removed two fields from `sprite.yy#/sequence` with no version bump.
- Identity: resources are located by path in the `.yyp` (`objects/object/object.yy`). Folders are virtual (a `parent` field), not on disk. GUIDs are used for frames and layers.
- Same-extension evolution: older `.yy` files used a `modelName`/`mvc` shape.
  - See the search snippet of https://github.com/oKatanaaa/HLD-GameMaker/blob/master/HyperLightDrifter_GM_copy.yyp (`"modelName": "GMProject", "mvc": "1.0"`).
  - I did not fetch a document stating that 2.3 reused `.yy` for the incompatible format; the same extension with a different shape is inferred from the two sources.

### Defold
- Per-kind custom extensions: `.collection`, `.go`, `.gui`, `.atlas`, `.tilemap` and others. Scripts split into `*.script`, `*.gui_script`, `*.render_script`, `*.editor_script`, `*.lua`.
  - Read: https://www.defold.com/manuals/unity (lines ~805–830).
- "Most Defold resources are stored as text, which is version-control friendly".
- The syntax is protobuf text format. The `.proto` files live in the repo and the SDK zip.
  - Read: https://forum.defold.com/t/whats-the-text-format-used-to-serialize-collections/72707 — an engine dev's answer to a user who had "no idea what is the text format".
  - So a custom extension with a non-obvious syntax leaves outsiders guessing.
- Identity is path; there are no meta files. "Defold has no meta files. The project in Defold is just your folder structure".
  - Read: same Unity-comparison page.
- Rename handling: "Automatic refactoring will only work if changes are made from within the editor. If you rename or move a file outside the editor any references to this file will not get automatically changed".
  - Read: https://defold.com/manuals/refactoring

### Stride
- One unique custom extension per asset kind, `.sd*`, all YAML: `.sdtex`, `.sdmat`, `.sdm3d`, `.sdsheet`, `.sdscene`, `.sdprefab`.
  - Read: https://raw.githubusercontent.com/stride3d/stride/master/docs/asset-system/asset-class.md
  - Extensions are registered with `[AssetDescription(".sdXXX")]`, case-insensitive and "must be globally unique across the engine".
  - Multiple extensions per kind are allowed: `".sdm3d;pdxm3d"`. The doc does not explain the `pdx` legacy alias.
- Versioning is explicit in the content. `[AssetFormatVersion(...)]` plus `[AssetUpgrader(...)]` classes migrate the YAML node.
- Same page: the kind name is a `[DataContract("Name")]` that "must be unique across all assets".
- This is the closest analogue to a "contract + version stamp with upgraders" model, but with an extension per kind.

### Ren'Py (scripts, but relevant to sibling same-stem files)
- `.rpy` source files are compiled to `.rpyc` next to them.
  - Read: https://raw.githubusercontent.com/renpy/renpy/master/sphinx/source/language_basics.rst (grep).
  - "if a `.rpyc` file exists without a corresponding `.rpy` file, the `.rpyc` file will be used. This can lead to problems if a `.rpy` file is deleted, or renamed, or moved, without deleting the `.rpyc` file: the script it contains will still get executed."
- Relevance: a legacy file and a native file with the same stem in the same folder, where the loader silently prefers whichever it finds.

### Cocos Creator
- `.meta` per asset with the UUID and import config.
  - Read: https://docs.cocos.com/creator/3.4/manual/en/asset/asset-workflow.html (grep) — "All asset files will generate a `.meta` configuration file with the same name… provides the unique identification (UUID)".
  - Moves/renames outside the editor require moving the `.meta` too; copying an asset without its `.meta` makes it "a new asset".
  - Also shown: `db://assets/prefabs/fire.prefab` is the path-style reference; the UUID is the stable one.

### O3DE
- Many per-kind custom extensions, each with a builder: `.prefab`, `.material`, `.materialtype`, `.azasset`, `.shader`, `.scriptcanvas`, `.uicanvas`, `.animgraph` and others.
  - Read: https://docs.o3de.org/docs/user-guide/assets/asset-types — the source-asset table, which maps extension → builder → product.
- It also has a generic fallback: anything matching an `.xml` regex goes to a generic XML builder.
- I did not verify the on-disk syntax of `.prefab`/`.material` (see UNVERIFIED).

### Flax
- Two classes: binary `.flax` and JSON assets with ".json / .scene / etc.".
  - Read: https://docs.flaxengine.com/manual/scripting/tutorials/custom-asset.html (grep).
- User-defined JSON data assets use plain `.json`; the type is picked at creation ("New → Json Asset… pick the type").
- The kind of a plain `.json` asset is therefore stored in content, and editor tooling is added per asset type via proxies.

### Construct 3
- Folder-based project: `project.c3proj` plus per-kind subfolders (layouts, families and others).
  - Read: only a search-result snippet of https://www.construct.net/en/tutorials/constructs-project-format-3275 (the page itself returned HTTP 403 Cloudflare).
  - Kind comes from folder, not extension. I could not verify more.

### Tooling datapoint: YAML schema association (not a game engine)
- yaml-language-server associates schemas by: a `# yaml-language-server: $schema=…` modeline, a top-level `$schema` property, the `yaml.schemas` setting (glob patterns), a SchemaStore catalog, or a custom provider.
  - Read: https://raw.githubusercontent.com/redhat-developer/yaml-language-server/main/README.md (grep).
- A custom stamp such as `contract:` + `version:` is not listed as a way of selecting a schema (inference: not found in the README sections I grepped).
  - Zero-config association is therefore by glob, such as `*.clip.yaml` or a folder.
  - The alternative is a modeline or `$schema` line written into every document.

---

## 2. Evidence specifically requested

### (a) Double extensions with a kind marker in practice
- **Shipped:** Bevy `scn.ron` and the `bevy_common_assets` `level.json` convention, with loader lookup by full extension then secondary extensions (loaders.rs above).
- **Community convention:** Godot `.mat.tres`/`.mesh.tres` (#4668 comments).
- **Proposed only:** Godot `.kind.tres` (#4668, open); `.compute.glsl` (a contributor's prototype in discussion 10880, merge status not checked).
- **No first-party engine I read ships it as its main scheme for its own kinds.**
  - Godot, Unity, Stride, Tiled, LDtk, Defold and O3DE use single custom extensions.
  - GameMaker and Flax use one generic extension.
- **Cost seen:** Tiled fixed a multi-dot export bug (#2149). Bevy had to add full-extension and secondary-extension lookup logic.

### (b) Custom per-kind extensions vs a generic text extension
- **Generic ext, kind in content:** Godot `.tres`, Unity `.asset`, GameMaker `.yy`, Flax `.json`.
- **Custom per kind:** Stride `.sd*`, O3DE, Defold, LDtk, Tiled, Unity scene/prefab/material.
- **For per-kind:**
  - Unity merge tooling is keyed by extension, and the generic `.asset`/`.mat` are excluded by default.
  - Godot #4668 motivations: kind at a glance, icons.
  - Godot #2488 (generic `.shader` confuses tools).
- **Against per-kind:**
  - Tools do not know a custom ext is YAML/JSON until configured (#2488 lists this as the downside).
  - Defold users cannot guess the syntax.
  - Stride needs a global registry of unique extensions.
  - GameMaker needed `linguist-generated` because a custom extension was identified as "the wrong language".
- **For generic + content kind:** files stay self-describing when copy-pasted (Godot's UID article argues this for scripts/shaders). One loader. No extension registry.
- **Against generic + content kind:**
  - Godot #4668 and the `.uid`/`.tres` stem confusion list in discussion 11574.
  - Unity `.asset` kind is only a GUID reference to a script.
  - GameMaker's per-subresource type/version fields became ambiguous for tool authors.

### (c) Collisions with older or binary formats
- Godot `.shader` vs Quake 3 shaders and GLSL tooling → `.gdshader` (#2488).
- Godot keeps binary and text formats on separate extensions (`.scn`/`.tscn`, `.res`/`.tres`) and the loader is chosen by extension.
- Unity reuses `.unity`/`.prefab` for both forms and relies on content.
- Ren'Py `.rpy`/`.rpyc`: the stale compiled sibling wins.
- RPG Maker changed extension at each format generation (third-party description).
- Not found: a documented extension collision between a native format and a legacy format that coexisted in the same project folder (the situation we are in). I did not find a close analogue.

### (d) Text formats that kept the same extension as an earlier format
- Godot 3→4 `.tscn`/`.tres`:
  - the `format=2`→`format=3` header;
  - a project converter with size limits;
  - ArrayMesh `.res`/`.tres` incompatible and needing re-import.
- GameMaker `.yy` 2.2→2.3→2022: tool authors (Stitch) cannot reliably tell the structure per IDE version and rely on GameMaker auto-fixing on load.
- Unity text/binary under one extension.
- What went right in all three: a version/format field in content plus a loader or converter.
- What went wrong:
  - ambiguity for third-party tools;
  - per-nested-object versioning drifting (GameMaker);
  - size-limited converters.

---

## 3. Option comparison

| Option | Evidence for | Evidence against |
|---|---|---|
| **(1) `name.<kind>.yaml`** | Bevy ships `scn.ron` and the `*.level.json` convention, with first-class full-extension lookup. Godot community already uses `.mat.tres`; #4668 describes the benefits (kind at a glance, icon selection without reading the header). The final `.yaml` keeps generic YAML tooling working; `.compute.glsl` was chosen for this reason (discussion 10880). yaml-language-server schema association by glob works with no per-file text. Godot's `.uid` article notes same-stem files of different kinds already collide, and the kind segment prevents that. No collision with legacy `.anm/.brd/.tem/.itm/.ene` by construction. | No first-party engine I read uses it as its primary scheme. Godot's #4668 is still open and not adopted. Godot maintainers prefer short extensions (#3255). Multi-dot names need careful `extension()` handling (Bevy's secondary-extension lookup, Tiled #2149 multi-dot export bug). The ID/path gets longer. Kind is duplicated in the filename and the stamp, so they can disagree. |
| **(2) plain `.yaml`, kind from folder + stamp** | Self-describing files with one loader: Godot `.tres` (`type=` in header), Unity `.asset`, GameMaker `.yy` (`resourceType`), Flax `.json`. Godot's UID article prefers files that survive copy-paste with no external metadata. No registry and no collision with legacy extensions. | Generic extension is the pattern Godot reversed for shaders (#2488). Unity's smart merge skips generic `.asset`/`.mat`. Godot #4668 lists the cost of header-only kind (slow icon, unclear at a glance). Kind-by-folder fails when a file moves; RPG Maker's hard-coded filenames do not scale to user kinds. GameMaker shows in-content type/version fields drifting. Zero-config schema association is lost: yaml-language-server needs globs or a modeline in every file. Same-stem files of different kinds in one folder are only distinguished by content. |
| **(3) custom per-kind extensions (legacy `.anm`-style or new ones)** | Most common among engines (Stride, O3DE, Defold, LDtk, Tiled, Unity, Godot). Tooling hooks key on extension (Unity merge, Tiled file associations/UTIs, O3DE builders). Stride shows YAML-per-kind with a version attribute and upgraders. | Needs a registry and global uniqueness (Stride). Generic editors do not know the syntax without configuration (#2488 downside, Defold forum thread). GitHub misclassification (GameMaker `.yy`). **Reusing legacy extensions** (`.anm` etc.) for YAML: Godot, Unity and GameMaker all kept an extension across a format change and ended up needing content sniffing, a `format=` header and converters. Ren'Py shows loaders silently preferring a stale sibling. RPG Maker changed extension when format changed (third-party description). A new custom extension per kind avoids this but adds a registry. |

---

## 4. What this suggests for us

The evidence does not say which scheme wins. It does narrow the choices.

1. **Reusing legacy extensions for native YAML (option 3 with `.anm` etc.) has no good precedent.**
   - Every case I found that kept an extension across a format change needed a version/format header, a converter, or content sniffing.
   - The tools that changed format cleanly tended to change the extension (Godot `.shader`→`.gdshader`; the RPG Maker description) or kept text and binary on separate extensions (Godot).
   - Since legacy and native files will coexist in the same folders, a distinct native extension looks safer than sharing.
2. **Plain `.yaml` (option 2) is common among engines but the evidence against pure content-only kind is real.**
   - The strongest engine-side complaints I found (Godot #4668 motivations, #2488, Unity's merge exclusions) are about generic extensions making tools and humans less able to tell kinds apart.
   - Our docs are always YAML, so editor schema association is the main practical lever. Globs (e.g. `*.clip.yaml`) give it for free; plain `.yaml` needs per-folder globs or a modeline.
3. **Option 1 has the best fit on the points that matter to us, but the thinnest first-party track record.**
   - Bevy is the only shipped example of full-extension lookup (`scn.ron`, `level.json`).
   - Godot's version is only a community convention plus an open proposal.
   - The fit comes from keeping a standard final extension, getting glob-based tooling, and having no collision with legacy extensions.
   - The risk is multi-dot handling in our own tooling and in third-party tools.
4. **Identity, which is a separate question from the extension, is where engines report the most pain.**
   - Path-only identity (Defold, Bevy, Ren'Py, RPG Maker) breaks on out-of-editor renames.
   - Sidecar GUIDs (Unity, Cocos, Godot `.uid`/`.import`) cause lost-sidecar breakage and user backlash.
   - Godot's partial answer was an embedded UID in the header of text resources.
   - Since our ID is the path, any scheme that puts the kind in the filename makes the kind part of the ID. Changing a document's kind then means renaming it and rewriting references. I did not find evidence on whether that matters in practice.
5. **Uncertainty.**
   - Most of the evidence is from 3D/general engines, not RPG-maker-style tools. The one RPG-maker data point (RPG Maker MZ) is a hard-coded-filename design that does not generalise to user-defined kinds.
   - I did not find a project that mixes a legacy binary format and a native text format in the same folders; that part of our situation is extrapolated.
   - Several points are third-party descriptions or search snippets (see below).
   - Treat the table as a map of trade-offs, not a ranking.

---

## 5. UNVERIFIED / not verified

- **Construct 3 project layout:** only a search snippet; the page returned HTTP 403.
- **Cocos Creator** scene/prefab file syntax (JSON) and extension scheme beyond `.meta`/UUID: not read. Only the `.meta` workflow page was fetched.
- **O3DE** on-disk syntax of `.prefab`/`.material` (I believe JSON): not fetched. Only the extension→builder table was read.
- **Unity**:
  - the exact names of the non-default Asset Serialization Mode options (the doc grep was truncated);
  - that text and binary share the same extension is implied by the doc wording, not stated;
  - the `%YAML`/`%TAG` header lines of text files: not read.
- **Godot**:
  - whether `.kind.tres` (#4668), `.compute.glsl` (discussion 10880), or #4668's PR #61539 were ever merged or adopted: not checked;
  - the contents of the binary `.scn`/`.res` headers: not read.
- **Tiled**: why `.tmj/.tsj/.tj` were added (rationale): NEWS only records the addition. Also not verified: `"type":"tileset"` on JSON tilesets (the Tileset section exists in the doc; the `type` string was not confirmed).
- **GameMaker**:
  - the claim that 2.3 reused `.yy` for an incompatible shape is inferred from the bscotch note plus the HLD `.yyp` snippet;
  - nothing from GameMaker's own migration docs was read;
  - the manual's "Project Load Failure"/Project Tool section was not read.
- **RPG Maker**:
  - no Kadokawa/Gotcha Gotcha docs were fetched; the MZ filenames come from a community mirror of the corescript;
  - the `.rvdata2`→`.json` history comes from a third-party README snippet.
- **Bevy** `#9714` canonical-ID discussion: search snippet only. How #367 and #2680 were resolved: not read.
- **Defold** full extension list and how the editor tells kinds apart beyond "context-sensitive editors by file type": only partially read.
- **Windows/OS file-association behaviour with double extensions** (only the last segment is used): not researched; general knowledge only.
- **Unreal Engine** (`.uasset`/`.umap` binary): not covered.
