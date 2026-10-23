# Progress

## Advanced implementation started (2026-10-23)
- A0 baseline passed all existing unit/Python/lint/type/build and background/GIF/layer/recents/48-frame parity harnesses. Captured source/fixture hashes and the existing measured workload baseline in artifacts/advanced/baseline.json; no new maximum-workload claim.
- A1.1 delivered strict V2 track/clip/source validation, deterministic V1 migration, version-dispatched timeline storage read/recovery, permanent byte-preserving V1 backup, stale-save/asset protection, failed-write retry, and 12 focused tests. Live V1 API/UI stays active until A1.2 adoption is complete.
- Shared V2 commands now cover lock guards, grouped multi-selection movement, union ripple delete with conflict rejection, project-scoped clipboard, copied lyric identities, source-preserving delete, split, and snapping; eight focused command tests pass. Initial lint found an unused type and a test narrowing issue; corrected both.
- A1.2 integration now uses canonical V2 in API project create/list/load/save/import/export, shared TimelineVideo rendering, UI store/history, App, and unified track timeline. Source untimed entries remain separate from timed clips. Updating the old tests to canonical fields fixed expected V1 API fixture failures; 70 TypeScript tests now pass. No live original media was rewritten.
- New timeline supports track name/order/lock/mute/visibility, group-expanded multi-selection, rectangle/range/toggle selection, project-scoped clipboard, ripple delete, and keyboard alternatives. Regression harnesses are being updated to canonical model fields and rerun before closing A1.
- Actual browser unified-timeline journey passes migration-on-open without writing, first-save permanent backup, rectangle/group selection, batch movement, locked-edit rejection, clipboard/ripple, undo/redo, visibility, and reopen. The existing background drag test found that the taller timeline placed visual drop targets below the viewport; adjusted workbench sizing. An intermediate diagnostic screenshot needed a missing mkdir import, corrected.
- User explicitly authorized each advanced task step by step. Applying Ponytail and continuing the root planning files; no CodeGraph index exists.
- Scope reaches model/migration, storage/version guards, commands, store/history, App/Timeline, shared rendering, API imports/alignment/exports, tests/fixtures, and scripts. Preserve existing uncommitted authorized changes.
- Begin A0 with runnable baseline and synthetic V1 migration fixtures. No live project migration before compatibility checks.

## Advanced editor plan (2026-10-23)
- User invoked planning-with-files for six feature areas, with unified timeline, simultaneous audio, and synchronization tools marked Priority 1. Treated this as a planning request; no runtime changes made for the new features.
- Resolved the existing root plan; no .codegraph index exists. Reviewed model/commands/history/timeline/renderer/API/storage and installed Player/Audio/interpolation type contracts. Existing edits are previous authorized work and remain preserved.
- Created docs/ADVANCED_IMPLEMENTATION_PLAN.md: dependency order, canonical schema and versioned migration/recovery, track/group/selection/ripple/clipboard behavior, audio mixing/reference binding, per-word correction preservation, loop/speed/tapping, keyframes, imported fonts/templates, transitions/effects, later ducking/normalization, and phase-specific verification/exit gates.
- New backlog has 36 unchecked packages: 20 Priority 1, 13 Priority 2, 3 explicitly later. The completed 32-package MVP stays unchanged; removed accuracy/listening tasks are not restored.
- Updated task_plan.md/findings.md and linked the plan from README. Windows literal-glob rg lookup failed during a type read; switched to directory search with -g. No application tests rerun for this documentation-only task.
- Plan self-check passed: 36 unique task IDs with the expected 20/13/3 priority split, all six requested areas present, original 32 completed MVP items retained, no removed MVP tasks restored, and edited-file whitespace clean. Clipboard is deliberately project-scoped; cross-project asset transfer is excluded from the initial scope.

## MVP scope revised by user (2026-10-23)
- User explicitly requested disregarding and removing the three remaining items. Removed M0.2/M0.3/M0.5 from the active implementation checklist, retaining IDs of delivered tasks.
- All 32 retained MVP work packages are complete. Updated current status in task_plan.md, README, implementation/acceptance records, and editor documentation; historical measurements and known unverified limits remain intact. Removed the duplicate unchecked M0 evidence list from the historical proof record.
- Documentation-only scope change; no runtime code, tests, commits, or pushes. Task removal is not a claim of measured accuracy or listening approval.

