# Lyrics Studio

Local lyric-video editor: upload a song, paste lyrics, align/correct timing, layer media, mix audio, animate lyrics, and export MP4. Media and projects stay on this computer. Automatic singing alignment needs human review. See [advanced controls and verification](docs/advanced-editor.md), [original MVP evidence](docs/editor-implementation.md), and [advanced roadmap](docs/ADVANCED_IMPLEMENTATION_PLAN.md).

## Prerequisites

Verified on Windows 11 with Node 24.6.0, npm 11.5.1, Python 3.13.5, and FFmpeg/ffprobe on PATH. Other platforms are not verified. Python packages install into this project's `.venv`; global packages are not changed.

```powershell
npm ci
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r services/lyric-alignment/requirements.lock.txt
```

The direct requirements file explains the PyAV compatibility pin. The lock captures the actual tested Python environment. All Remotion packages use the same exact version.

## Run the editor

After installing the prerequisites above:

```powershell
npm run dev
```

Open [Lyrics Studio](http://127.0.0.1:5173/). The command starts frontend 5173 and local API 3001; Ctrl+C stops both. Create a project, upload WAV/MP3, paste lyrics, and choose Align to song. Review/apply matches, correct line and word timing in the inspector, add image/video backgrounds, and export MP4. The music/ folder is only a test fixture.

The editor supports unified tracks, grouped multi-selection, clipboard/ripple editing, simultaneous audio mixing, waveform word handles, loop/speed/tap synchronization, keyframes, imported fonts, copied templates, transitions, filters/masks/background blur, and optional ducking/normalization. Preview and export share rendering and processed audio. Save/autosave retain schema-3 projects under storage/projects/; older versions migrate on read and keep permanent version-specific backups on first save. Reopen projects from the header; repair requires identical originals.

See [detailed controls, recovery, limits, and verification](docs/editor-implementation.md). Automatic timing remains review-required; unmatched lines are never given invented times. Alignment currently requires the original untrimmed song, and only English quality has been exercised. No public deployment is configured.

MVP evidence, known limits, and reproducible checks are tracked in [acceptance-review.md](docs/acceptance-review.md): `npm run test:alignment:acceptance`, `npm run test:visual`, and `npm run benchmark:editor`. Run the visual/performance harnesses sequentially with ports 5174/3002 free. Acceptance audio uses the local permissioned test song; optional annotation files require independent human measurements.

With the editor running:

```powershell
npm run lint
npm run typecheck
npm test
npm run test:alignment
npm run build
npm run test:editor
npm run test:media
npm run test:full-export
node scripts/python.mjs scripts/check-audio-sync.py music/test.wav artifacts/editor/full-song.mp4
```

Browser checks create local verification projects and ignored screenshots/MP4s under artifacts/editor/. The full-export test uses the most recent editor-verification project. Lint uses TypeScript semantic/unused-code checks. Builds exclude development proof audio; the local dev server denies direct storage/music file access.

## Legacy M0 proof

```powershell
# Original timing pulses plus the attributed public-domain example song (~3 MB).
npm run proof:prepare

# First run downloads small model weights (~500 MB); CPU/int8 processing is local.
# Transcription is cached separately, so lyrics-only edits can reuse it.
npm run proof:align

# Open the URL printed by Vite. Add ?fixture=alignment for the real song.
npm run dev:proof
```

The default Player shows original marker text with known timings. The alignment fixture plays the complete downloaded song with automatically matched lyrics; all automatic timing is flagged for review. Unmatched lines remain listed without invented times. The proof uses a single audio clock and a local Inter font.

This proof has no project editor, manual correction controls, backend API, persistence UI, or full export UI yet.

### Project-local test song

The user-provided music/ folder is a temporary testing fixture and is ignored by Git. It is not an application input convention. The planned user flow is **upload a WAV/MP3 and paste lyrics into the UI**.

To reproduce this local test without modifying the originals:

```powershell
Copy-Item -LiteralPath music/test.wav -Destination .cache/proof/local-song.wav
node scripts/python.mjs -X utf8 services/lyric-alignment/align.py .cache/proof/local-song.wav music/lyrics.txt .cache/proof/local.project.json
npm run proof:render -- local
```

Open `http://127.0.0.1:5173/?fixture=local` while the proof server runs. Section headings are excluded from sung-line matching, while the full source text remains saved. Alphabetic lyrics match the complete recognized word sequence, independently of segment boundaries. Karaoke uses recognized word boundaries, including pauses. Missing or zero-duration words require manual correction rather than invented karaoke timing; the inspector explains these partial matches. CJK lyrics retain character-based matching. Unmatched or invalid/overlapping results remain untimed and visible.

## Verify and export

Stop the development server before verification if it occupies the verification port (5174).

```powershell
npm run typecheck
npm test
npm run test:alignment
npm run proof:render
npm run proof:verify
npm run proof:render -- alignment
```

Font validation and rendering use Remotion's Chrome Headless Shell; first use may download it (~120 MB). Proof rendering produces `artifacts/marker.mp4` (10 seconds) or `artifacts/alignment.mp4` (first 20 seconds). These are evaluation samples. The verifier checks marker H.264/AAC output, audio pulse offsets, Player/renderStill pixel parity, and encoded-frame lyric visibility. It creates screenshots and `artifacts/verification.json` and closes its browser/server afterward. It does not perform listening approval or singing-accuracy measurement.

Generated media, caches, model-independent transcription, and artifacts are ignored by Git. Do not place private media in the proof public directory while serving it to anyone else; this development-only harness is not the M1 protected media API.

## Measure alignment quality

Independent manual annotations must use the exact fixture, line IDs, and original text. Do not use the engine's own output as ground truth. Annotation JSON shape:

```json
{
  "lines": [
    {
      "id": "line-1",
      "text": "Exact original lyric text",
      "startMs": 1000,
      "endMs": 3000,
      "words": [
        {"text": "Exact ", "startMs": 0, "endMs": 400},
        {"text": "original ", "startMs": 400, "endMs": 800},
        {"text": "lyric ", "startMs": 800, "endMs": 1200},
        {"text": "text", "startMs": 1200, "endMs": 2000}
      ]
    }
  ]
}
```

Numbers above illustrate the format only; they are not measurements. Word times are relative to each manually annotated line. Run:

```powershell
node scripts/python.mjs services/lyric-alignment/evaluate.py .cache/proof/alignment.project.json path/to/manual-annotations.json
```

The evaluator reports coverage and median/p95 boundary errors only for annotated lines. Missing predictions reduce coverage; they do not receive invented errors. Mismatched word tokenization is reported as unscored, not silently compared.

## MVP status

All 32 retained MVP work packages are delivered. The user removed independent annotation/accuracy and listening-review tasks from scope. Those measurements remain unverified; removal does not imply quality approval.

The next-phase [advanced implementation plan](docs/ADVANCED_IMPLEMENTATION_PLAN.md) covers unified tracks, audio mixing, visual lyric timing, keyframes, text templates, transitions/effects, and later ducking/normalization. Its 36 new work packages are planned, not implemented; they do not reopen the completed MVP checklist.

## Sources and licensing

- Alignment engine: [ijuinryukichi/lyric-align](https://github.com/ijuinryukichi/lyric-align), MIT; [upstream NOTICE](https://github.com/ijuinryukichi/lyric-align/blob/main/NOTICE) explicitly identifies the Amazing Grace exception. Other upstream lyric fixtures were not copied.
- Song: Southern Aire / United States Air Force Reserve Band, *Amazing Grace*, from *Glorious Past, Boundless Future* (2002). [Wikimedia file attribution and public-domain designation](https://commons.wikimedia.org/wiki/File:Amazing_Grace_(vocalist_with_guitar)_-_Southern_Aire_-_United_States_Air_Force_Reserve_Band.mp3).
- Font: Inter, distributed through @fontsource/inter under OFL-1.1; license retained in the installed package.
- Remotion: [official license](https://www.remotion.dev/docs/license). This proof is evaluation use. Future commercial eligibility depends on the applicable terms; no paid license was purchased and no free-license eligibility was declared.
