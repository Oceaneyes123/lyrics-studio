# Interactive Canvas Editor
## Goal
Implement the supplied C1â€“C5 canvas brief over the existing advanced editor without discarding local work.
## Phases
- [x] C1: Shared transforms, migration, coordinate mapping, renderer.
- [x] C2: Direct manipulation, inspector, history and persistence.
- [x] C3: Lyrics and standalone text.
- [x] C4: Selection, snapping, ordering, keyboard and zoom.
- [x] C5: Unit, browser and export parity checks.
## Decisions
Existing project schema is already V3; canvas changes require V4, retaining V1â€“V3 migration and permanent backups. No .codegraph directory exists. Existing local edits overlap all main integration points and must be preserved. No commits or pushes.
## Errors and resolutions
Resolved issues are recorded below.

- Typecheck during model extension: text union exposed media-only assumptions in audio processing, split/trim and renderer. Resolution: explicit media guards; keep text free of fake asset IDs.

- Existing font API tests exceeded their 5000 ms browser-launch timeout (2 tests); rerun with an explicit 30000 ms test timeout, without changing unrelated code.

- Browser drag/history passed; resize failed. First correction: pass a single HTMLElement to Moveable for one selection rather than a one-element group; record before/after screenshots to diagnose the actual control hit target.

- Moveable flushSync prop alone did not flush the parent preview state. Corrected at the actual setLive boundary with ReactDOM.flushSync and removed proxy borders from measured resize dimensions. Validate before claiming React 19 compatibility.

- First-drag selection enhancement retained a released pointer event and corrupted the next gesture origin. Added pointer-held tracking so deferred target setup starts only while the original pointer is down. Expanded browser verification caught the regression before delivery.

- Queued first-pointer selection still reused a stale gesture origin. Removed that optional enhancement completely: click selects, then drag manipulates via Moveable's own event lifecycle. This restores the verified interaction without a second custom gesture system.

- Mixed group drag produced no history entry. Capturing group overlay and alert state to distinguish a missed hit target from a rejected model mutation.

- Group drag and resize passed; failure was group rotation handle clipped above the viewport because the rotated title extended off-canvas. Moved rotation handle below selection and added viewport gutters so controls remain reachable near canvas boundaries.

- Source edits while the browser verifier was running caused Vite to reload the parity harness back to its default 1280x720 project. This produced oversized raw-frame output (ENOBUFS), not a renderer mismatch. Finish source edits before rerunning; bound raw-frame buffers explicitly and assert frame byte lengths.

- All six expanded media/text still comparisons passed. The real export API requires an imported song; added a generated three-second WAV fixture instead of bypassing production export validation.

- Screenshot inspection exposed green/GIF clips missing despite a broad parity pass: ensureVisualTrack assumed all visuals preceded lyrics. Standalone text above lyrics invalidated that assumption, causing new drops to reuse an existing track and the third drop to fail overlap validation. Fixed insertion after the last visual track and added count/asset/unique-track assertions for every actual import/drop.

- Lint identified findLastIndex outside the repository's ES2022 lib target. Replaced it with a standard reduce; no TypeScript target or dependency change.

- Legacy layered-background pixel test sampled a new selection handle at (4,4), not the video content. Screenshot evidence confirms the expected background beneath it. Updated only that verifier's screenshot styling to hide editor-only overlays. A redundant raw-binary PowerShell pixel probe was blocked by the filesystem hook; visual inspection sufficed, no unsafe command was retried.

## Final status
Complete on Windows/Chromium. Existing workspace changes preserved; no commits or pushes.

## Verification
- Lint/typecheck and production build pass (existing non-fatal Remotion directive/chunk notices).
- 126 TypeScript tests pass with --testTimeout=30000, including V1–V3 migration/backups and new canvas contracts.
- test:canvas passes single/group pointer transforms, text/media editing, locks, selection, history, zoom, autosave/reopen, three distinct imported media layers, six landscape/portrait still comparisons and encoded MP4 placement.
- Player/renderStill mean channel error: 0.099–0.107 / 255. Decoded H.264 frame mean channel error: 1.779 / 255, including compression.
- test:timeline passes legacy migration, locks, clipboard, ripple, history and persistence.
- test:backgrounds passes GIF seeking/looping, layered crossfades, movement, save/reopen and MP4 pixel checks. Editor-only overlays are excluded from composition screenshot sampling.
- git diff --check passes.

## Deliberate limits
Canvas controls operate on static layout boxes; existing effect/keyframe motion can extend beyond the box. Standalone text keyframes are deferred as requested for the initial static canvas release. Large-project stress benchmarks and cross-platform rendering were not checked. Existing default font API tests can exceed 5s browser-launch time; the explicit 30s timeout is documented.

## Artifacts
- docs/interactive-canvas.md
- artifacts/canvas/editor.png
- artifacts/canvas/export.mp4
- artifacts/canvas/report.json