## Acceptance follow-up (2026-10-23)
- Continuing the seven unchecked work packages in order; preserve newer layered-background/GIF/recent-project work already committed in the workspace.
- M0.2/M0.3: generated local long-silence and 1.25x tempo stress audio plus inaccurate text, hashed originals and derivatives, created blind annotation templates. Current small model matches original 28/28, long-gap 19/28, fast 28/28, inaccurate 28/29; these are coverage, not accuracy.
- Added separate model setup/transcription/mapping timings. Windows peak memory is process-lifetime high-water mark; subsequent in-process cases must not be described as isolated per-case peaks.
- Visual harness initially used a relative Webpack output path; corrected to absolute. First 48 parity cases passed; missing-font assertion incorrectly waited for visible text from an asynchronous exception, corrected to inspect actual browser errors.
- Failed metadata-save upload returns the existing documented 400 import error, not 500; corrected test expectation. No API behavior change needed.
- A large patch initially referenced the wrong progress heading and was rejected atomically; reapplied without that hunk. A compound read/log command was blocked by a local hook; narrower reads succeeded.
- The missing-font test originally blocked WOFF2 only; WOFF fallback still loaded. Blocking both formats proves explicit rejection. 48 full-canvas preview/render comparisons pass. Inspected Japanese/Arabic/emoji portrait output: distinct glyphs, explicit newline, no visible replacement boxes.
- Benchmark helper initially sent JSON content type without a POST body; corrected request headers. A visual check attempted to share port 5174 while benchmarking and correctly failed the strict-port check; run these harnesses sequentially.
- Completed benchmarks: 10-second / 97.431-second / five-minute 720p30 exports took 15.1 / 96.5 / 253.9 seconds. Full/five-minute decoded samples at 5/45/80 and 5/150/290 seconds measured 0 ms offset, correlation >0.9999. Node peak RSS 1,016,672,256 bytes excludes browser/FFmpeg; no whole-process-tree memory claim.
- Structural stress passed: 2,000 lyrics and 500 backgrounds in 10 layers over a one-hour timeline; validation 12.4 ms, open 1,866 ms, zoom 902 ms including browser automation. This structural fixture was not exported and does not establish smooth editing at every schema cap.
- Final verification: 50 TypeScript/API/job tests, 24 Python tests, semantic/unused-code lint, production build, 48 Player/renderStill parity cases, explicit missing-font failure, background/GIF/layer export regression, and recent-project persistence/error regression all passed. Diff whitespace check passed. Existing non-fatal build chunk/use-client notices remain.
- Added docs/acceptance-review.md with exact measurements, reproduction commands, independent annotation instructions, listening form, and limitations. Closed M4.3/M4.6/M5.4/M5.5; 32/35 work packages are checked. M0.2/M0.3/M0.5 remain partial until independent annotations/natural fast-vocal review and human listening are supplied.
- Read-only post-export probe commands containing format=duration were blocked by a local hook; a direct ffprobe full-stream query succeeded and confirmed five-minute H.264/AAC output. No disk-filling experiment, original-media edits, commits, pushes, deployments, or public uploads occurred. Temporary harness servers/storage were closed/removed; local acceptance media/reports remain ignored.

## 2026-10-22
- Read planning-with-files and Caveman instructions.
- Resolved planning location to project root; initialized missing planning files.
- Checked git status and diff: docs/ is untracked; no tracked code changes.
- Session metadata catchup completed without output.
- Planning only; no implementation, commit, or push authorized.

## Discovery complete
- Read the complete source brief and confirmed docs contains only PLAN.md.
- Phase 1 complete; Phase 2 in progress.
- Environment selector inspection returned exit 1 because optional PLAN_ID/PWF_PLAN_ROOT variables are unset; no named-plan binding is active. Continue with the root planning files.

## Planning and review complete
- Created docs/IMPLEMENTATION_PLAN.md: 279 lines, 35 unique work packages, six milestones with exit gates, architecture/model/edit contracts, local API/jobs, verification matrix, and risk/decision register.
- Preserved docs/PLAN.md without editing it.
- Large PowerShell write was rejected by the filesystem hook; a narrowly scoped apply_patch created the intended document successfully.
- Checked milestone/task structure and planning-file presence using Python assertions; all passed.
- Reviewed coverage against the original brief, including all media formats, correction controls, transitions, video transforms, karaoke, export presets, and save/reopen.
- git diff --check passed for tracked files. All newly created planning documents remain untracked.
- Planning phases complete. Product implementation M0-M5 remains pending. No app dependencies installed, runtime tests run, media rendered, commits made, or pushes performed.

