# Independent review record

Four reviewers, none of them an author, each examined **both** reports and their
experiment code. Each reviewer was told to reproduce claims rather than to agree, and
none saw another reviewer's findings or any integration opinion before submitting.
The authors did not review each other; that requirement came from the owner during
the investigation and superseded the ticket's original wording.

The purpose of this page is not to rank the reports. It records what an independent
review actually changed, so a later reader can tell which numbers survived scrutiny
and which did not.

## How it ran

| Reviewer | Lens | Scope |
|---|---|---|
| Adversarial | Methodology and overclaiming | Both reports, both adapter sets, primary documentation |
| Edge-case hunter | Behaviour under awkward input | Both experiment implementations, reproducing cases |
| Verification gap | Whether experiments could detect wrong answers | Both implementations and their claimed evidence |
| Editorial structure | Whether the evidence is navigable | Both report trees |

Reviewers ran in scratch copies and did not edit the reports, commit, or mutate
issues. Where a reviewer claimed a defect, the claim had to come with a reproducer;
the reproducers were kept and each filed issue points at one.

## What review found, by consequence

### Findings that changed a conclusion

| Finding | Effect |
|---|---|
| Both merge oracles classified results from added IDs and list length rather than the whole document | A corrupted document could be scored as preserved. Both oracles were rewritten to compare complete permitted results, and every merge experiment was re-run. |
| Duplicate identities from textually clean merges were not tested at all | The scenario was added; it produced clean duplicates in every notation. This became one of the investigation's main conclusions. |
| Astra's rename check skipped a declared actor performance binding | A stale reference passed validation. Corrected, and the reviewer's own reproducer is now a regression case. |
| Opus's TOML null mapping was not injective | A genuine plugin object shaped like the null marker decoded as `null`, corrupting content the report claimed to preserve. Mapping escaped; round-trip case added. |
| Opus's JSON "no-op" path never parsed the document | Byte equality was being credited to a document lifecycle that had not run; invalid text passed unchanged. Replaced with a real parse-and-save. |
| Opus's browser parity probe compared hashes without asserting semantics | An accept-everything schema passed every step. Now each step asserts positive and negative results before hosts are compared, and the current bundle was re-run in Chrome. |
| Opus's report paired whole-project byte totals with one document's line counts | A scene's authoring footprint was overstated by roughly 40×. Sizes are now reported per artifact. |
| Opus's HOCON working-directory claim | The probe had opened the wrong root file. The claim was withdrawn; the same absolute root resolves identically from four working directories. |
| Both XML writers left attribute whitespace to be normalised by parsers | Invisible to a same-library round trip, visible to a conforming parser. Both now emit numeric character references and are verified against an independent parser. |

### Findings that changed the tooling without changing a conclusion

Missing scene-sibling handling on rename, rename overwriting an existing target,
incomplete reference traversal (combat stances and `progression.onLevelUp`), EDN
printer keys that were not reversible, XML `__proto__` handling, XML-forbidden
characters, KDL insertion and move defects, permissive XML boolean decoding,
confused stored-versus-normalised board versions, and malformed-input acceptance in
`edn-data` that the reviewer confirmed is the library's behaviour rather than the
probe's.

### Where the reviewers disagreed with each other

Not on the defects: every defect one reviewer reported was reproduced by the owning
investigator before it was fixed. They differed on emphasis, which is worth knowing:

- The verification-gap reviewer treated the weak oracles as casting doubt on the
  strength of the *comparison*; the adversarial reviewer reached the same defects
  but judged them adapter bugs rather than evidence against any notation. The second
  reading is the one the evidence supports: every defect was in project-owned research
  code, and none was a limitation of the notation itself.
- The structure reviewer's recommendations were editorial — move the recommendations
  above the method, split one wide table, define the symbols used in a merge matrix.
  These were adopted where they were factual corrections (measurement scopes, an
  incomplete reproduce section) and left as suggestions where they were taste.

### What review did not do

- It did not re-run the investigators' whole suites; it reproduced representative
  cases and inspected the recorded results.
- It did not attempt human usability testing, which nobody has done.
- It did not review the shared-model comparison, because that work started after
  these reviews were commissioned. Its harness therefore carries its own in-line
  semantic assertions and was validated by deliberately breaking adapters during
  development — but it has not had independent review, and should be treated as the
  newest evidence here.

## Consequences in the reports

Both reports keep their independent first-pass text and add a correction record
([Astra](astra/review-corrections.md), [Opus](opus/CORRECTIONS.md)) that states, per
issue, the defect, the fix and the proof. First-pass numbers that no longer match the
re-run results were **not** silently rewritten; the correction record takes
precedence, and this is stated at the top of each report.

Every reviewed defect was filed before it was fixed. The list is in the
[integrated report](README.md#filed-defects).
