# Advanced Lyrics Studio implementation plan

Date: 2026-10-24. Status: complete. All 36 packages and final regression/performance checks passed.

This extends the completed MVP with the six requested feature areas. The original brief and completed 32-item MVP checklist remain intact. Removed M0.2/M0.3/M0.5 tasks are not restored. This plan adds feature-specific regression checks, not an independent singing-quality or listening-approval project.

## 1. Scope and delivery order

| User request | Priority | Delivery phase | Result |
|---|---|---|---|
| Unified tracks/clips and editing | 1 | A1 | Typed tracks, locking, mute/visibility, ordering, groups, multi-select, ripple delete, clipboard |
| Multiple audio tracks and mixing | 1 | A2 | Simultaneous sources, gain, mute/solo, fades, music/SFX, optional video audio |
| Better lyric synchronization | 1 | A3 | Waveform word handles, selection looping, playback speed, tap timing, preserved corrections |
| Rich text and karaoke templates | 2 | A5 | Imported fonts, reusable presets, animated emphasis/entrances/exits/reveals |
| Keyframe animation | 2 | A4 | Position/rotation/scale/opacity and lyric-property curves with easing |
| Transitions and visual effects | 2 | A6 | Slide/zoom/wipe/blur plus reused dissolve, adjustable correction/filters/masks/background blur |
| Auto-ducking and loudness normalization | Later | A7 | Derived audio analysis/mix with shared preview/export behavior |

Dependency order: A0 → A1 → A2 → A3 → A4 → A5 → A6 → A7. A2 and A3 both depend on A1; deliver them sequentially so alignment-source semantics are settled before the synchronization editor. Keyframes precede animated templates and transitions. Later audio processing can start after A2, but stays outside the first Priority 1 release.

Stop after each phase's runnable checks pass and its documented behavior works in the actual editor/export. Do not build a generic editing SDK, plugin engine, collaboration service, or arbitrary effect graph. Reuse Zod, Zustand, WaveSurfer, Remotion, FFmpeg, and the existing local job/storage architecture. No dependency additions are assumed.

## 2. Verified starting point and affected flows

| Existing location | Current responsibility | Required change |
|---|---|---|
| `packages/project-model/model.ts` | V1 schemas; separate audio/background/lyric arrays | Versioned track/clip contracts, new feature data, invariants |
| `packages/project-model/proof.ts` | Proof fixtures, frame conversion, global first-active-line lookup | Keep proof V1 stable; share time helpers and replace editor-only global lyric lookup |
| `packages/editor-core/commands.ts` | Clone/validate edits, splits, snaps, alignment merge | Track-aware atomic commands, groups, ripple, clipboard, timing provenance |
| `apps/web/store.ts` | Single selection, snapshot history, revision-safe saving | Selected-ID set with primary item, coherent gestures, editor-only playback/clipboard state |
| `apps/web/Timeline.tsx` | Audio row, numbered visual layers, lyric row; WaveSurfer | Unified track rows, controls, multi-select, word lane, curves |
| `apps/web/App.tsx` | Imports, alignment, numeric inspector, Player, styles | Track/source binding UI, mixer, timing tools, fonts/presets/effect inspectors |
| `packages/video-composition/ProofVideo.tsx` | Shared Player/export rendering; layered media/GIF; one lyric at a time | Ordered tracks, simultaneous sound/text, deterministic animations/effects/fonts |
| `apps/api/app.ts` | Import/probe, exact-one-song alignment, snapshot export | Version-aware endpoints, explicit alignment source, font assets, later derived-audio jobs |
| `apps/api/storage.ts` / `jobs.ts` | Atomic JSON, backups, schema guard, durable queue | Migration/recovery compatibility and immutable references to derived assets |
| `tests/*`, `scripts/verify-*.ts`, `scripts/verify-*.mjs` | Unit/API/browser/media regressions | V1/V2 migration fixtures and each new behavior's focused checks |

Visual layers, per-clip opacity, animated GIF seeking, and cross-layer dragging already exist. Migrate them rather than replacing them with a lesser baseline. Audio overlap is currently forbidden, embedded video sound muted, fonts restricted to three choices, and manual timing mostly numeric. Current alignment protects manual lines/fragments, not individually identified word-field overrides.