## Implementation authorized: M0 in progress
- User requested step-by-step implementation using Ponytail/Caveman. Updated active task scope; retained existing master workspace and source brief.
- Verified actual Windows/Node/Python/hardware and official alignment/rendering documentation. Created isolated .venv and pinned Node dependencies/lockfile.
- Implemented minimal proof schema/time helpers, shared Remotion composition, Player page, original marker generator, attributed public-domain fixture, CPU alignment adapter, transcription cache, independent-annotation evaluator, and render/parity/audio verifier.
- First real ASR found faster-whisper/PyAV 19 incompatibility. Upstream-confirmed av==18.1.0 pin fixed decoding; real-decoder regression check added.
- Baseline hymn: 12/12 matched and word-timed lines, 11.221 seconds CPU/int8. Cached inaccurate variant: 12/13 matched, 0.110 seconds; unrelated line has no guessed timing.
- Rendered original 10-second marker MP4 and first 20 seconds of automatically aligned song. Both use the same component as Player.
- Passed 12 sampled pixel parity checks and encoded-frame lyric checks; measured marker pulses at 1.0000625, 5.0000625, 9.0000625 seconds. No accumulating drift observed on that fixture. No listening approval claimed.
- Created README.md, docs/technical-proof.md, and exact Python environment snapshot. Updated implementation work-package checkboxes with partial-gate boundaries.
- M1 is held by the plan's M0 gate: additional permissioned fixtures, independent manual annotations, correction-quality decision, peak-memory evidence, and listening review remain needed. Requested fixture path/language asynchronously while continuing independent work.
- Final verification: typecheck passed; 15 TypeScript tests and 10 Python tests passed; pip check passed; all 27 new text files passed whitespace check. Original brief remains 9520 bytes and was not edited.
- Probed song sample directly: H.264 1280x720, 30 FPS, 600 video frames; AAC stereo 48 kHz; container duration 20.011 seconds (audio padding), video duration 20 seconds.
- Started local proof server at http://127.0.0.1:5173/ (session 72908). Requested browser-panel opening of the aligned song; app returned queued.
- No commits, pushes, deployments, paid services, or public uploads performed. M0 remains in progress; M1-M5 pending.

## User fixture testing
- User supplied music/ as a temporary testing source and clarified production inputs: WAV/MP3 upload plus lyrics pasted in the UI.
- Preserved music/test.wav and lyrics.txt; copied audio into ignored proof storage and ignored music/ itself in Git.
- Fixed section headings being treated as sung lyrics using existing engine rules. Retained the full source text separately.
- Diagnosed coarse ASR segments exceeding engine pairing capacity: seven segments for 28 lyric lines produced only 15 valid matches.
- Reused recognized sentence punctuation and existing word bounds to split only overly coarse inputs. Actual cached result improved to 26/28 valid matches in 0.104 seconds; repeated choruses remain distinct. Two lines stay untimed rather than receiving invalid/guessed timing.
- Rendered artifacts/local.mp4 (first 20 seconds) in 23.545 seconds. Local browser smoke check passed; first timed line and two unmatched lines visible; no page errors. Visually inspected artifacts/local-preview.png.
- Rejected misleading external venv-launcher memory measurement. Actual Python worker now reports OS peak working set. Fresh ASR: 8.860 seconds, 354,197,504 bytes peak, 26/28 matches.
- Final checks: 15 Vitest and 15 Python tests pass; typecheck passes; git check-ignore confirms test music excluded. Original inputs remain unchanged.
- Local preview: http://127.0.0.1:5173/?fixture=local. App browser opening requested; queued. Production upload/paste UI remains planned, not falsely marked implemented.
- Independent line/word accuracy and listening review remain outstanding; M0 stays in progress and M1-M5 pending. No commits/pushes/public uploads.

## Other features authorized and delivered (2026-10-22 to 2026-10-23)
- User explicitly requested proceeding with other features despite open M0 manual review. Used Ponytail, planning-with-files, and frontend-design; worked in the existing workspace.
- Added local Fastify API, streamed/probed media imports, versioned Zod project schema, JSON persistence with revision conflicts/backup recovery, protected asset/range routes, identical-original repair, and durable serialized jobs.
- Built upload/pasted-lyrics workflow, real alignment with preserved manual corrections and explicit full replacement, line/word editing, untimed placement, split fragments, waveform, three-track timeline, pointer move/edge trim, keyboard/numeric controls, undo/redo, resizable panels, and responsive layout.
- Reused the shared Remotion composition for media clips, global/per-line styles, karaoke, video/image crop/scale/reposition, fades/crossfades, preset canvases, and full-duration snapshot MP4 exports.
- Added cancellation, actual Python process-tree termination and deadlines, interrupted-job restoration, stale-result protection, and capability refresh after local API restart.
- Corrected save/import/export handling of pending pasted lyrics so a project refresh cannot discard text. Added browser regression saving lyrics before audio upload.
- Verified 42 TypeScript and 15 Python tests, semantic/unused-code lint, typecheck, and production build. Actual browser test passes line/word edits, pointer drag, edge trim, per-line style, undo/redo, save/reopen, and downloaded MP4 with no page errors.
- Actual import fixtures pass all five formats. Four export presets and offered frame rates pass; decoded midpoint pixels prove crossfade blending. Real render cancellation prevents downloading partial output.
- Full supplied song rendered to 2,923 frames / 97.451-second container. Decoded audio correlation at 5/45/80 seconds gives zero measured offset. Marker parity still passes all 12 frames.
- Inspected desktop/narrow screenshots; strengthened UI text contrast and preserved focus/control behaviour. Build excludes proof audio; direct storage/music access is denied. User originals preserved.
- Updated README, implementation checklist, durable planning files, and docs/editor-implementation.md. M1-M3 and core visual/export features delivered; broad visual/performance/release checks and M0 accuracy/listening remain open.
- Development server remains running at http://127.0.0.1:5173/ (session 26369). No commits/pushes/deployment/public uploads.
