# Findings

- Repository initially contains .git and docs only; no .codegraph directory.
- docs/PLAN.md is the source brief. docs/ is already untracked; preserve its contents.
- No existing planning files or named plans were found.
- No project-specific memory matches were found.

## Source brief analysis
- Source: docs/PLAN.md (11 sections, milestones 0-5).
- Required stack: React/TypeScript/Vite, Fastify, Python alignment, shared Remotion preview/rendering, local JSON/media.
- Core requirements include manual line AND word correction, progressive karaoke, video crossfade, crop/scale/reposition, undo/redo, and portrait/landscape export.
- No package manifest, application, tests, lockfiles, or existing architecture exists yet.
- Alignment package identity/API/license/hardware compatibility and runtime versions are not established by the brief; these are proof-of-concept gates, not confirmed facts.
- Critical unresolved semantics: clip-relative word timing during trims/splits, treatment of unmatched lyrics, background audio policy, crossfade overlap, stale job results, and interrupted saves/jobs.
- Planning will retain all required MVP behavior, sequence the risks first, and distinguish proposals from verified implementation.

## Final planning decisions
- Detailed roadmap: docs/IMPLEMENTATION_PLAN.md, with 35 work packages across M0-M5 and a source-requirement acceptance matrix.
- Clarified split lyric fragments with source-line/token coverage so delete and rerun operations do not duplicate or lose source lines.
- Proposed single-song audio, initial non-overlapping lyrics, FPS choices, and alignment-quality thresholds are explicitly provisional.
- Kept exact dependency selection and singing-alignment feasibility behind the M0 gate. No current compatibility claims were made.
- First implementation task is runtime/hardware/engine verification, followed by one permissioned aligned/rendered sample.

## M0 implementation discovery
- User authorized local step-by-step implementation and requested Ponytail/Caveman.
- Runtime inventory: Node 24.6.0, npm 11.5.1, Python 3.13.5, Ryzen 7 3700X, GTX 1650 SUPER. FFmpeg/ffprobe are on PATH. Current branch is master; no code or CodeGraph index exists.
- Registry currently offers Remotion 4.0.537, lyric-align 0.4.2, faster-whisper 1.2.1. Global faster-whisper 1.1.0 exists but will not be modified.
- Identified ijuinryukichi/lyric-align as the candidate matching the brief's faster-whisper and unmatched-line behavior. Its core has no dependencies; ASR is optional. Another similarly named project exists, so package identity must remain explicit.
- Upstream provides a public-domain Amazing Grace recording/example. This can validate baseline behavior without awaiting private audio; representative corpus still needs additional fixtures.
- Remotion's official license permits evaluation. Do not assume future commercial eligibility; no license purchase or eligibility declaration is authorized.
- Remotion Player consumes the shared component directly; Renderer accepts a local bundle and identical input props.
- Two compound read-only hardware commands were blocked by a filesystem hook. Use narrower inventory commands; no system/disk modifications are needed.

Sources: https://github.com/ijuinryukichi/lyric-align ; https://www.remotion.dev/docs/license ; https://www.remotion.dev/docs/renderer/render-media ; https://www.remotion.dev/docs/bundle

- Verified hardware via CIM: Windows 11 Pro 10.0.26200, 51,482,046,464 bytes RAM, ~269 GB free on D:, GPU reports ~4 GB adapter memory. NVIDIA query was blocked; no CUDA readiness claim.
- Read upstream engine model/CLI/ASR: align(), auto_pairing(), Segment/Word dataclasses; per-character karaoke timing; faster-whisper CPU/int8 support; no-vad recommended upstream for sustained singing.
- Public-domain example: Amazing Grace, Southern Aire / US Air Force Reserve Band, linked by the engine README. Baseline sample alone is not the full corpus or manually annotated ground truth.
- Created minimal M0-only Node manifest and isolated Python requirements; installation in progress. No full editor scaffold yet.

## M0 first checks
- Node install succeeded with zero reported audit vulnerabilities; Python environment imports engine and ASR successfully and pip check passes.
- 15 TypeScript tests and five Python contract tests passed, including repeats, exact original whitespace/punctuation, unmatched lines, bounds, and token-mapping failures.
- Downloaded the public-domain upstream recording and generated an original 10-second three-pulse timing fixture.
- First real transcription exposed an actual dependency mismatch: faster-whisper 1.2.1 calls av.open(metadata_errors=...), rejected by newly resolved PyAV 19.0.2. Pin and verify a compatible PyAV release before rerunning.
- Automatic character-derived word timing is interpolated by this engine. This is explicit in the adapter; real singing accuracy remains unmeasured.

