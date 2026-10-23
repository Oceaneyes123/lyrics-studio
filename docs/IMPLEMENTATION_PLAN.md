# Lyrics Studio: Detailed Implementation Plan

Date: 2026-10-22. Source: [PLAN.md](PLAN.md).

## 1. Goal and baseline

Build a local browser-based editor that turns a song and pasted lyrics into synchronized, editable lyric videos. Users can correct alignment, style lyrics, edit media, save/reopen projects, and export MP4.

At the planning baseline, the repository contained only the source brief. M0 implementation is now in progress; see [technical-proof.md](technical-proof.md) for actual dependency versions, working samples, tests, limitations, and outstanding evidence. M1-M5 remain pending. This plan preserves the brief and makes its requirements actionable.

The root task_plan.md, findings.md, and progress.md track this planning task. Completing planning does not complete product implementation.

## 2. Scope and user journey

1. Create a portrait or landscape project.
2. Import an MP3/WAV song and optional MP4 video or JPG/PNG image.
3. Paste plain-text lyrics, preserving line order and repeated sections.
4. Run alignment with visible progress, cancellation, and actionable failures.
5. Review matched, uncertain, and unmatched lines; correct line and word timing.
6. Drag, resize, trim, split, and delete clips; zoom, snap, seek, undo, and redo.
7. Style lyrics, crop/reposition media, apply transitions, and enable karaoke.
8. Preview with play/pause, seeking, and frame stepping.
9. Save/reopen the project and export 720p/1080p H.264/AAC MP4.

### Proposed MVP constraints

- One song audio track. Embedded video audio is muted; multiple-track audio mixing remains excluded.
- One Video track supports sequential clips and explicit two-clip crossfades. One Lyrics track rejects overlapping timed lines initially.
- Image duration is editable. Audio/video trims reference originals without modifying them.
- Offer 16:9 and 9:16 canvas presets. Proposed FPS choices: 24, 25, 30; default 30, subject to M0 verification.
- Short backgrounds end on the configured solid canvas; no implicit looping or stretching.
- Production song input is user WAV/MP3 upload; lyrics are pasted in the UI. The music/ directory is a temporary local test fixture only.
- Demucs and active-word scale animation are optional, after required features work.
- Exclude accounts, cloud, database, collaboration, translation, AI video generation, mobile editing, advanced effects, and keyframe editing.

These constraints are proposals where the brief leaves behavior open. Resolve audio policy and supported FPS before implementing their controls. No delivery-date estimate is justified before hardware and alignment measurements.

## 3. Architecture and module boundaries

Use the source's React/TypeScript/Vite frontend, Fastify backend, Python alignment worker, local JSON/media storage, and shared Remotion composition. Keep a small workspace; no independently deployed infrastructure is needed.

| Location | Owns | Must not own |
|---|---|---|
| apps/web | Panels, timeline gestures, Zustand/Immer session state, Remotion Player | Disk paths, worker processes, export orchestration |
| apps/api | Imports, validation, persistence, jobs, media serving, rendering invocation | Duplicate timeline or composition rules |
| packages/project-model | Runtime schemas, IDs, timing/frame helpers, invariants | UI or filesystem access |
| packages/editor-core | Pure editing commands, snapping, history boundaries | React or network requests |
| packages/video-composition | Deterministic composition shared by Player and Renderer | Alignment or mutable editor state |
| services/lyric-alignment | Engine adapter, transcription artifacts, structured progress | Direct project JSON writes |
| storage/projects/<projectId> | Project document, assets, derived data, exports | Arbitrary browser-supplied paths |
| tests | Cross-process fixtures and user journeys | Copies of production logic |

Use Tailwind/shadcn, dnd-kit, WaveSurfer, Vitest, and Playwright as proposed in the brief, after compatibility checks. Fastify launches Python through a versioned JSON process contract; Python needs no separate HTTP server. Start with one heavy alignment/render job at a time and polling for progress. Do not add Redis, WebSockets, or another queue service.

Player owns the playback clock. Timeline and waveform reflect its position; waveform rendering must not introduce a second audio player.

## 4. Data and editing contracts

### Persisted model

