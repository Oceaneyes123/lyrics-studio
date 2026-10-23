# Editor implementation and verification

Session: 2026-10-22 through 2026-10-23, Asia/Manila.

## Delivered

The main route now runs a local editor. It supports song upload and pasted lyrics, media library, saved/reopened projects, alignment jobs, editable line/word timing, timeline move/trim/split/delete, snapping/zoom, undo/redo, waveform, global/per-line styles, background video/images, transforms/fades/crossfades, canvas presets, and background MP4 exports with cancellation/download.

The user explicitly authorized proceeding beyond the M0 review gate. That permits implementation; it does not convert missing manual alignment measurements or listening review into passes.

## Using the editor

1. Run npm run dev and open http://127.0.0.1:5173/. Create a project, upload WAV/MP3, and paste lyrics. The music/ directory is a temporary test fixture, not an app convention.
2. Save retains pasted text, including section headings. Align to song creates a background job. First use may download about 150 MB of model weights. English uses base.en; other offered languages use base and have not been quality-validated here.
3. Apply matches preserves existing manual corrections. Replace all timing explicitly replaces them after confirmation; Undo restores the prior clips. Untimed/rejected lines stay visible.
4. Select a line and edit its start/end or clip-relative word times. Place an untimed line at the playhead. Space words evenly creates approximate manual timing; review/correct it by ear.
5. Drag clips to move; drag edges to trim. Numeric controls and Arrow keys are alternatives. Shift+Arrow moves one second. Zoom changes scale; Alt bypasses snapping. Split at playhead splits media non-destructively or lyrics between words.
6. Drag imported MP4/JPG/PNG/GIF media onto a numbered visual layer to add it at the drop time. Drop onto + Layer to create a new layer, or click the media's ＋ button to add it on a new top layer at the playhead. Drag existing clips horizontally to change time and vertically to change layer; clip duration is preserved. Higher layers appear above lower ones; lyrics stay above the visual stack. Edit layer, opacity, source trim, duration, crop-to-fill/fit, scale, position, and fades in Clip properties. GIFs loop with timeline-synced animation in preview and MP4 exports; GIF preview requires a browser with WebCodecs ImageDecoder support, such as Chrome or Edge. Overlap two clips on the same layer and fade in the later clip for a crossfade. Embedded video audio is muted.
7. Set font, size, colors, outline, shadow, alignment, position, fades, and karaoke. Style scope chooses project defaults or one selected line; Use project style removes its override. Inter is bundled; Georgia/Arial use the same machine's installed fonts.
8. Deselect with Project to choose portrait/landscape, 720p/1080p, and 24/25/30 FPS. Export saves an immutable snapshot. Unreviewed timing and omitted untimed lyrics require explicit acknowledgement. Download appears only after successful H.264/AAC rendering.

Space toggles playback outside focused controls/text fields. Ctrl/Cmd+Z undoes; Shift+Ctrl/Cmd+Z redoes. Preview, timeline, and waveform follow the Player clock. Side panels resize using their bottom corners on desktop; narrow layouts stack panels.

## Saving and recovery

- Explicit Save and debounced autosave store JSON in storage/projects/<projectId>/. Save/import/export applies pending pasted text; until then, the header identifies unsaved lyrics.
- Imported media is copied into the project's assets directory. Originals remain unchanged. Deleting a clip never deletes source media.
- Saves use revision checks, atomic replacement, and project.json.bak. Stale writes are rejected while edits remain in the tab. If the main document is corrupt, reopen the valid backup and Save to repair it. Future schemas are never downgraded.
- Back up the whole project directory, including assets. JSON alone does not contain media.
- Missing media is reported. Repair requires the identical original content hash; wrong files are rejected without deleting existing media.
- Jobs persist separately in storage/projects/.jobs/. Reopening a project restores recent job status. Jobs interrupted by restart can be retried; checkpoint resume is not implemented.
- Cancellation stops the process/render operation. Alignment has a 30-minute deadline. The editor refreshes expired local capabilities once after API restart so saves can retry without discarding edits.

## Implementation choices

