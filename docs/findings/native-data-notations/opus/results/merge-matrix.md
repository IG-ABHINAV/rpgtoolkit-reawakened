# Merge outcomes (corrected run, full-document oracles)

Legend (outcome of a real `git merge`, judged against the whole permitted document):
- **C**: clean merge, and the merged document equals the expected document exactly.
- **X**: Git reported a conflict where the edits are semantically incompatible (expected).
- **O**: Git reported a conflict for two additions at the same position, where order is ambiguous (acceptable).
- **s**: spurious conflict. The edits were semantically independent, but the layout put them on adjacent lines.
- **D**: Git merged **cleanly** but the result holds a duplicate identity (same-ID additions at disjoint positions). This is a textual false clean; `check.mjs` reports it as `duplicate-id`.
- **F**: false clean, silent overwrite or unparseable result (failure).
- **!**: no Git outcome. The scripted raw-hunk replay (`patch`) could not apply onto the commented file, a limitation of the simulation.
- **-**: no Git outcome. The path is not applicable (no format-preserving editor library, or no comments in the notation).

## reemit

| scenario | yaml | json | json-layout | json5 | json5-layout | hjson | toml | toml-rows | kdl | edn | edn-oneline | ron | ron-compact | xml |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| independent-far | C | C | C | C | C | C | C | C | C | C | s | C | C | C |
| adjacent-elements | C | C | C | C | C | C | C | C | C | C | s | C | C | C |
| same-element-other-field | C | C | C | C | C | s | s | s | s | C | s | C | C | C |
| same-field-incompatible | X | X | X | X | X | X | X | X | X | X | X | X | X | X |
| same-field-identical | C | C | C | C | C | C | C | C | C | C | C | C | C | C |
| edit-vs-delete | X | X | X | X | X | X | X | X | X | X | X | X | X | X |
| both-append | O | O | O | O | O | O | O | O | O | O | O | O | O | O |
| insert-vs-edit-other | C | C | C | C | C | C | C | C | C | C | s | C | C | C |
| delete-vs-edit-other | C | C | C | C | C | C | C | C | C | C | s | C | C | C |
| reorder-vs-edit | C | C | C | C | C | C | C | C | C | C | s | C | C | C |
| reorder-incompatible | X | X | X | X | X | X | X | X | X | X | X | X | X | X |
| clip-reorder-vs-frame-edit | C | C | C | C | C | C | C | C | C | C | s | C | C | C |
| clip-insert-same-position | O | O | O | O | O | O | O | O | O | O | O | O | O | O |
| clip-delete-adjacent | s | s | s | s | s | s | s | s | s | s | s | s | s | s |
| tiles-different-rows | C | C | C | C | C | C | s | C | C | C | s | C | s | C |
| tiles-same-row-different-cells | s | C | s | C | s | C | s | s | s | s | s | C | s | s |
| tiles-same-cell | X | X | X | X | X | X | X | X | X | X | X | X | X | X |
| same-id-disjoint-placements | D | D | D | D | D | D | D | D | D | D | X | D | D | D |
| same-id-disjoint-frames | D | D | D | D | D | D | D | D | D | D | X | D | D | D |

## preserve

| scenario | yaml | json | json-layout | json5 | json5-layout | hjson | toml | toml-rows | kdl | edn | edn-oneline | ron | ron-compact | xml |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| independent-far | C | C | C | - | - | C | C | C | C | - | - | - | - | C |
| adjacent-elements | C | C | C | - | - | C | C | C | C | - | - | - | - | C |
| same-element-other-field | C | C | C | - | - | s | s | s | s | - | - | - | - | C |
| same-field-incompatible | X | X | X | - | - | X | X | X | X | - | - | - | - | X |
| same-field-identical | C | C | C | - | - | C | C | C | C | - | - | - | - | C |
| edit-vs-delete | X | X | X | - | - | X | X | X | X | - | - | - | - | X |
| both-append | O | O | O | - | - | O | O | O | O | - | - | - | - | O |
| insert-vs-edit-other | C | C | C | - | - | C | C | C | C | - | - | - | - | C |
| delete-vs-edit-other | C | C | C | - | - | C | C | C | C | - | - | - | - | C |
| reorder-vs-edit | C | C | C | - | - | C | C | C | C | - | - | - | - | C |
| reorder-incompatible | X | X | X | - | - | X | X | X | X | - | - | - | - | X |
| clip-reorder-vs-frame-edit | C | C | C | - | - | C | C | C | C | - | - | - | - | C |
| clip-insert-same-position | O | O | O | - | - | O | O | O | O | - | - | - | - | O |
| clip-delete-adjacent | s | s | s | - | - | s | s | s | s | - | - | - | - | s |
| tiles-different-rows | C | C | C | - | - | C | s | C | C | - | - | - | - | C |
| tiles-same-row-different-cells | s | C | s | - | - | C | s | s | s | - | - | - | - | s |
| tiles-same-cell | X | X | X | - | - | X | X | X | X | - | - | - | - | X |
| same-id-disjoint-placements | D | D | D | - | - | D | D | D | D | - | - | - | - | D |
| same-id-disjoint-frames | D | D | D | - | - | D | D | D | D | - | - | - | - | D |

## raw

| scenario | yaml | json | json-layout | json5 | json5-layout | hjson | toml | toml-rows | kdl | edn | edn-oneline | ron | ron-compact | xml |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| independent-far | C | - | - | C | C | C | C | C | C | C | s | C | C | C |
| adjacent-elements | C | - | - | C | C | C | C | C | C | C | s | C | C | C |
| same-element-other-field | C | - | - | C | C | s | s | s | s | C | s | C | C | C |
| same-field-incompatible | X | - | - | X | X | X | X | X | X | X | X | X | X | X |
| same-field-identical | C | - | - | C | C | C | C | C | C | C | C | C | C | C |
| edit-vs-delete | X | - | - | X | X | X | X | X | X | X | X | X | X | X |
| both-append | O | - | - | O | O | O | O | O | O | O | O | O | O | O |
| insert-vs-edit-other | C | - | - | C | C | C | C | C | C | C | s | C | C | C |
| delete-vs-edit-other | ! | - | - | ! | ! | ! | ! | ! | ! | ! | s | ! | ! | ! |
| reorder-vs-edit | ! | - | - | C | ! | ! | ! | ! | ! | ! | s | C | ! | ! |
| reorder-incompatible | ! | - | - | X | ! | ! | ! | ! | ! | ! | X | X | ! | ! |
| clip-reorder-vs-frame-edit | ! | - | - | C | C | C | C | C | C | C | s | C | ! | C |
| clip-insert-same-position | O | - | - | O | O | O | O | O | O | O | O | O | O | O |
| clip-delete-adjacent | ! | - | - | s | s | s | s | s | s | s | s | s | s | s |
| tiles-different-rows | C | - | - | C | C | C | s | C | C | C | s | C | s | C |
| tiles-same-row-different-cells | s | - | - | C | s | C | s | s | s | s | s | C | s | s |
| tiles-same-cell | X | - | - | X | X | X | X | X | X | X | X | X | X | X |
| same-id-disjoint-placements | ! | - | - | ! | ! | ! | ! | ! | ! | ! | X | ! | ! | ! |
| same-id-disjoint-frames | D | - | - | D | D | D | D | D | D | D | X | D | D | D |

Totals across paths: {"C":260,"s":91,"X":131,"O":68,"D":53,"-":152,"!":43}
