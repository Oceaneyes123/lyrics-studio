# MVP acceptance follow-up

This record separates repeatable machine checks from human singing/listening review. The original brief is unchanged. Commands run locally; derived audio, annotation files, screenshots, videos, and reports remain in ignored `artifacts/acceptance/`.

Scope update (2026-10-23): the user removed M0.2, M0.3, and M0.5 from the active MVP checklist. The sections below preserve evidence, optional review instructions, and unverified limits; they are no longer outstanding MVP tasks. All 32 retained work packages are complete.

## M0.2: Permissioned fixtures and independent references

Run `npm run test:alignment:acceptance`. It uses the user-supplied English song, the previously attributed public-domain sustained hymn if present, a 20-second silence inserted at 40 seconds, a 1.25x tempo derivative, and an unrelated appended lyric. SHA-256 hashes identify every recording/text input; assertions verify user originals remain unchanged.

The silence may split a vocal. Faster playback is an artificial stress test, not evidence for a representative natural fast singer. These transformations must not be described as independent real-world corpus coverage. English is the current alignment validation scope; the other selectable languages have no quality acceptance claim.

Blind `*.annotations.json` files contain source text/IDs, recording hash, and **null** start/end times. They deliberately omit predicted timings and never overwrite an existing review file. A reviewer must listen to the exact recording, independently measure absolute line boundaries in milliseconds, and enter word times relative to the line start. Word text, including whitespace, must reconstruct the whole line. Delete unreviewed rows before evaluating; record reviewer identity and measurement uncertainty. Cover repeated occurrences, sustained vocals, fast phrases, pauses, and unmatched lines.

Example after independently reviewing the original recording:

```powershell
node scripts/python.mjs services/lyric-alignment/evaluate.py artifacts/acceptance/alignment/original.json artifacts/acceptance/alignment/original.annotations.json
```

Verify the recording SHA-256 matches the review file before evaluation. Empty/null references are rejected. The evaluator reports median/p95 absolute boundary errors, annotated-line match coverage, and unscored words. It cannot infer correctness from matching text. Keep correction count and elapsed manual correction time separately; no correction-burden estimate is invented.

Independent annotations and naturally fast-vocal coverage were not completed. M0.2 was removed from MVP scope.

## M0.3: Actual alignment measurements

`artifacts/acceptance/alignment/report.json` records full model/config, hashes, first-run/cache state, matched/word-timed lines, worker elapsed time, model constructor time, lazy transcription time, lyric mapping time, and Windows worker peak working set. Cached runs use null setup/transcription times, rather than claiming zero-cost model work happened. Model setup includes weight lookup/download if needed; these runs use already-installed weights. Measurements exclude Python interpreter startup and imported-module initialization.

Memory is the worker's process-lifetime high-water mark. Cases currently share a process, so later peaks are not isolated per-case peaks. Coverage and repeat-order tests do not establish boundary accuracy. All automatically matched lines remain review-required in the editor. Independent boundary errors, human correction burden, and word-quality acceptance were not measured. M0.3 was removed from MVP scope.

Current Windows `small` CPU/int8 measurements (already-installed weights):

| Case | Matched lines | Word-timed lines | First run (s) | Cached run (s) |
|---|---:|---:|---:|---:|
| Original repeated-chorus song | 28/28 | 27 | 22.369 | 0.113 |
| Sustained hymn | 11/12 | 8 | 21.844 | 0.082 |
| Inserted silence | 19/28 | 19 | 20.827 | 0.114 |
| 1.25x tempo | 28/28 | 28 | 18.112 | 0.108 |
| Inaccurate text | 28/29 | 27 | 0.099 (cached transcription) | 0.095 |

Original-song model setup was 2.618 s, transcription 19.079 s, mapping 0.011 s, and worker peak 750,796,800 bytes. The hymn's coverage is lower than the older base.en proof; this is a different model/matcher, not a confirmed accuracy regression or improvement. A 28/28 match still does not imply correct lyric boundaries.

## M0.5: Export audio and listening review

The earlier marker test measures mux offsets/drift. `npm run benchmark:editor` creates fresh full-song and five-minute MP4s; decoded-audio correlation checks run at 5/45/80 seconds and 5/150/290 seconds respectively. H.264/AAC, dimensions, frame count, and duration are checked separately. This proves sampled signal synchronization, not acceptable sound quality or lyric accuracy.

Listen to `artifacts/acceptance/performance/full-song.mp4` and `five-minutes.mp4`. Record reviewer/date, playback device, audible clipping/dropouts, start/middle/end synchronization, and sustained/repeated-word observations. Compare with `music/test.wav`. A blank row means pending, never approval.

| Reviewer/date/device | File | Clipping or dropouts | Sync observations | Result |
|---|---|---|---|---|
| Pending | full-song.mp4 | Pending | Pending | Pending |
| Pending | five-minutes.mp4 | Pending | Pending | Pending |

No listening review is recorded. M0.5 was removed from MVP scope; the optional worksheet above does not imply approval.

## M4.3 / M4.6: Fonts, layout, and preview/render parity