Existing uncommitted code/docs are prior authorized work. Preserve them. Work in this workspace; no worktrees, commits, pushes, deployment, or public media upload.

## 3. Unified model and migration contract

### One canonical timeline

The unified architecture began at schema 2. The final advanced writer uses schema 3, with explicit schema-1/schema-2 read migration and version-specific permanent backups. Fields were added in their implementation phases. The version-3 guard prevents older writers from recovering obsolete backups and losing advanced data.

| Record | Fields and ownership |
|---|---|
| Project | Existing identity/revision/canvas/duration/assets/style; ordered `tracks`, one `clips` collection, lyric source records |
| Track | Stable ID, name, kind `visual` / `audio` / `lyrics`, locked/muted/visible; array position is the only track order |
| Clip base | Unique ID, owning trackId, integer startMs/durationMs, optional groupId; no duplicate track clip-ID lists |
| Media clip | Audio or visual asset reference, sourceInMs and existing placement/fade/opacity values where applicable |
| Lyric clip | Source-line/occurrence reference, displayed text, relative word timing, style override, correction provenance |
| Lyric source | Original pasted text and stable source-line occurrences, including untimed lines; timed placement belongs to clips |

Use discriminated clip payloads. A visual track accepts image/video/GIF clips, an audio track accepts playable audio sources, and a lyrics track accepts lyric clips. Independent lyric tracks may display simultaneously; keep sequential/nonoverlapping lyric clips within each track. Source headings and repeated occurrences retain identity. Untimed lyrics remain recoverable source entries, not zero-length clips.

Migration defaults are unlocked, visible, and unmuted, with original visual opacity unchanged. New mixer controls default to 0 dB gain and no solo. Mute/solo controls appear only on tracks with audible sources.

Track order runs bottom-to-top for rendering; place migrated lyrics above migrated visuals. Audio rows may reorder in the UI without changing the sound. Preserve visual layer numbers as relative track order. Media/word intervals remain half-open, and every timed clip must span at least one rendered frame. Preserve current two-overlapping-visual-clips-per-track crossfade constraint initially; A2 permits audio overlap.

Global unique clip IDs must accommodate existing lyric IDs such as `line-3`, not assume every old ID is a UUID. Preserve IDs where possible; deterministically remap collisions while retaining source occurrence IDs. New clips/tracks get fresh IDs. Migration-generated track/source IDs must be stable across repeated reads.

### Read, save, recovery, rollback

1. Detect stored schema version before running its validator. Keep strict V1 and V2 validators separate and reject unsupported future versions.
2. Read V1 or V2, validate its supported data, deterministically migrate in memory, and validate schema 3. Reading alone must not rewrite files or revisions.
3. Map the existing audio row, visual layers, and lyric row into tracks. Copy source offsets, transforms, opacity, GIF references, styles, word times, source fragments, review status, untimed source text, and all asset hashes unchanged.
4. On the first explicit/autosave of an edited migrated project, preserve an atomic, version-specific pre-migration JSON backup before replacing the main document. Leave source media untouched. Do not treat migration-on-read as a dirty user edit.
5. Preserve current revision-conflict behavior. A failed migration/save leaves the original JSON readable by the old app. A migrated project keeps an immutable V1 backup even after ordinary `.bak` rotation.
6. Recovery validates the actual backup version and migrates only supported data. Change the storage guard that currently rejects every version above 1. A future-version main file must never silently fall back to older data.
7. Immutable export snapshots are version-dispatched. Do not rewrite historical snapshots in place or mutate an export's asset set while it renders.
8. Rollback requires restoring the preserved version-specific JSON. Advanced edits are not represented as losslessly downgradable. Keep the current schema-3 JSON separately before restoring an earlier copy.

The legacy proof fixtures stay V1 behind an explicit adapter/renderer branch. Do not send V2 projects through `parseProofProject`, whose global lyric-overlap and version assumptions would reject valid tracks.

## 4. Editing behavior

### Tracks and selection

