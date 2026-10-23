# M0 technical proof: execution record

Date: 2026-10-22. Status: **in progress; M1 gate has not passed**.

## Scope and decision

Implemented a minimal local alignment adapter, shared Remotion Player/Renderer composition, reproducible fixtures, and runnable verification. No editor/API foundation has been built yet. M0 proves that the chosen stack can run here; it does not yet prove acceptable alignment quality across the required song corpus.

**Decision: hold progression to M1.** Representative singing fixtures, independent manual line/word annotations, correction-burden review, and listening review remain outstanding. Match coverage alone cannot meet an accuracy gate.

## Verified environment

| Component | Observed value |
|---|---|
| OS | Windows 11 Pro, 10.0.26200 |
| CPU | AMD Ryzen 7 3700X, 8 cores / 16 logical processors |
| RAM | 51,482,046,464 bytes (about 48 GiB) |
| GPU | NVIDIA GeForce GTX 1650 SUPER; CIM reports about 4 GB adapter memory |
| GPU runtime | Not tested; NVIDIA CLI query was blocked by an execution hook |
| Storage | About 251 GiB free on D: at inventory time |
| Node / npm | 24.6.0 / 11.5.1 |
| Python | 3.13.5, isolated project .venv |
| FFmpeg | N-119856-gbe46370941-20250608; ffprobe available |
| React / React DOM | 19.3.1 |
| Remotion / Player / Bundler / Renderer | 4.0.537 throughout |
| Vite / TypeScript / Vitest | 8.3.5 / 5.9.3 / 5.0.5 |
| Browser automation | Playwright 1.64.1 using Remotion's downloaded Chromium |
| lyric-align | 0.4.2, ijuinryukichi/lyric-align, MIT |
| faster-whisper / CTranslate2 | 1.2.1 / 4.8.3 |
| PyAV | 18.1.0, pinned after real compatibility failure |
| Model/config | base.en, CPU, int8, English, VAD disabled |
| Font | Inter 600, local @fontsource/inter 5.3.0, OFL-1.1 |

Node lockfile and Python requirements.lock.txt retain actual installed versions. npm installation reported zero audit vulnerabilities; pip check found no dependency conflicts. These checks are not security audits.

## Fixtures and provenance

