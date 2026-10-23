# Progress

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