- Lock blocks direct clip/content/timing/keyframe edits, moves, trims, paste, track reordering, and deletion. Track mute/visibility and unlocking remain available. Lock is an editing affordance, not a security boundary. Global style changes still apply unless a clip has an override.
- Visibility controls visual/lyric output; audio-only tracks do not expose a misleading eye control. Muting affects audible content, including opted-in video audio, independently of picture visibility.
- Click selects one clip; Ctrl/Cmd-click toggles membership; Shift-click selects a contiguous range within a track. Add a drag-selection rectangle and keyboard-accessible select/toggle/clear actions. Inspector shows a primary item plus selection count; batch fields appear only for compatible clip types.
- Drag selected clips with one shared delta, preserving relative offsets and group membership. Any locked member or invalid resulting clip rejects the whole command with a clear reason; do not silently omit items. One gesture is one undo step.
- Groups are flat, non-nested clip relationships across tracks. Selecting/moving/deleting a member expands to the group by default; an explicit individual-edit action permits a member-only edit. Ungroup never moves or deletes content.

### Ripple delete

Default scope is the selected tracks, never the entire song. Compute the union of deleted intervals per affected track; delete selected clips and shift later retained clips left by the removed time before them. For example, delete [2s,4s) on a visual track: its clip at 6s moves to 4s while song audio and other tracks stay fixed.

Reject the operation if a retained clip intersects a removed range, a locked item would move, or a cross-track group would receive inconsistent deltas. Users can ordinary-delete, trim, or ungroup first. Do not silently split retained sound or move lyrics out of sync with the song. Collapse overlapping deleted ranges once, not once per clip. Keep project duration unchanged unless the user explicitly changes it. Lyric source text remains available after deleting a placement.

### Copy/paste

Use an internal, versioned in-app clipboard scoped to the current project; browser system clipboard permission is unnecessary. Support cut/copy/paste through buttons and shortcuts outside text inputs. Anchor the earliest selected start to the playhead on paste, preserve offsets/order, regenerate clip/group IDs, and reuse immutable assets. Reject missing/invalid/locked destinations atomically. On switching projects, clear clipboard state or reject its foreign project ID. Cross-project copying/asset transfer is outside this plan's first implementation.

Copied lyrics become independent placement instances with new IDs and protected manual provenance; they must not be overwritten by realigning the original source occurrence. Undo removes pasted placements, not shared media originals.

## 5. Audio and alignment contract

### Priority 1 mixing

Support concurrent audio tracks and overlapping audio clips, including music beds and short SFX. Add per-track and per-clip gain in dB, track/clip mute, track solo, and clip fade-in/out. Initial inspector gain range is −60 to +6 dB; mute is exact silence, not a very small gain. Evaluate `linearGain = 10^(gainDb/20)` and multiply clip gain, track gain, fade envelope, and master gain once each.

Muted sources remain silent even when soloed. When any audible track is soloed, only unmuted soloed tracks feed the master. A visual track participates in audio solo/mute only when a clip's embedded audio is enabled. Video audio defaults off for migrated and newly imported projects; enable it explicitly in the inspector using the same media offsets. Do not play it twice through a separate duplicate source.

Each fade duration must fit inside its clip. When fade regions overlap, use the lower envelope value, matching the existing visual fade rule, rather than multiplying two unintended attenuations. Source gain/fades are independent of preview playback speed.

Use installed Remotion Audio/volume callbacks and browser Web Audio where needed for preview gain above unity. The current Player remains the only playback clock. UI volume meters may use derived analysis, but never start an independent WaveSurfer transport. Test actual preview/encoded gain, trims, overlaps, solo, and fades before considering the path complete. Summed sources can clip; expose measured peak warnings where analysis exists and do not silently normalize or compress the mix.

### Explicit alignment source

Adding a second audio track must no longer disable alignment. Choose a designated song/reference asset and clip for each lyric source; imported music/SFX do not become alignment input accidentally. Initially require that reference clip to contain the whole original source at normal speed. A nonzero timeline start is allowed with an explicit source→timeline offset; edited/split/retimed reference arrangements require a later mapping feature rather than guessed timestamps.