| Entity | Minimum fields and rules |
|---|---|
| Project | schemaVersion, ID, name, revision, FPS, dimensions, durationMs, assets, tracks, source lyrics, styles |
| Asset | Stable ID, media type, project-relative stored path, display name, content hash, duration/dimensions/codecs |
| Track | Stable ID, kind: video/audio/lyrics, ordered clip references; enforce MVP limits |
| Media clip | ID, track/asset IDs, startMs, durationMs, sourceInMs, transform, transition |
| Source lyric line | Stable ID, original text/order, normalized matching text, review status/reason |
| Lyric clip | ID, source line reference, startMs, durationMs, displayed tokens, style reference/overrides |
| Word token | Stable ID, exact text, clip-relative startMs/endMs, automatic/manual origin, optional engine confidence |
| Style | Font, size, colors, alignment, position, outline, shadow, karaoke mode; explicit defaults/units |

Keep job status, waveform samples, transcription, model logs, and undo history outside project JSON. Missing derived caches must not prevent reopening. Preserve original supplied lyrics separately from normalized matching text. Keep punctuation, spacing, Unicode, and repeated choruses; transcription must not silently rewrite the user's text.

Unmatched lines remain saved in a visible untimed list without invented timestamps. Manual placement creates a clip. Uncertain matches retain a review flag; never invent confidence scores unsupported by the engine.

### Time invariants

- Store integer milliseconds and half-open intervals [start, end), with positive durations.
- Convert milliseconds to frame boundaries in one shared helper using a documented nearest-frame rule. Derive rendered duration from converted end minus start. Reject or explicitly extend zero-frame edits.
- Evaluate lyric time from the current frame, not an independently accumulated playback clock.
- Word times satisfy 0 <= start < end <= clip duration, in display order. Gaps are allowed; overlapping words within one line require correction for the initial single-active-word renderer.
- Song length defines initial project duration. Reject edits beyond the end or explicitly extend duration; never silently truncate content.
- Crossfade requires available overlap between adjacent video clips. Store one boundary transition, limit its duration to that overlap, and reject a third simultaneous video clip.

### Edit semantics

| Operation | Contract |
|---|---|
| Move lyric | Change absolute start; preserve relative word timing; validate overlap/bounds |
| Extend lyric | Extend the visible hold; do not scale word timings |
| Trim lyric right | Clip/remove excluded timings and show correction state; keep source text recoverable |
| Trim lyric left | Advance start, remove excluded timings, clip boundary word, rebase retained relative times |
| Split lyric | Partition displayed tokens and rebase right timings; snap a split inside a sung word to a word boundary or require correction; never duplicate that word |
| Trim/split media | Preserve asset; adjust source offsets; validate source duration; retain transforms |
| Edit text | Preserve unaffected token IDs where safe; invalidate changed timings and mark review required |
| Delete lyric | Remove only that clip; retain source text. Return a line to untimed status only when no timed fragments remain; track partial coverage after splits |
| Undo/redo | One entry per completed gesture/command; no entries for playback, selection, or job progress |
| Rerun alignment | Preserve manual corrections by default; replacement is explicit and one undoable action |

Split fragments retain their source line ID and token coverage so reruns cannot recreate duplicate lines. Treat dragging as temporary state until a validated commit on release. Provide numeric timing and keyboard alternatives to pointer gestures. Keep visible selection and focus after split/delete.

## 5. Persistence, API, and background jobs

### Storage behavior

- Stream imports to project-local temporary files, validate actual media metadata, then move to stable asset paths. Originals remain unchanged; optionally reuse identical content hashes.
- Validate media type, size, duration, and image dimensions. Set practical limits from M0 measurements and show them before processing.
- Save with revision checks, a temporary file, atomic replacement, and one last-good backup. Test Windows replacement and interrupted-write behavior.
- Reject unsupported future schema versions without rewriting. Introduce migrations only when a real earlier format exists.
- Provide explicit Save and debounced autosave with saved/saving/failed state. Retain dirty edits after failure; warn before closing unsaved work.
- Store imported media in the project. Missing assets trigger repair/reimport; never silently substitute files.
- Bind the backend to loopback, restrict frontend origins, and use a per-launch capability token for mutations. Validate IDs and containment under storage root, including symlink escapes. Launch child processes without shell interpolation.
- Serve registered assets with range support and correct media types. Map browser URLs and renderer paths through the same asset resolver.

### Proposed API

| Endpoint | Responsibility |
|---|---|
| POST /projects | Create validated project |
| GET /projects | List local saved projects |
| GET /projects/:id | Load document/revision and missing-media report |
| PUT /projects/:id | Validate/save with expected revision; reject stale writes |
| POST /projects/:id/assets | Import and return asset metadata |
| GET /projects/:id/assets/:assetId | Stream a registered asset |
| POST /projects/:id/alignment-jobs | Align a captured media/lyrics revision |
| POST /projects/:id/export-jobs | Render immutable snapshot and preset |
| GET /jobs/:jobId | Read state, stage, measured progress, result/error |
| POST /jobs/:jobId/cancel | Cancel queued work or stop running process tree |
| GET /jobs/:jobId/result | Read alignment output or completed MP4 |

