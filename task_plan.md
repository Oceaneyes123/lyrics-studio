# Task Plan: Lyrics Studio implementation

## Goal
Implement docs/IMPLEMENTATION_PLAN.md in dependency order, starting with real alignment and rendering proof.

## Next Step
Core editor features and focused export/recovery checks are delivered. Remaining work: independent singing accuracy/listening review, broader Unicode/font and visual-parity cases, maximum-workload profiling, and release acceptance.

## Current Phase
Core editor delivered; broader M0/M4/M5 quality/release acceptance remains open. User authorization to proceed did not imply listening or accuracy approval.

## Phases
### Phase 1: Requirements and discovery
- **Status:** complete
### Phase 2: Detailed roadmap and technical contracts
- **Status:** complete
### Phase 3: Coverage review and delivery
- **Status:** complete
### M0: Technical proof
- **Status:** in_progress
### M1: Editor foundation
- **Status:** complete
### M2: Timeline editing
- **Status:** complete
### M3: Automatic lyrics and correction
- **Status:** complete
### M4-M5: Core visual/export features delivered; broader acceptance
- **Status:** in_progress

## Decisions Made
- Preserve docs/PLAN.md as the original brief; create docs/IMPLEMENTATION_PLAN.md as its detailed expansion.
- Use root planning files because no named plan or explicit environment selector exists.
- Keep implementation milestones pending; completing planning does not mean the product exists.
- Treat engine/package/runtime compatibility as unverified until Milestone 0 produces evidence.

## Errors Encountered
| Error | Attempt | Resolution |
|---|---|---|
| Optional environment selector lookup returned exit 1 because variables are unset | 1 | Confirmed no named plans exist; use root planning files |
| PreToolUse hook blocked the large PowerShell document write as filesystem modification | 1 | Created only the intended Markdown file using a narrowly scoped apply_patch; succeeded |
| Compound read-only hardware inventory commands blocked by filesystem hook | 1-2 | Use narrower commands; inventory needs no disk/system changes |
| NVIDIA query command blocked by hook | 1 | Read adapter details through CIM instead; CUDA support remains untested |
| Guessed upstream pipeline.py returned HTTP 404 | 1 | Read published CLI/model/asr modules instead |
| Upstream source printing failed under cp1252 | 1 | Use Python UTF-8 mode for Unicode documentation |
| Real ASR failed: PyAV 19.0.2 rejects metadata_errors used by faster-whisper 1.2.1 | 1 | Investigate and pin compatible PyAV; do not count imports/pip check as runtime compatibility proof |
| PyAV compatibility resolution | 2 | av==18.1.0 passed real CPU transcription (12/12 baseline line matches) |
| Parity harness visibility timeout on intentionally empty lyric element | 1 | Wait for attached frame marker instead; 12 sampled frames passed |
| Compound ffprobe metadata command blocked by filesystem hook | 1 | Use the existing structured Node probe in proof verification |
| External peak-memory sample tracked the Windows venv launcher instead of actual worker | 1 | Reject the 4.11 MiB result; query worker process memory inside Python |
| Editor typecheck: Fastify error handler receives unknown | 1 | Narrowed status/message access; typecheck passes |
| Editor end-to-end harness could not select an externally created project absent from its cached list | 1 | Reload list before opening that test project |
| Vite reported a page reload when export bundle files were written | 1 | Ignore generated/cache/storage/media paths in the dev watcher; restore project job status on reopen |
| Legacy parity verifier opened the main route after it became the editor | 1 | Use the retained ?fixture=marker route |
| Semantic lint found an unused Project type import | 1 | Removed the unused import |
| Pasted-text browser regression compared DOM LF against the fixture's CRLF bytes | 1 | Normalize only expected browser input line endings; original fixture stays unchanged |
| Failure-injection test could not spy on an immutable native ESM export | 1 | Mock the filesystem module through Vitest's module mock factory |
| Documentation patch tried delete/add operations on the same path | 1 | Update README in place and add the evidence document separately |

## Historical planning verification
- Reviewed the source requirements against the roadmap acceptance matrix.
- Structural check passed: 35 unique work packages and six milestone exit gates.
- All three persistent planning files exist; original PLAN.md was not edited and its size remains 9520 bytes.
- git diff --check passed for tracked changes; new planning documents are untracked, so structural checks cover those files separately.
- No runtime tests or dependency compatibility checks performed: this task creates planning documents only.

## M0 verification
- Final check: TypeScript typecheck, 15 Vitest tests, 10 Python tests, pip check, and new-file whitespace checks all pass.
- Actual CPU ASR succeeds after pinning PyAV 18.1.0; 12/12 hymn lines have review-required timestamps.
- Real inaccurate-text variant retains its extra line without timestamps and reuses cached transcription.
- Marker and 20-second song MP4 samples rendered successfully.
- Twelve sampled Player/renderStill frames have identical compared pixels; decoded MP4 lyric visibility and foreground differences passed.
- Marker audio has constant ~0.063 ms offset and no measured drift over ten seconds.
- Independent singing accuracy, representative corpus, peak memory, and listening review remain outstanding; M0 is not complete.
- Proof preview runs at http://127.0.0.1:5173/?fixture=alignment (development session 72908). Browser-panel open was queued by the app; no claim that the user viewed it.

## Editor verification (2026-10-23)
- 42 TypeScript tests and 15 Python tests pass; semantic/unused-code lint, typecheck, and production build pass.
- Actual browser flow verifies pasted-text persistence before upload, 26/28 alignment results, line/word edits, per-line style, pointer movement, edge trim, undo/redo, save/reopen, and MP4 download without page errors.
- Actual imports: WAV/MP3/MP4/JPG/PNG. Four resolution/orientation presets and 24/25/30 FPS exported; decoded pixels verify image/video and crossfade midpoint.
- Full 97-second song exported as 2,923 frames; decoded audio has zero measured offset at 5/45/80 seconds. Manual listening and independent lyric accuracy remain unverified.
- Recovery/security checks cover stale writes, failed replacement writes, valid backup recovery, future-schema rejection, original-only media repair, local capabilities, cancellation, and interrupted jobs.
- Main editor: http://127.0.0.1:5173/ (development session 26369). Legacy proof remains under ?fixture=local/marker/alignment.
- Detailed scope and limits: docs/editor-implementation.md. No commits, pushes, deployments, or public media uploads.

## Scope
The user's latest instruction explicitly authorizes proceeding with other features while M0 quality evidence remains outstanding. Preserve the source brief, test assets, existing proof routes, and unrelated files. No commits, pushes, deployments, paid services, or public uploads.