Capture source hash, lyric/token revision, reference clip identity and time mapping in each alignment job. Volume/mute/solo or unrelated SFX edits do not invalidate otherwise compatible results. Replacing/trimming/retiming the reference source does. Deleting the binding leaves corrected lyrics intact and shows that alignment needs a reference source.

Preserve stable IDs and per-field provenance for line placement and word start/end. Rerunning alignment updates only automatic fields by default, retains every manual override and split/copied placement, and reports conflicts instead of rescaling corrections. Text editing keeps unchanged token IDs where unambiguous; removed tokens retain an explicit unresolved correction record until addressed. Repeated identical words/choruses must match by occurrence, not text alone. Keep explicit replace-corrections as a separate undoable action.

### Later processing

Auto-ducking is opt-in: choose trigger/reference and target tracks, threshold, reduction, attack, and release. Analyze source amplitude into a deterministic envelope with an explicit analysis time base; do not claim vocal isolation from a full mixed song. Normalization analyzes the final mix with FFmpeg using configurable integrated LUFS and true-peak targets; no platform loudness policy is assumed.

Use content/settings-hashed derived mix assets through the existing durable job queue. Preview and export must use the same processed mix with the original contributions disabled, preventing double playback. Source/timing/gain changes invalidate the derived result; never export a stale normalization/ducking result. Keep originals and analysis measurements; support cancel/failure/retry. Validate the final encoded audio against configured targets and documented tolerance.

## 6. Synchronization editor contract

The selected lyric opens an expanded waveform lane showing its recognized/timed words, gaps, and draggable start/end handles. Map project time through the selected reference clip's offset into the source waveform. Each handle is keyboard-adjustable and retains numeric input as an alternative. Pointer motion previews locally; commit one validated correction on release. Clamp within the line, disallow zero-duration/overlapping words, preserve exact token text, and do not compress intentional gaps. Allow an explicitly untimed word when no reliable boundary exists.

Loop selection with installed Player `inFrame`/`outFrame`/`loop` behavior, adapting the editor's half-open interval to the installed inclusive/exclusive API convention in a focused test. Add preview-only speed choices 0.5×, 0.75×, 1×, 1.25×, and 1.5× using `playbackRate`. Slower preview must not rewrite song clips or export speed. Disable/recompute looping when selection becomes untimed, deleted, or changes bounds.

Tap-to-sync is explicitly armed. On each tap, capture the authoritative Player frame, never a separate wall-clock estimate. First release supports line starts: the next tap closes the previous line, and Finish closes the last line at the playhead after validation. Show pending changes, retry/undo the last tap, and apply the session as one undo step. Reject reverse/duplicate/out-of-range taps; do not invent final boundaries on cancel. Ignore shortcuts while typing and avoid keyboard-repeat taps. Word timing remains the visual-handle workflow initially; word tap mode can be added only as an explicitly scoped extension.

## 7. Shared animation, text, and effects contracts

### Keyframes first

Store typed property curves with clip-relative integer millisecond positions, finite values, unique sorted times, and per-segment easing (`linear`, hold, ease-in, ease-out, ease-in-out initially). Evaluate using Remotion's current frame and interpolation/easing; convert saved times to the current FPS without using wall-clock animation or CSS playback state. Keep existing percent position units and degree rotation. Before/after a curve, hold endpoint values.

Start with x/y, rotation, scale, opacity; add lyric font size and active/text color through the same evaluator when A5 needs them. Preserve a curve-origin offset on trim/split so the evaluated motion and easing do not restart or change shape. Moving/ripple-moving a clip does not retime its internal motion; copy preserves it. Split evaluates identically on both sides of the split. Changing project FPS preserves time in milliseconds and samples at the new frames.

Inspector supports add/update/delete keyframe at playhead, previous/next navigation, and easing selection, plus a compact timeline lane. Keep static controls when no curve exists. No expression language, procedural camera engine, or node graph. Validate ranges server-side and use deterministic ordering when several transforms affect a clip.

### Fonts, karaoke, and reusable templates