1. **Original marker:** generated 10-second 48 kHz mono PCM audio, pulses beginning at 1, 5, and 9 seconds. Original displayed phrases have known line/word times. This measures rendering and mux synchronization, not singing alignment.
2. **Amazing Grace:** Southern Aire / United States Air Force Reserve Band; 130.304 seconds, SHA-256 `834b463be93a8b19d05a72e94c429ab3618691aeb593869f603f58d22a8c7676`. The [Wikimedia file page](https://commons.wikimedia.org/wiki/File:Amazing_Grace_(vocalist_with_guitar)_-_Southern_Aire_-_United_States_Air_Force_Reserve_Band.mp3) identifies recording/performance provenance and public-domain status in the United States. The [engine NOTICE](https://github.com/ijuinryukichi/lyric-align/blob/main/NOTICE) identifies its example hymn lyrics as the public-domain exception. No other upstream lyric fixtures were copied.
3. **Inaccurate-text variant:** same recording and lyrics with one deliberately unrelated appended line. This tests explicit unmatched behavior and transcription-cache reuse.
4. **User-supplied test song:** music/test.wav and music/lyrics.txt, used locally at the user's direction. English, 97.431 seconds, 48 kHz stereo PCM16, SHA-256 `ee36ade8f225cd9151d8e4e5d3f1942405980c73a7c0d0fd1ca719e061ededc5`. Contains repeated choruses and section headings. Original files remain unchanged and ignored by Git. This folder is only a test fixture; production input remains user WAV/MP3 upload plus pasted lyrics.

The hymn exercises sustained vocals and sparse accompaniment. It does not replace repeated-chorus, fast-singing, and long-gap fixtures. Engine examples and inferred timings are not independent manual annotations.

## Measured results

### Actual CPU alignment

| Run | Segments | Matched / supplied lines | Word-timed lines | Adapter time |
|---|---|---|---|---|
| Baseline hymn, first successful ASR | 6 | 12 / 12 | 12 | 11.221 seconds |
| Inaccurate-text variant, cached ASR | 6 | 12 / 13 | 12 | 0.110 seconds |
| User song, original coarse segments | 7 | 15 / 28 | 15 | 9.132 seconds |
| User song, sentence segmentation, cached ASR | 7 raw / 27 sentence segments | 26 / 28 | 26 | 0.104 seconds |
| User song, sentence segmentation, fresh ASR with memory measurement | 7 raw / 27 sentence segments | 26 / 28 | 26 | 8.860 seconds |

The local song revealed an adapter problem: section headings were treated as sung lines, and coarse ASR blocks exceeded the engine's three-line auto-pairing cap. The adapter now reuses the engine's heading rules and splits coarse blocks only at recognized sentence punctuation using actual word timestamps. Original transcription is preserved in its cache. This improves match coverage, not independently measured accuracy.

Two lines remain untimed: the first occurrence of “Jump around and dance with me!” has invalid/overlapping inferred timing; “Sing along to happy tunes!” has no engine match. Both are visible in the local-song preview, which passed a browser smoke check with no page errors. The full original sectioned lyrics are retained in sourceLyrics.

Actual worker peak working set during the fresh local-song run was **354,197,504 bytes (about 337.79 MiB)**, queried inside Python with Windows GetProcessMemoryInfo. An earlier external sample measured only the venv launcher and was rejected. Model weights were already present for this measured run; download/setup time is not included as a separate measured metric.

The appended unrelated line had null start/duration and no word timestamps. No interpolation was applied to unmatched lines. All automatically timed lines remain review-required. The engine derives karaoke units from character interpolation; per-word singing accuracy is not established by these results.

Independent median/p95 line errors, word errors, correction burden, isolated model-load duration, and separate download duration were not measured. The evaluator is implemented for future independent annotations; no synthetic benchmark has been presented as real singing accuracy.

### Actual rendering

| Output | Video/audio | Length | Elapsed time |
|---|---|---|---|
| artifacts/marker.mp4 | H.264/AAC, 1280x720, 30 FPS | 300 frames / 10 seconds | 54.336 seconds including first Chromium setup |
| artifacts/alignment.mp4 | H.264/AAC, 1280x720, 30 FPS | First 600 frames / 20 seconds | 22.729 seconds |
| artifacts/local.mp4 | H.264/AAC, 1280x720, 30 FPS | First 600 frames / 20 seconds | 23.545 seconds |

The song export is a sample, not a full-song export. No portrait, 1080p, 24/25 FPS export, video background, or transition has been claimed tested.

### Player, renderer, and encoded-frame checks

- Compared frames 29, 30, 47, 59, 60, 89, 90, 149, 150, 269, 270, and 299 using the same marker project and component.
- Player screenshots versus renderStill PNGs: mean absolute RGB error **0** at every sampled frame in the 1280x600 canvas region. The bottom Player transport controls are excluded.
- Decoded H.264 frames: expected lyric visibility at every sampled boundary; foreground RGB error remained below the verifier's 18/255 threshold (maximum observed about 8.35), allowing lossy encoding.
- Exported audio pulse onsets: 1.0000625, 5.0000625, 9.0000625 seconds. Constant measured offset about 0.063 ms; no accumulating drift on this 10-second fixture.
- Browser page errors: none. Visually inspected a preview screenshot for readable text and active-word highlighting.
- **Listening review: not performed.** Encoded pulse measurement does not substitute for listening to the song export.

Detailed generated results and screenshots are in artifacts/verification.json and artifacts/parity/. They remain local and ignored by Git.

## Failures found and fixed

1. The first actual transcription failed because faster-whisper 1.2.1 passed metadata_errors to PyAV 19.0.2. [Upstream issue #1589](https://github.com/SYSTRAN/faster-whisper/issues/1589) confirms this incompatibility. Pinning PyAV 18.1.0 fixed real decoding. A runnable real-audio decoder regression check now protects this pairing.
2. The first parity run waited for visibility of an empty lyric frame marker before a line starts. Waiting for its attached state fixed the harness; the video behavior was correct.
3. UTF-8 mode was needed to print upstream Unicode source under the host's default console encoding.

## Reproduction and completion criteria

Follow README.md for installation and proof commands. Preparation downloads the attributed song; alignment downloads model weights on first use; rendering downloads Chromium on first use. No paid service, public media upload, account, or database is used.

Existing checks cover model/time invariants, alignment mapping, exact supplied text, repeated lines, unmatched input, decoder compatibility, independent-error calculations, and real rendering. Use the annotation evaluator only with separately reviewed measurements from the exact recording.

Latest check results: TypeScript typecheck passed; 15 Vitest tests and 15 Python tests passed. The earlier environment pip check passed. The original brief was preserved. The hymn export was directly probed: 600 video frames / 20 seconds, AAC stereo 48 kHz, and container duration 20.011 seconds including audio padding.

Remaining M0 evidence:

- [x] Add a user-supplied repeated-chorus fixture.
- [ ] Add representative long-gap and fast-vocal fixtures.
- [ ] Manually annotate representative line/word boundaries and record fixture hashes.
- [ ] Measure actual median/p95 boundary errors and match coverage against annotations.
- [ ] Review correction burden and settle the word-quality target.
- [x] Record actual worker peak memory on fresh ASR with already-downloaded weights.
- [ ] Distinguish isolated model setup from steady-state processing.
- [ ] Listen to exported song audio and record synchronization/quality observations.
- [ ] Make an evidence-based go/no-go decision; only then begin M1.

Remotion is used for evaluation under its [official license](https://www.remotion.dev/docs/license). Future commercial eligibility has not been assumed; no license was bought or free-license eligibility declared.
