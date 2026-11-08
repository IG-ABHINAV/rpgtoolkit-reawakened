# Epic 14 inception proposal

## Scope and source reconciliation

CAP-17 requires beginner visual events, skin, audio audition, setup and tutorials; the envelope adds save/reopen, installable delivery and a first-board tutorial in both hosts. The dated empty-envelope audit is historical: issue #1360 now exists. T-80 is audition rather than audio editing, so the envelope's audio-save wording cannot imply modifying source audio. This breakdown assigns the owner's requested visual fixture/action authoring here, with executable test interfaces in 11.9; no visual dependency blocks code tests. T-81 remains excluded.

## Coverage and proof

| Requirement | Entries | Evidence to produce |
|---|---|---|
| CAP-17 / T-45 visual RPGCode | 1–3, 10 | Source authority and screen-layout ruling, generated program and placements executed, unsupported source preserved |
| CAP-17 / T-64 skins | 1, 4, 10 | Named persistence/preview contract first; legacy `.gam` skin fields are ignored by engine, not a presumed runtime consumer |
| CAP-17 / T-80 audio | 5, 10 | Actual supported audio audition via shared synth, no source mutation |
| CAP-17 / T-72 setup | 1, 6, 10 | 12.9 package into ruled setup, clean recipient install/run/uninstall |
| CAP-17 / T-09 teaching | 8, 10 | Tip-of-day and nine-step first-board tutorial in browser and VS Code, using contextual manual and quick reference from 11.11 |
| Connected tests (owner direction) | 1, 7, 10 | Version-controlled tiny real-engine fixtures, actions and assertions through 11.9 |
| Epic 6 audio/video import handoff | 11–14, 10 | Owner-approved format/licence/host contract; real audio/video conversion at project import and package export with original recovery and name preservation |

The first runnable proof is 14.2: create a supported message action, save the actual RPGCode, receive clean LSP diagnostics and run it in both hosts. 14.1 precedes it because a code/visual authority ruling is essential; it is a documentation/owner decision, not a claimed implementation.

## Lanes, dependencies and open decisions

| Lane | Entries | Providers and gates |
|---|---|---|
| Shared source and test contracts | 1 | 11.1; owner resolves source/layout authority, skin persistence and preview semantics, nonrepresentable text and fixture mapping, plus installer targets; no arbitrary roundtrip |
| Visual events | 2 → 3 | 11.2, 11.3, 11.7, 11.8 and 11.4; includes T-45 screen-layout canvas, Monaco in browser/standalone and native VS Code text |
| Skin | 4 | 1, 11.3 and 11.4; explicit persistence/preview ruling before shared document/picker integration |
| Audio | 5 | 6.5 WAV/MIDI metadata, 6.15 protocol, 9.5 cue player/web audio, 9.6 bank resolution, 11.1, 11.4 and 11.6 project SoundFont; host audio/autoplay capability |
| Setup | 6 | 1 and 12.9; signing credentials and supported native install targets need human verification, browser must disclose unsupported operations |
| Visual test fixtures | 7 | 1, 11.9 and 12.1; real engine, fresh isolated state, bounded ticks, failure diagnostics and distribution exclusion |
| Tutorial | 8 | 11.4, 11.8, 11.10, 11.11, 12.3 and 12.10; nine concrete steps from project/board creation through start placement and scoped runs, independent of visual events |
| Media import | 11 → 12/13 → 14 | 11.1, 6.3 policy and 9.3 video-profile probe; HITL approval first; 11.3 lifecycle, 6.5 metadata, 9.5 real PCM playback, 9.6 VideoHost; integration consumes 11.4/11.6 and 12.9, including authored bank bundling, nonblocking ICOP/ICMT warnings and legacy MIDI-pack exclusion |
| Closure | 9 → 10 | 9 follows entries 1–8 and 11–14; 10 verifies integrated acceptance, including media-bearing package playback |

Lanes may proceed independently only within their own feature modules after the 11.1 shared integration/registration contract; avoid concurrent edits to shared registration or configuration by sequencing them through the owning integration story. All host operations use platform-services, document edits follow AD-18/19 and one URI identity, shared visual views do not silently alter a running game, and G1–G7 remain binding. Source code inspection confirms `packages/script-spec/src/runner.ts` has a fresh fixture runner but does not establish the proposed movement/action API; 11.9 must deliver and prove that API before 14.7 consumes it. `packages/synth/src` contains existing cue-player and source implementations; reuse these rather than a new engine.

The Epic 6 MP3/OGG and AVI import handoff belongs to 14.11–14.14, not audition. The existing audio-media page still labels its import rulings pending owner review: 14.11 resolves that status and G6/tool/host evidence before implementation, including the listed Opus/FLAC and MPG/MOV inputs. No codec is silently added to the runtime. If evidence requires a scope change, the owner must approve it and update the affected stories explicitly; missing evidence blocks work rather than granting a silent deferral.

The interaction design remains a proposal, not proof of installed providers or usability. No installer target, storage format, signer, arbitrary code conversion or browser OS capability is silently approved by this breakdown.

## Independent review

P2 and tree reviews passed after restoring screen-layout coverage, skin-contract and tutorial gates, allocating media import and SoundFont packaging, and pinning actual audio/video playback. See the [validation record](../../ux-connected-editors/editor-delivery-plan.md#validation-and-publication-record); unresolved owner choices still block their consumers.