- One root Node package owns apps/web, apps/api, and shared packages. Python stays isolated in .venv. One npm run dev starts both local services.
- Fixed Audio, Video, and Lyrics arrays represent the three MVP tracks. No generic track framework, database, cloud queue, or independent Python HTTP service was introduced.
- Existing proof timing helpers and the same Remotion component power preview/export. The editor adds registered asset URLs, clips, transforms, and validated styles; proof defaults remain compatible.
- Native pointer controls implement the small timeline surface; numeric/keyboard controls provide alternatives. Unused dnd-kit/Immer dependencies were removed. Scoped CSS avoids a new styling framework.
- Zod validates persisted/editor inputs; Fastify/multipart handle the local API and streamed imports; Zustand owns history. Player owns playback; WaveSurfer never starts independent playback.
- Filesystem operations use bounded IDs, canonicalized paths, revision checks, atomic replacement, and last-good backup recovery. Media repair checks SHA-256.
- One durable queue serializes alignment/export. Cancellation, deadlines, interrupted-job recovery, snapshot exports, and stale-result guards protect newer edits. Automatic reruns preserve manual fragments and per-line styles by default.

## Verification evidence

| Check | Result |
|---|---|
| Strict typecheck and semantic/unused-code lint | Passed |
| TypeScript unit/API/lifecycle suite | 42 tests passed |
| Python alignment/evaluation suite | 15 tests passed; existing worker logic retained |
| Vite production build | Passed; vendor size/use-client notices are non-fatal |
| Actual editor browser journey | Upload, pasted lyrics, real alignment, timing correction, pointer move, undo/redo, word edit, save/reopen, and MP4 download passed |
| Imported media | Actual WAV, MP3, PNG, JPG, MP4 fixtures passed |
| Export presets | 1280x720 at 24 FPS; 1920x1080 at 25 FPS; 720x1280 and 1080x1920 at 30 FPS passed |
| Backgrounds | Decoded pixels confirm imported image/video output; media verifier also checks the crossfade midpoint |
| Cancellation/restart | Real Python process-tree cancellation/deadline, real render cancellation/result gating, queued cancellation, and persisted interrupted-job recovery passed |
| Save failures | Concurrent stale writes rejected; simulated ENOSPC replacement failure preserves valid JSON; corrupt main file recovers backup; future schemas rejected |
| Repair | Wrong-content repair rejected without deleting originals; identical content restores missing media without duplicating assets |
| Full-song render | 2,923 frames at 30 FPS; 97.451-second H.264/AAC container including padding |
| Long-run decoded audio | Zero measured offset at 5, 45, 80 seconds at 8 kHz; correlations 0.99996, 0.99993, 0.99991 |
| Retained proof parity | All 12 sampled marker regions remain pixel-identical; encoded boundary visibility and pulse checks pass |
| Data boundary | Direct project JSON/music-file requests denied; production build contains no WAV/MP3 fixture files |
| Visual checks | Desktop/narrow stacked layouts inspected; panels and controls remain reachable |

Runtime artifacts: artifacts/editor/verification.json, workbench.png, narrow.png, export.mp4, full-export.json, full-song.mp4, and media/verification.json. Proof artifacts remain under artifacts/parity/ and artifacts/verification.json. These stay local and ignored by Git.

## Limits and remaining acceptance

- One song track with sequential clips; no simultaneous mixing. Alignment requires one complete original song clip. Align first, then edit audio; restore the original clip before realigning.
- Upload limits: 500 MB, audio/video up to one hour, frames/images up to 16 megapixels. These are bounded input limits, not tested maximum-workload guarantees.
- Up to 500 visual clips across numbered layers, with at most two simultaneous clips per layer for crossfades; lyric clips cannot overlap. Existing projects default to fully opaque Layer 1. Invalid timing is rejected. Trimming away words retains source text and clears incomplete word timing for correction.
- The 26/28 automatic result is coverage only. Two lines need manual correction. Independent median/p95 singing-boundary error, correction burden, and listening approval remain open. Audio correlation proves transport synchronization, not lyric alignment accuracy.
- Offered multilingual models are not quality-validated. Unsupported codec variants, actual disk exhaustion, maximum-size workloads, custom fonts, and non-Windows platforms remain unverified.
- M1-M4 feature slices are delivered. M5 core export and focused recovery checks are delivered; broader performance/release acceptance remains open. No deployment, commit, push, paid service, or public media upload occurred.