Import local TTF/OTF/WOFF/WOFF2 as protected project font assets with a separate bounded size/type validation path, not ffprobe image/audio validation. Proposed font byte cap: 20 MiB per file. Validate actual browser/renderer FontFace loading before use, generate internal family IDs independent of filenames, persist hashes, and report missing fonts clearly. Reuse existing capability/path containment/repair rules. Carry attribution metadata when supplied; original media and font files stay immutable.

Save user presets locally as versioned style/animation values with stable IDs and names; applying copies values into the clip/project rather than creating a mutable live link. Referenced custom fonts travel with a preset's target project or application fails clearly. Update/delete a preset must not change existing projects. Begin with explicit save/apply/rename/delete; no marketplace or remote font search.

Use the keyframe evaluator for animated word emphasis (scale/color/offset), clip entrance/exit, and line reveals. Word emphasis follows actual word intervals and returns to neutral in gaps; no arbitrary motion between sung words. Line reveals are timed, saved display units within a lyric clip, preserving source/token mappings; initial modes show/hide or accumulate. Do not change the timing source or silently redistribute words when applying a template. Unicode shaping, multiline layout, and imported fonts share the same renderer and error handling.

### Adjustable transitions and effects

Reuse existing crossfade for standard dissolve. Add slide, zoom, wipe, and blur transitions with inspector duration, direction/amount, and easing. Pair transitions reference neighboring visual clips in the same track and require actual overlap within both clips' lengths. Reject or explicitly remove invalid transition references on trim/delete/reorder; no orphan pairs or implicit duration extension. Other tracks must keep rendering underneath.

Initial per-clip effects: brightness, contrast, saturation, hue rotation, blur; masks: adjustable rectangle/ellipse with position/size/softness where supported; background blur: blurred cover behind a sharp foreground copy, bounded to that visual clip. Keep masks on a separate wrapper from karaoke's word clipping. Expose numeric/reset controls, use validated finite ranges, and cap expensive blur values based on representative renders.

Use one documented wrapper/evaluation order: base layout → animated transform → transition wrapper → clip correction/filter/mask; lyric word emphasis remains inside text layout. Test transforms/masks at boundaries to prevent one feature from overwriting another's CSS. Use the same DOM/CSS/frame expressions in preview/export; no live CSS animation timelines, random dissolve noise, or shader dependency unless a measured requirement cannot be met otherwise.

## 8. Actionable backlog

Checkboxes below record verified delivery. Unchecked items remain planned or in progress. The completed MVP checklist remains separate.

### A0 — Baseline and migration fixtures (Priority 1)

- [x] A0.1 Capture current regression results and representative V1 project JSON: empty, untimed/repeated lyrics, manual word corrections/splits, layered GIF/video, missing asset, recovered backup, and saved export snapshot. Hash originals.
- [x] A0.2 Add migration expectation fixtures and freeze track order, timing units, source identity, lock/mute/visibility, ripple, grouping, and clipboard semantics from this plan.
- [x] A0.3 Record current open/edit/save/export behavior and bounded performance baseline using existing harnesses; preserve original source files and existing workspace changes.

Exit: reproducible before-state and explicit invariants; no production document rewritten.

### A1 — Unified timeline (Priority 1; depends on A0)

- [x] A1.1 Implement strict V2 discriminated track/clip/source schemas, deterministic V1 migration, version-dispatched read/recovery, and persistent pre-migration backup. Add pure migration and failed-save tests.
- [x] A1.2 Migrate commands, imports, alignment adapters, render input, and immutable export snapshots to one canonical model. Keep proof V1 isolated; remove duplicated live timeline representations.
- [x] A1.3 Render track rows and all active visual/lyric tracks in saved order; implement create/rename/reorder/delete, lock, mute, and visibility controls with numeric/keyboard alternatives.
- [x] A1.4 Implement selected-ID sets, primary selection, range/toggle/rectangle selection, compatible batch inspector, and atomic shared-delta movement. Guard locked members in the shared commands.
- [x] A1.5 Add flat clip groups, ungroup/individual edit, track-scoped union-interval ripple delete, and same-project cut/copy/paste with regenerated IDs and single-step history.
- [x] A1.6 Verify clipboard project scoping, immutable asset reuse, undo behavior, and existing edit/save/reopen/export/GIF/layer journeys on migrated projects. Add a regression proving foreign-project clipboard references cannot be pasted.