### Lifecycle and cache rules

Persist states: queued, running, succeeded, failed, cancelled, interrupted. A job succeeds only after its validated output is atomically available. Report stages where a measured percentage is unavailable.

Capture project revision, relevant asset/lyrics hashes, engine/model/config versions, and export settings. Late alignment results cannot overwrite newer text or manual edits. Offer explicit compatible result application or rerun. Exports use captured snapshots while the editor remains usable.

On restart, mark previously running jobs interrupted and allow retry. Do not claim unimplemented resume. Stop child processes on cancellation. Remove partial outputs without touching source assets or completed exports.

Cache transcription by audio hash, engine/model version, analysis settings, and preprocessing. Cache lyric matching separately by transcription identity and normalized lyrics. Text-only edits reuse transcription; audio/model changes invalidate it. Explain model downloads and disk requirements before download begins.

## 6. Milestones and actionable backlog

M0 quality evidence remains open. The user explicitly authorized proceeding with other features. M1-M3 feature slices and core M4/M5 behavior are implemented; broader visual and release QA remains open. Checked work packages are delivered tasks, not claims that every release gate passed.

### M0: Technical proof

Dependency: none. Deliverable: a simple real exported lyric video plus a feasibility record.

- [x] M0.1 Inventory Windows/browser, Node/Python, FFmpeg, CPU/RAM/GPU/VRAM, and disk. Verify exact lyric-align package identity, API, maintenance/license, faster-whisper compatibility, and applicable Remotion terms. Pin only a working dependency combination.
- [ ] M0.2 Assemble permissioned fixtures: clear vocals, repeated chorus, long instrumental gap, sustained vocals, fast singing, inaccurate text. Manually annotate representative line/word boundaries. Add required languages/scripts explicitly.
- [ ] M0.3 Run alignment, beginning with CPU where supported. Record load/processing time, peak memory, matched-line coverage, boundary error, unmatched lines, and repeat handling.
- [x] M0.4 Create a minimal shared Player/Renderer composition with pinned local font, song audio, and timed lyrics. Render MP4.
- [ ] M0.5 Compare visual boundary frames, probe codecs/dimensions/duration, and inspect/listen to exported audio. Use timestamped marker audio to measure initial offset and accumulating drift.
- [x] M0.6 Record commands, versions, fixtures, measurements, limitations, and go/no-go in docs/technical-proof.md.

Current decision: proceed with editor features as explicitly authorized by the user, retaining M0 accuracy/listening limitations. M0.2, M0.3, and M0.5 remain partial. See editor-implementation.md for delivered features and current evidence.

Exit gate: sample plays; Player/export visual events agree within one frame; marker audio shows no accumulating drift above one frame after encoder-delay accounting; uncertain/unmatched input remains explicit. Report alignment errors separately from deterministic visual timing.

Provisional usability target for the clear-vocal fixture: at least 90% usable line matches, median line-boundary error <=250 ms, p95 <=750 ms. These are proposed product targets, not engine guarantees. Report word error and manual correction burden, then settle the acceptable word-quality target before M3.

If the named engine fails, document the concrete reason and evaluate one compatible alternative behind the adapter. Manual-only editing does not satisfy automatic alignment. Resolve renderer feasibility before building the full editor.

### M1: Editor foundation

Dependency: M0 go decision. Deliverable: import, preview, save, reopen.

- [x] M1.1 Initialize apps/packages, TypeScript/Python environments, lockfiles, environment example, development scripts, lint/type checks, and test runners. Document one startup workflow and clean shutdown.
- [x] M1.2 Implement shared runtime schemas, IDs, time conversions, source references, defaults, and bounds. Add valid/invalid project fixtures.
- [x] M1.3 Implement create/list/load/save, revision conflicts, atomic writes, backup recovery, path checks, and future-version rejection. Test with temporary directories.
- [x] M1.4 Import MP3/WAV/MP4/JPG/PNG, probe metadata, store assets, and serve ranges. Surface corrupt/unsupported media clearly.
- [x] M1.5 Build resizable media library, lyrics panel, inspector, canvas, and timeline; include empty/loading/error states and save status.
- [x] M1.6 Connect shared composition to Player with play/pause/seek/frame-step, waveform, and basic clips. Use one playback clock.

