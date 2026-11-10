# Native animation clip examples

Authored examples of the native animation clip at contract version `1.0.0-pre.1`, written in YAML, the authored notation the owner accepted in [research #1799](../../../../findings/native-data-notations/README.md). Each file has the extension `.tkranm`, the one the [registry](../../../formats/native-contracts.md#the-registry) holds for the animation clip ([file names](../../../formats/native-contracts.md#file-names)); the content is YAML whatever the extension. The contract is [native-animation-clip.md](../../../formats/native-animation-clip.md) and the schema is [tkr-animation-clip.schema.json](../../../schemas/tkr-animation-clip.schema.json).

**What they are not.** They are not legacy files: the dump tool does not read this folder (`native` is in the `ignore` list of [golden/spec-examples.json](../../../../../golden/spec-examples.json)). They do not decide the layout of a document on lines or any YAML profile rule; they show one plausible authored layout. The asset paths (`bitmap/...`, `media/...`, `tiles/...`) are illustrative, because the project folder names are still open ([open items](../../../formats/native-animation-clip.md#open-items)). No file here names a real asset.

**Plugin blocks.** The contract admits one optional key, `pluginData` ([plugin blocks](../../../formats/native-contracts.md#plugin-blocks)), and none of the files below uses it. These files are test data that `packages/native-data/test/clip.test.ts` reads through the reference reader, which still refuses `pluginData` as an unknown key, so a document with a block is added here by story 27.10 ([#1822](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1822)) in the same change as the reader. The worked examples in [native-contracts.md](../../../formats/native-contracts.md#a-worked-example) and [native-animation-clip.md](../../../formats/native-animation-clip.md#a-clip-at-a-glance) were checked against the schema.

## Valid

| File | What it shows |
|---|---|
| [valid/walk-south-imported.tkranm](valid/walk-south-imported.tkranm) | The example game's two-frame south walk ([the legacy listing](../../listings/hero_walk_s.anm.txt)) as a native clip: tile-reference frames, one clip-level colour key, the `imported` tag and a `source` in `metadata`. The 49 empty legacy slots are not listed. |
| [valid/sword-swing.tkranm](valid/sword-swing.tkranm) | An authored clip with image files, a sound on one frame, and one frame that gives its own colour key. Comments are part of the document. |
| [valid/torch-minimal.tkranm](valid/torch-minimal.tkranm) | The smallest clip: the stamp, the canvas, the delay and one frame. No tags, no metadata, no colour key and no sound. |

## Invalid

Each file has one defect, named in a comment inside it. The failure column is what the schema reports, as an Ajv 8 error: the place in the document, then the message.

| File | The defect | Expected failure |
|---|---|---|
| [invalid/missing-stamp.tkranm](invalid/missing-stamp.tkranm) | No `contract` and no `version`. | `/ must have required property 'contract'` and `/ must have required property 'version'` |
| [invalid/malformed-version.tkranm](invalid/malformed-version.tkranm) | `version: 1.0` is read as the number 1, not as text. | `/version must be string` |
| [invalid/frame-without-image.tkranm](invalid/frame-without-image.tkranm) | The second frame has a `sound` and no `image`. | `/frames/1 must have required property 'image'` |
| [invalid/unknown-key.tkranm](invalid/unknown-key.tkranm) | A key that is not in the contract, `loop`, in the clip. | `/ must NOT have additional properties` (`additionalProperty: loop`) |
| [invalid/unknown-frame-key.tkranm](invalid/unknown-frame-key.tkranm) | A key that is not in the contract, `duration`, in a frame. | `/frames/0 must NOT have additional properties` (`additionalProperty: duration`) |

The same stamp written as text, `version: "1.0"`, is a different failure: it is text, but it does not match the [version form](../../../formats/native-contracts.md#versions) (the patch is missing) and is not `1.0.0-pre.1`, so the schema reports its two `pattern` checks on `/version`.

## How they were checked

Each file was read with the `yaml` package (2.9.1, YAML 1.2 core schema) and validated against the schema with `ajv` 8.20.0 (`ajv/dist/2020`, `strict: true`, `allErrors: true`) on Node v26.13.0; the repository pins 24.21.0. Both packages were installed in a scratch folder outside the repository and the script was not committed, so nothing here adds a dependency. All 3 valid files validate and all 5 invalid files fail with exactly the errors above.

To prove each guard is what rejects its file, the schema was copied, one guard was removed at a time, and the matching invalid file then validated: root `additionalProperties: false` (`unknown-key`), frame `additionalProperties: false` (`unknown-frame-key`), the frame's `required: [image]` (`frame-without-image`), the root `required` stamp keys (`missing-stamp`) and the version's `type: string` (`malformed-version`).

A wider throwaway probe of 50 further documents also behaved as the contract page says (rejections for a `v` prefix, an empty pre-release or build suffix, a leading zero, a wrong contract name, a negative delay, a colour part of 256, an empty frame list, an empty or null `image`, a `null` anywhere in the contract, `colorKey`; acceptance for tags, free `metadata`, a `+build` suffix, a delay of 0 and image names with spaces and capitals), and the ten version strings of the [version table](../../../formats/native-contracts.md#versions) were accepted or rejected as that table says.