Exit: representative V1 projects render equivalently after migration; interrupted/failed saves preserve originals; no command leaves partial group or multi-selection changes.

### A2 — Audio mixing (Priority 1; depends on A1)

- [x] A2.1 Permit concurrent audio tracks/clips; implement additive imports, track/clip gain and mute, track solo, master gain, and clip audio fade envelopes in saved data and inspector.
- [x] A2.2 Implement shared preview/export mixing, source trims and fade evaluation; verify Web Audio amplification instead of assuming native element gain above unity works.
- [x] A2.3 Add explicitly enabled embedded video audio, preserving normal video trim/split/move behavior and preventing duplicate sound. Include it in track mute/solo.
- [x] A2.4 Introduce explicit lyric-reference audio binding and job time mapping; allow additional music/SFX without breaking alignment. Reject changed reference arrangements, not unrelated mix edits.
- [x] A2.5 Add synthetic-tone preview/export checks for overlap, levels, mute/solo, fades, video audio, and cancellation. Persist/reopen mixer settings and record clipping/headroom limitations.

Exit: two known tone sources are independently measurable in rendered output; mute/solo/fades/source offsets match preview semantics; the designated song still aligns with an additional music/SFX track.

### A3 — Lyric synchronization editor (Priority 1; depends on A1/A2)

- [x] A3.1 Introduce stable source/token occurrence identities and field-level correction provenance. Migrate manual lines conservatively and preserve fragments, copied instances, styles, and unchanged tokens.
- [x] A3.2 Implement conflict-aware rerun merging: protect manual starts/ends even when edits occur while a job runs; retain explicit full replacement and one-step undo.
- [x] A3.3 Add zoomable selected-line waveform word handles and gap visualization, reusing source waveform caching/time conversion. Include keyboard/numeric access and locked-track guards.
- [x] A3.4 Add selected-line looping and preview-only playback rate using installed Player features; test half-open boundary conversion, selection changes, and unchanged export timing.
- [x] A3.5 Add armed line tap-to-sync, authoritative frame sampling, pending review, undo-last/finish/cancel, and one history transaction; preserve unsynchronized source text.
- [x] A3.6 Verify the full workflow: multi-audio project → tap line starts → loop/slow preview → drag word boundary → rerun alignment → retain correction → save/reopen → export.

Exit: each manual field remains intact after rerun; valid word handles retain gaps/text; looping/speed/tapping do not introduce an independent clock or silently alter media speed.

### A4 — Keyframes (Priority 2; depends on A1)

- [x] A4.1 Add typed curves, origin/time rules, easing validation, FPS conversion, and pure deterministic sampling using installed Remotion interpolation/easing.
- [x] A4.2 Add inspector and timeline controls for position/rotation/scale/opacity keyframes, keyboard access, reset, and single-step undo.
- [x] A4.3 Preserve motion through trim/split/move/ripple/copy and resolve static/animated values consistently; persist/migrate new feature data safely.
- [x] A4.4 Compare preview/render frames at keys, midpoints, discontinuities, trim/split boundaries, and multiple FPS settings; verify random seeking reproduces the same output.

Exit: sampled property values and representative pixels agree; no wall-clock-driven animation path exists.

### A5 — Rich text and templates (Priority 2; depends on A3/A4)

- [x] A5.1 Add validated local font assets, protected serving, FontFace readiness in Player/renderer, versioned font references, and missing-font repair/errors.
- [x] A5.2 Implement versioned local save/apply/rename/delete style presets with copied values and explicit font dependencies; existing projects stay unchanged after preset edits.
- [x] A5.3 Add word emphasis and lyric entrance/exit controls using shared property curves; expose supported lyric properties without a second animation engine.
- [x] A5.4 Add timed line reveals/accumulation and reusable karaoke templates, preserving actual source/token timings and multiline layout.
- [x] A5.5 Verify imported-font shaping/wrapping/Unicode, template edits/undo, missing fonts, save/reopen, and representative portrait/landscape preview/export frames.

