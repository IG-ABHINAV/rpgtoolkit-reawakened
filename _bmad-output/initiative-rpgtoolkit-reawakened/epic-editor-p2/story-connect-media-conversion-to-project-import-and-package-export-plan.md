---
type: story
title: "Connect media conversion to project import and package export"
ticket: 14
status: draft
risk: high
---

## Scope

Own the shared import/export integration changes after both converter providers. Show the files, conversions, expected size changes and recovery destination before committing; use the ruled staging and report contract. Project import and packaging consume the same converters rather than implementing new ones. Preserve source names and script/data references; do not silently alter the source project while exporting a package.

Exclude recovery originals and tool reports from runtime assets according to the approved inventory contract. Repeated exports must not repeatedly transcode already-supported bytes. Offer accessible progress/cancel/error recovery and explicit capability limitations in each host; no fake browser conversion path.

Own the remaining `audio-media.md#audio-authoring-handoff` packaging work: bundle the authored game SoundFont selected in `audioSettings.defaultSoundFont`, inspect `ICOP`/`ICMT` and warn without blocking creator export when licence information is absent or unclear. Share this warning with 11.6 game settings. Never include the legacy toolkit MIDI pack in templates, repository assets or installers; this creator warning does not waive G6 for dependencies or assets we distribute.

## Acceptance and verification

Import and package an authored miniature game referring to compressed audio and legacy video. Boot the exact resulting package and observe real audio and cutscene playback using those names. Verify repeated export, cancellation, tool failure and stale document conflicts preserve the original project; check reports and ensure recovery files are absent from the package. Include this journey in 14.10 acceptance.

With a tiny authored SoundFont, verify exact bank bytes in the package and actual game selection on boot. Cover present, absent and unclear licence metadata; the latter cases show a warning but still export. Inspect template/installer/package inventories for the excluded legacy MIDI pack and recovery files.

## Prerequisites

14.12, 14.13, 11.4, 11.6 and 12.9. Follow the 14.11 approved import/packaging contract, G1–G7, AD-18/19 and shared platform-services; no unreviewed dependency choice.