Exit gate: import each format, preview song plus background, save/reopen with identical IDs/timing, handle missing assets and failed saves, and reach primary controls by keyboard.

### M2: Timeline editing

Dependency: M1. Deliverable: working non-destructive multitrack editor.

- [x] M2.1 Implement pure move/resize/trim/split/delete commands with source offsets and section 4 invariants. Create manually timed lyric fixtures before alignment integration.
- [x] M2.2 Connect gestures to validated commands. Centralize pixel/time conversion and reject invalid bounds/overlaps before committing.
- [x] M2.3 Add zoom around playhead, horizontal scroll, seeking, and snapping to frames/playhead/clip edges. Use a pixel snap threshold and a bypass modifier.
- [x] M2.4 Synchronize Player, playhead, and waveform without updating the complete project store every frame.
- [x] M2.5 Add undo/redo, numeric timing inputs, keyboard operations, visible focus, and shortcuts that do not hijack text entry.

Exit gate: edit all three track types, undo/redo each operation, and save/reopen. Cover minimum frame duration, project edges, source offsets, lyric fragments, word rebasing, overlaps, and one history entry per gesture.

### M3: Automatic lyrics and correction

Dependency: M2 and M0 quality/engine decision. Deliverable: pasted lyrics become correctable timed clips.

- [x] M3.1 Preserve original text, stable lines, blank-line grouping, punctuation, Unicode, and repeated sections through edits.
- [x] M3.2 Implement validated worker requests/results, structured stages, model-download state, failures/timeouts, cancellation, and process cleanup. Keep diagnostic logs separate from protocol output.
- [x] M3.3 Store transcription separately and implement cache invalidation. Text changes must not unnecessarily rerun audio analysis.
- [x] M3.4 Apply valid matches in source order; show uncertain lines and durable untimed lines. Reject invalid/out-of-bounds/conflicting engine timings.
- [x] M3.5 Provide manual line start/end, word start/end, playback around selection, and untimed placement. Integrate history, review flags, and persistence.
- [x] M3.6 Handle stale results, preserve manual corrections, support explicit replacement, and test cancel/retry/restart.

Exit gate: align real audio; preserve repeated choruses and gaps; retain inaccurate/unmatched text visibly; save/reopen manual corrections; verify reruns do not silently overwrite them. Record corpus quality and correction burden, including failed cases.

### M4: Visual editing and karaoke

Dependency: M3. Deliverable: complete styled lyric video in shared preview/rendering.

- [x] M4.1 Add font, size, color, alignment, position, outline, shadow, and small style presets using shared saved data.
- [x] M4.2 Implement active-word color and progressive fill from clip-relative times. Define before-first, gap, and after-last states; gaps retain completed words without inventing an active word.
- [ ] M4.3 Load identical licensed/bundled fonts for Player and Renderer. Check wrapping, punctuation, Unicode, multiline text, and missing-font handling. Base fill on actual layout, not character count alone.
- [x] M4.4 Add crop, scale, reposition, and fit for video/images; persist normalized placement for resolution changes. Add 9:16 and 16:9 presets.
- [x] M4.5 Implement cut, visual fade-in/out, and video crossfade with validated durations/overlaps. Keep the song continuous.
- [ ] M4.6 Compare representative boundary frames and styles in portrait/landscape. Keep composition evaluation deterministic and free of wall-clock/random effects.

Exit gate: required styling, framing, transitions, and karaoke appear from the same saved data in preview/export with visual timing within one frame. Manual timing changes affect both paths. Optional active-word scaling stays deferred until required behavior passes.

### M5: Export and quality assurance

Dependency: M4. Deliverable: usable MVP with reliable output and recovery.

- [x] M5.1 Validate assets, fonts, schema, output capacity, and settings before rendering. Show untimed/review-needed lyrics; require an explicit export choice if those lines will be omitted.
- [x] M5.2 Implement immutable export snapshots, queued background rendering, persisted progress/errors, cancellation, and completed-file download.
- [x] M5.3 Verify 1280x720, 1920x1080, 720x1280, and 1080x1920 outputs with H.264/AAC and every offered FPS. Sanitize filenames and prevent unrelated-file overwrite.
- [ ] M5.4 Exercise corrupt media, unsupported codec, worker/render failure, interrupted jobs, save conflicts, cancellation, and disk exhaustion. Preserve originals and last-good project state.
- [ ] M5.5 Benchmark short and full-length songs on recorded hardware: import, waveform, alignment, export, memory, and timeline responsiveness. Set supported project limits from measurements; optimize only measured bottlenecks.
- [x] M5.6 Document prerequisites, startup, model downloads, project backup, correction, export, recovery, formats, and limitations.