## Real baseline results
- Upstream confirms the PyAV 19 incompatibility in faster-whisper issue #1589. Pinning av==18.1.0 resolved actual decoding; no installed-library monkey patches were used.
- Public-domain baseline CPU/int8 base.en run: six transcription segments, 12/12 matched lines, 12/12 word-timed lines, 11.221 seconds. This is match coverage, not accuracy or manual correction burden.
- Baseline audio SHA-256: 834b463be93a8b19d05a72e94c429ab3618691aeb593869f603f58d22a8c7676.
- Original 10-second marker export succeeded: 1280x720, 30 FPS, 300 frames, 54.336 seconds including first Chromium setup. Actual preview/export frame comparison is running.
- Installed local PyAV pin and isolated environment leave global Python packages unchanged.

Compatibility source: https://github.com/SYSTRAN/faster-whisper/issues/1589

## Rendering and visual verification
- Marker Player versus renderStill: identical decoded pixels in the comparison region at frames 29, 30, 47, 59, 60, 89, 90, 149, 150, 269, 270, and 299. Player transport controls are excluded from the video-region comparison.
- Marker MP4 probe: H.264 video, AAC audio, 1280x720 at 30 FPS. Pulse onsets 1.0000625, 5.0000625, 9.0000625 seconds: constant ~0.063 ms offset, no measured accumulating drift on this 10-second fixture.
- Visually inspected preview frame 47: centered text, first word highlighted, readable local Inter font, Player transport visible below the compared region.
- Song sample exported successfully: first 20 seconds / 600 frames, 22.729 seconds rendering time. Full 130.304-second song export is intentionally outside this M0 sample.
- Real inaccurate-text variant: 12/13 matched; appended unrelated line remains untimed with empty word list. Transcription cache reused; total adapter time 0.110 seconds.
- A verification locator initially waited for visibility of an intentionally empty lyric element. Changed to attached-state wait; all sampled frames passed. This was a harness failure, not video behavior.

## User-provided local fixture
- User identified project music/ as temporary test input. Production flow remains user WAV/MP3 upload plus pasted lyrics in the UI; do not hard-code the music folder into app behavior.
- Found music/test.wav (97.431 seconds, PCM16 stereo 48 kHz) and English lyrics.txt with repeated chorus and section headings.
- Existing adapter incorrectly treated section headings as sung lines. Reuse the installed engine's section-marker rules, preserve full source text separately, and add a focused regression test.
- Preserve original music files and ignore the fixture folder in Git. Create a separate local proof fixture without replacing the public-domain baseline.
- First local ASR: seven segments for 28 lyric lines, 15 valid matches in 9.132 seconds. Actual transcription contains the verses and repeated choruses, but engine auto-pairing is capped at three lines per segment; coarse ASR segmentation misgroups this input.
- Offline experiment splitting ASR segments only at recognized sentence punctuation (using existing word timestamps) yielded 27 sentence segments and 26/28 valid matches. This is a data-shape correction behind the same engine, not invented timestamps or proof of independent timing accuracy.
- Applied sentence segmentation only when lyric-line/ASR-segment ratio exceeds the engine's auto-pairing cap. Original transcription cache remains intact.
- Local cached run: 26/28 matched and word-timed, 0.104 seconds. First 'Jump around and dance with me!' is rejected for overlapping/invalid engine timing; 'Sing along to happy tunes!' has no engine match. Neither receives invented timestamps.
- Browser smoke check passed for ?fixture=local: first timed lyric visible, two unmatched lines listed, no page errors. Screenshot: artifacts/local-preview.png.
- Verified source WAV hash unchanged and full original lyrics (including section headings) retained in sourceLyrics; section markers are excluded only from sung-line matching.
- Visually inspected artifacts/local-preview.png: first supplied line visible with karaoke fill; two unmatched lines explicitly listed. Local 20-second render succeeded in 23.545 seconds.
- External process sampling captured only the Windows venv launcher (4.11 MiB), not the actual worker; reject that result. Add standard Windows process-memory reporting inside Python and measure the real ASR worker.
- Real fresh local ASR with worker-internal measurement: 26/28 valid lines, 8.860 seconds, peak working set 354,197,504 bytes (~337.79 MiB). Model weights were already downloaded.
- Final focused checks passed: 15 TypeScript tests, 15 Python tests, and typecheck. Local-song preview and 20-second export are available; M0 accuracy/listening gate remains open.