Run `npm run test:visual`. The harness uses the actual Player and the actual export composition, not duplicate layout code. It checks 48 frames: four text/style cases, two orientations, and six start/end/fade/word-progress boundaries. Cases cover local Inter, system Georgia/Arial, accented Latin punctuation, long wrapping, explicit newlines, Japanese, Arabic, and emoji. PNG pixel comparison excludes no canvas content. It also blocks both WOFF/WOFF2 to verify bundled-font failure is explicit.

Inter is bundled under the existing font license. Georgia/Arial and missing-script glyphs depend on the host's installed fonts. Same-host parity is the supported local-app claim; cross-device identical system-font output is not guaranteed. Progressive fill clips the actual laid-out word element. Full-script glyph coverage beyond these samples is not claimed.

Found/fixed: raw multiline lyric text previously collapsed explicit newlines. The shared composition now preserves them in Player and export. Font download failures now identify the bundled font instead of silently proceeding with substitution.

## M5.4: Failure and recovery

Run `npm test`. Existing checks cover stale/concurrent saves, corrupt-main backup recovery, future-schema rejection, exact-original repair, worker cancellation/deadline, interrupted jobs, and export acknowledgement. Added checks cover corrupt WAV/MP3/MP4/PNG import cleanup, failed import metadata writes preserving the project, atomic rename failure cleanup/retry, and failed heavy-job persistence/queue recovery.

Disk-full behavior is safely injected as ENOSPC; the real volume is not deliberately filled. This validates the relevant write/rename failure paths without risking user files. Render orchestration also receives injected decoder/disk failures after creating a partial output: failed jobs remove that output, block download, retain the project/original audio, and permit a new successful export. These injections are not actual decoder/hardware failure reproduction. Remaining platform-specific permissions/antivirus/physical-disk behavior is not reproduced.

## M5.5: Bounded performance

Run `npm run benchmark:editor` after alignment acceptance finishes, with ports 5174/3002 free. It uses isolated temporary project storage, the real editor and API, and 10-second, full-song, and five-minute 720p/30 FPS exports. It records import, waveform availability, seek latency samples, wall-clock export duration, output probe, sampled audio synchronization, browser JS heap, and parent Node RSS. Structural stress opens 2,000 lyrics plus 500 backgrounds across 10 layers in a one-hour timeline, then changes zoom. It does not export that one-hour stress project.

The report identifies hardware and explicitly excludes Chromium/FFmpeg memory from Node RSS. A single run, warm OS/model caches, and first-export bundling are not production maximum capacity evidence. Hard schema/upload caps are input protections, not performance promises. Use measured profiles as exercised workloads only.

Measured on Windows 11 (10.0.26200), Ryzen 7 3700X / 16 logical CPUs, 51,482,046,464 bytes RAM, Node 24.6.0:

| Export at 1280×720 / 30 FPS | Import (ms) | Open + waveform canvas (ms) | Export (s) | Frames |
|---|---:|---:|---:|---:|
| 10-second trim | 250 | 1,720 | 15.1 | 300 |
| 97.431-second full song | 253 | 1,173 | 96.5 | 2,923 |
| Five-minute audio loop | 464 | 1,527 | 253.9 | 9,000 |

The short trim imports the full original file; the five-minute input loops the supplied audio and retains the original lyrics in the first song only. This is an export-duration test, not a five-minute independently aligned corpus. All six full/five-minute audio samples measured 0 ms offset with correlation above 0.9999. Sampled end-to-end seeks took 44.6–81.7 ms, including browser automation.

The one-hour structural fixture with 2,000 lyrics / 500 backgrounds / 10 layers validated in 12.4 ms, opened in 1,866 ms, and changed zoom in 902 ms including automation. It was not exported. That worst-size zoom is visibly slower than the ordinary project; these results do not promise smooth editing at every schema cap. No speculative optimization was added without separating layout work from automation overhead.

Node/harness peak RSS was 1,016,672,256 bytes. Sampled renderer JS heaps were about 17–21 MB; those values are not whole-browser memory or combined process-tree peaks. Initial tested performance scope is the recorded host, 720p/30 FPS exports through five minutes with simple lyric styling, and the original 97-second English alignment workload. Larger/1080p full-duration projects and simultaneous hundreds of visible layers have no measured performance promise. The earlier four-preset short export checks remain functional-format evidence.

## Completion status

Final checks: 50 TypeScript/API/job tests, 24 Python tests, lint/type checks, production build, 48 preview/render frame comparisons, and existing background/GIF/layer and recent-project browser regressions passed. Expected font-failure injection produced the named error; ordinary-case browser error lists were empty. Existing non-fatal build chunk/use-client notices remain.

- M4.3 and M4.6: repeatable local font/layout/parity coverage delivered for the supported Windows host.
- M5.4: runnable failure/recovery matrix delivered with safe fault injection; real volume exhaustion is intentionally not induced.
- M5.5: recorded workload benchmarks and explicit tested scope delivered; full schema caps are not performance guarantees.
- M0.2 / M0.3 / M0.5: removed from active scope at the user's request. No accuracy or listening approval is inferred from technical checks or task removal.