Exit gate: pass the acceptance matrix, export all four size/orientation presets, reopen/edit after restart, and run M1's lint/type/unit/integration/end-to-end checks. Retain measured evidence; do not mark unavailable or skipped checks passed.

## 7. Acceptance and verification matrix

| Source requirement | Milestone | Required proof |
|---|---|---|
| Song and plain lyrics without SRT | M1, M3 | Real import and plain-text alignment journey |
| Automatic timed lyric clips | M0, M3 | Valid engine result, persisted clips, quality measurements |
| Manual line and word corrections | M2, M3 | Undo/redo and save/reopen preserve edits |
| Drag, resize, trim, split, delete | M2 | Pure-command edge tests and pointer/keyboard flow |
| Zoom, snapping, waveform, playhead | M1, M2 | Multiple zoom levels, seeks, and frame-step agreement |
| Font, size, color, alignment, position, outline, shadow | M4 | Saved fixture, Player screenshot, exported frame |
| Cut, fade-in/out, video crossfade | M4 | Before/during/after frames and overlap validation |
| Video trim, crop, scale, reposition | M2, M4 | Source-offset tests and exported framing |
| Word colors and progressive karaoke | M4 | Word start/middle/end, gaps, and manually corrected fixtures |
| MP3, WAV, MP4, JPG, PNG | M1, M5 | Valid format fixtures plus corrupt/unsupported cases |
| MP4/H.264/AAC at 720p/1080p | M0, M5 | Probe output and playable preset exports |
| Portrait and landscape | M4, M5 | Four preset exports and framing inspection |
| Preview/export within one visual frame | M0, M4, M5 | Same project at identical boundary frames |
| Audio synchronization | M0, M5 | Start/middle/end marker measurements and listening review |
| Save/reopen/edit | M1-M5 | Round trip, failed save, interrupted write, missing media |
| Repeats, gaps, sustained/fast vocals, inaccurate lyrics | M0, M3, M5 | Named corpus outcomes and explicit uncertain/unmatched lines |

Use Vitest for model/edit commands/time helpers; API integration tests with temporary storage and stub processes for lifecycle failures; Python tests for normalization/result mapping/cache keys; Playwright for user journeys. Keep at least one real-engine and real-render integration run beyond mocks. Do not run costly models/renders for every UI unit test.

One-frame rendering parity does not imply one-frame singing alignment accuracy. Report alignment error, manual correction burden, and muxed audio timing independently.

## 8. Decisions and risks

| Open decision/risk | Handling | Resolve by |
|---|---|---|
| Exact lyric-align identity and suitability | Verify package/API/license on real singing fixtures; one alternative only after a concrete failure | M0 |
| CPU/GPU speed and memory | Measure actual Windows hardware and feasible CPU operation | M0 |
| Required languages/scripts | Add representative fixtures rather than assume support | M0 corpus |
| Acceptable word alignment | Measure error and correction burden; settle target from samples | Before M3 |
| Dependency/runtime/render terms | Verify current compatibility and pin proven combination | M0 |
| Muted embedded video audio | Proposed single-song policy; confirm before controls depend on it | Before M1 |
| Offered FPS | Offer only proven 24/25/30 settings | Before M1 defaults |
| Partial-word splits and deleted fragments | Explicit source/token coverage; no duplicate sung words or lines | Before M2 |
| Save crash/conflict/disk limits | Revision checks, atomic replacement, backup, clear recovery | M1, M5 |
| Font/codec preview/export differences | Pinned fonts and actual frame/audio comparisons | M0, M4 |
| Local API/file exposure | Loopback, origin/token checks, bounded imports and paths | M1 |
| Large projects | Benchmark first; virtualize/optimize only for measured limitations | M5 |

## 9. Execution order and next action

Follow M0 proof, M1 foundation, M2 editing, M3 automatic lyrics, M4 visual editing, M5 export hardening. Rendering is proved early in M0 and becomes a full user-facing workflow in M5.

First implementation slice (now in progress):

1. Inventory runtimes/hardware and verify the exact alignment engine.
2. Prepare one permissioned clear-vocal fixture with annotated boundaries.
3. Produce validated line/word timing from pasted lyrics.
4. Render a minimal shared-composition sample with audio.
5. Record results and the go/no-go before scaffolding the full editor.

The user has authorized local implementation in dependency order. Commits, pushes, deployments, public uploads, and paid services remain outside authorization. Product completion requires all milestone exit gates; this document is the roadmap, not execution evidence.