## Editor feature implementation
- User explicitly requested proceeding with other features; this supersedes waiting on M0 manual review. Accuracy remains an explicit limitation.
- Scope reaches shared schema, edit commands, composition, local API/storage/jobs, UI/timeline, startup/config, and focused tests. Existing M0 fixtures/routes must continue working.
- Design: a compact studio workbench, muted blue-grey panels (#e8edf2/#f8fafc), ink text (#243144), violet selection (#6654c7), amber review state (#ae6b13), and charcoal canvas (#17212d). Inter for controls, clear numeric timing, waveform/time ruler as the dominant structural element. No marketing hero or decorative cards.
- Reuse the shared Remotion component and existing Python adapter. Use validated schemas and local JSON/media, no database/cloud or new renderer.
- Implemented versioned editor schema, pure timeline commands, local storage/revision checks/backups, validated media imports/range serving, serialized alignment/export jobs, and the main editor UI.
- Main route now opens the editor; ?fixture=local/marker/alignment retains proof access. User media remains under ignored local storage.
- First typecheck exposed Fastify's unknown error type; narrowed it explicitly. Typecheck and existing 15 proof tests now pass.
- Native pointer events implement the small timeline gesture surface; keyboard and numeric edits remain available. The same Remotion composition now handles editor audio clips, backgrounds/transforms, styles, fades, and karaoke, preserving proof defaults.
- Focused checks: 32 TypeScript tests (model/history/API/jobs/proof), typecheck, and Vite production build passed. Build reports the vendor Player chunk >500 kB and a non-fatal use-client directive notice.
- Real browser run imported user WAV, pasted sectioned lyrics, aligned/applied 26/28 results, changed a line start to 3 seconds, saved, and exercised undo/redo. Export harness initially selected an externally created project without refreshing its project list; reload before selecting that test project.
- Actual API export completed successfully, but writing its bundle under .cache triggered a development page reload. Fixed watcher exclusions and added persisted project-job restoration on reopen. Job metadata writes now serialize to prevent progress callbacks racing final state.
- Full browser flow now passes: upload, pasted lyrics, actual cached alignment, timing edit, pointer drag/undo, per-word edit/redo, save/reopen, export acknowledgement/download, 10-second H.264/AAC export, and narrow viewport screenshot. No browser page errors.
- Real import/export fixtures passed all five formats (WAV, MP3, PNG, JPG, MP4), all four resolution/orientation presets, and offered FPS choices (24/25/30). Decoded corners verify image and video output; real export cancellation returns cancelled and blocks result download.
- Added identical-original media repair with hash checks; a failed repair must never delete existing assets. Added stale project-save and alignment-result protections, proper nested-overlap validation, and regression tests. Current unit/API count: 37, plus 15 Python tests.
- Production builds exclude development proof fixtures. Vite denies direct storage/music access; media flows through the protected API. Removed unused Immer/dnd-kit dependencies because native pointer gestures and the existing pure commands suffice.
- Full-song export succeeded: 2,923 frames, 97.451-second MP4 container (97.433-second video plus AAC padding), 30 FPS. Long-run decoded audio comparison is next.
- Legacy marker parity passed again after routing its verifier to ?fixture=marker: all 12 sampled decoded regions remain pixel-identical and marker pulse offsets unchanged.
- Found and corrected a draft-lyrics loss path: Save/import/export now applies pending pasted text before persisting/refreshing project state. Added browser regression for saving pasted lyrics before audio upload.
- Full-song decoded audio comparison: zero measured offset at 5, 45, and 80 seconds (8 kHz analysis), correlations 0.99996/0.99993/0.99991. No measured accumulating drift; this is not listening approval or a lyric-accuracy claim.
- Reviewed narrow viewport screenshot: panels stack without horizontal page overflow; timeline remains horizontally scrollable. All media/lyrics, preview, correction, styling, and export controls remain reachable.
- Actual Python process-tree cancellation and deadline tests passed. A filesystem failure-injection test needed a Vitest module mock because native ESM exports cannot be spied on directly.
- Final browser run passes per-line style persistence and edge trimming in addition to prior flow. Latest counts: 42 TypeScript and 15 Python tests. Final media run also verifies a blended crossfade midpoint at every preset.
- Full render elapsed time cannot be reconstructed from job metadata file mtime because startup rewrites historical job records; do not report that derived value as render performance. Full export duration/frame count and audio synchronization are verified independently.
- Delivered usage, recovery, constraints, evidence, and remaining release checks in docs/editor-implementation.md and README. Broader visual/font/performance QA remains explicitly unchecked in the roadmap.
- Visually reviewed workbench screenshot: media/lyrics left, preview and line review center, timing/style inspector right, waveform and three tracks below. No clipped primary controls at desktop size; narrow view remains to be verified.