Exit: user imports a font, saves/applies a template, edits timing, and exports the same shaped/animated text seen in preview.

### A6 — Transitions and effects (Priority 2; depends on A4/A5)

- [x] A6.1 Add validated transition pairs and inspector controls for slide/zoom/wipe/blur; map dissolve to the existing crossfade implementation.
- [x] A6.2 Add bounded color correction/filter controls and rectangle/ellipse masks with reset, persistence, history, and compatible batch editing.
- [x] A6.3 Add background blur and enforce wrapper/effect order with keyframes, layer opacity, GIF/video playback, and lyric masking kept independent.
- [x] A6.4 Verify adjacent pair edits, invalid/deleted partners, random seeking, multi-layer interactions, portrait/landscape pixels, and export cost; set measured effect caps.

Exit: effects are inspector-adjustable, deterministic, and preserved through edit/save/export; transition errors cannot silently shorten/extend media.

### A7 — Ducking and normalization (Later; depends on A2)

- [x] A7.1 Implement cached deterministic sidechain analysis/envelopes with configurable trigger/targets, threshold/reduction/attack/release, cancellation, and invalidation.
- [x] A7.2 Implement analyzed final-mix normalization using installed FFmpeg capabilities, configured LUFS/true-peak targets, measured encoded output, and preserved source media.
- [x] A7.3 Connect derived mix to both preview/export, handle stale/failed/cancelled analysis, prevent double audio, and verify silence/ducking/levels/source edits with generated fixtures.

Exit: the same processed audio drives preview/export; measured results accompany target claims; no stale processed mix is used after editing.

## 9. Verification and rollout

Use existing test conventions, not a second framework. Each phase adds focused runnable coverage for its new branching/data logic. Run `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build`; run Python checks when alignment protocol/adapters change. Update relevant existing editor/media/background/recents/full-export/visual harnesses as the model changes. Do not render the whole workload matrix after every trivial UI edit.

| Area | Required proof |
|---|---|
| Migration | Field-preserving V1→V2 cases, stable repeated migration, collision handling, future-version rejection, corrupt backup recovery, failed first save, immutable pre-migration backup |
| Editing | Mixed selection/groups, locked rejection, union ripple with overlaps, clipboard IDs/assets, one gesture/undo step, no source deletion, dirty-save races |
| Audio | Synthetic frequencies/RMS across overlap/fade/solo/mute/video offsets; source-only binding; no preview double playback; encoded clipping observations |
| Lyrics | Repeated source/token occurrence IDs, edits while job runs, field-level preservation, word gaps, waveform offset, loop boundaries, rate-independent tap frame capture |
| Animation/text/effects | Property sampling and pixel comparisons before/inside/after boundaries, random seeks, imported-font success/failure, mask/transform interactions, orientation/FPS changes |
| Persistence/jobs | Version-aware save/reopen/backup, source asset hashes, snapshot immutability, cancel/restart/failed derived result cleanup |
| Performance | Typical project and structural stress from the existing benchmark; record additional simultaneous audio/effect/word handles cost rather than recycling old cap claims |

Browser autoplay restrictions are handled through user-initiated playback; clipboard works without browser system permissions. Keyboard shortcuts must ignore editable fields. Track controls and word/keyframe handles need accessible names, visible focus, and keyboard/numeric alternatives. Pointer moves must not clone/validate the entire project at display-frame frequency; commit validated gestures to existing history. Add waveform peak reuse/culling only when measured necessary.

First release boundary is A0–A3: 20 Priority 1 work packages. A4–A6 contain 13 Priority 2 packages. A7 contains 3 explicitly later packages. Total: 36 new work packages, all unchecked at planning completion. No delivery date is promised before the migration/audio/sync slices are measured.

## 10. Implementation outcome

All 36 packages have been implemented in dependency order. [Advanced controls and verification](advanced-editor.md) describes usage, compatibility, limits, and runnable checks. Phase reports are under artifacts/advanced/; the current workload measurements are in artifacts/acceptance/performance/report.json. The original brief and completed MVP scope remain intact. Work is local, with no commits, pushes, deployment, or public media upload.
