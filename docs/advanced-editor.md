# Advanced editor controls and verification

The advanced roadmap adds unified tracks, audio mixing, synchronization tools, keyframes, fonts/templates, visual effects, and optional processed audio. Run `npm run dev` and open http://127.0.0.1:5173/. Inputs remain uploaded WAV/MP3 and pasted lyrics; `music/` is a test fixture only.

## Tracks and editing

Tracks render bottom to top. Add audio, visual, or lyric tracks; rename/reorder them with the track controls. L locks content/order, M mutes audio, S solos tracks containing sound, and V hides pictures/text. Visibility does not mute explicitly enabled video audio.

Ctrl/Cmd-click toggles selection, Shift-click selects a range on one track, and dragging empty timeline space selects a rectangle. Grouping is flat and expands selection/movement. Alt trims a grouped item individually and bypasses snapping. Copy/cut/paste use a project-local clipboard and regenerate occurrence/group IDs. Ripple delete closes the union of selected intervals only on affected tracks; conflicting retained clips or groups are rejected atomically. Undo/redo keeps each gesture together.

## Mixing and synchronization

Each audio import adds a source and track. Add further instances with the media button or drag to an audio row. Clip, track, and master gain are additive in dB; mute/solo and clip fades affect preview and export. Overlapping fades use the lower envelope. Summed sources can clip; reduce gain to leave headroom. Video sound is opt-in in its clip inspector.

Choose **Alignment song** explicitly. It must contain the complete original source with no source trim/split. Its timeline start may be nonzero; alignment records that mapping. Music/SFX and gain changes do not invalidate otherwise compatible results. Removing or changing the reference arrangement requires selecting/re-aligning the song.

Select a lyric to use the zoomable word waveform. Drag separate start/end handles; arrow keys adjust 10 ms, Shift adjusts 100 ms. Numeric timing remains available. Word intervals retain gaps and cannot overlap. Mark unreliable words **Untimed** to prevent invented karaoke highlighting. Waveform positions map through the chosen song's timeline/source offsets.

Loop the selected line and slow preview to 0.5x/0.75x, or use 1x/1.25x/1.5x. Export speed remains unchanged. **Arm tap timing** begins at the selected source line: press T or the tap button for each line start, then finish at the playhead to close the last line. Review pending times, undo the last tap, cancel, or apply the session as one undo step. Typing and held-key repeats do not trigger taps.

Rerunning alignment preserves current manual start/end fields and split/copied occurrences. Conflicting proposals keep existing timing and show a review reason. Unchanged text occurrences/tokens retain identity where unambiguous. Removed corrected occurrences/tokens stay saved for review. Explicit replace-corrections remains a separate confirmed, undoable action. Automatic alignment still requires human review.

## Animation, fonts, and templates

Select a visual or timed lyric and seek inside it. Choose an animated property, set its value, add/update/delete keys, choose segment easing, or navigate with previous/next keys and timeline markers. Position uses percent, rotation degrees, and saved time integer milliseconds. Curves override static values until reset. Trimming/splitting preserves the curve origin; moving a clip does not restart its motion. Lyric size and text/highlight colors use the same frame-based evaluation.

Import local TTF/OTF/WOFF/WOFF2 fonts up to 20 MiB. Optional attribution is saved. Fonts use generated internal families and must load successfully in preview/rendering; missing files need identical-original repair. A font may lack glyphs for some scripts; host fallback is not a cross-platform guarantee.

Choose project or selected-line style scope. Word emphasis follows real word intervals and returns to neutral in gaps. Entrance/exit controls and line reveal/accumulation retain existing timing. Save/apply/rename/delete local templates. Applying copies values; later preset changes do not alter projects. A preset with clip keyframes requires a selected lyric. Imported font dependencies match by content hash and must be imported into each target project.

## Transitions and effects

Overlap neighboring visual clips on the same track, select one, and add a linked transition. Dissolve, slide, zoom, wipe, and blur expose duration/direction/amount/easing. Duration must fit the real overlap. Separate/delete/trim edits that break a linked pair are rejected until its transition is adjusted or removed. Copying both partners copies their transition with new IDs.

Brightness, contrast, saturation, hue, blur, rectangle/ellipse masks, and background blur are inspector controls. Compatible visual selections support batch effects. Reset removes their effects in one edit. Masks and transition wipes use separate wrappers; picture filters do not overwrite karaoke clipping. Blur/background blur are capped at 50 px. Background blur adds a muted background copy, keeping video sound single.

## Optional processed audio

Enable ducking, choose the amplitude trigger track and target tracks, and set threshold/reduction/attack/release. This analyzes the mixed trigger track, not isolated vocals. Analysis uses 10 ms RMS windows; attack/release specify approximately 90 percent settling time. Choose final-mix LUFS/true-peak/LRA targets when normalization is enabled. True peak is a ceiling, not a request to raise every signal to that peak.

**Build processed mix**, then **Apply processed mix**. The same immutable derived WAV drives preview and export, with original audio contributions disabled. Source/timing/gain/processing edits mark it stale. Preview then uses ordinary mixing with a visible notice; export requires rebuilding/applying the processed mix or disabling processing. Undoing an edit can restore a compatible cached mix. Visual/text-only edits do not invalidate it.

Processing supports projects up to one hour and 64 distinct audio-bearing source files. PCM temporary/cache files can be large. Jobs support cancellation/retry and preserve original media. Silence cannot be normalized; impossible targets fail explicitly. Derived measurements must meet 0.5 LU integrated and 0.1 dB peak tolerance; encoded AAC is checked at 0.7 LU and 0.5 dB tolerance. A small normalization peak margin is reserved for encoding. No streaming-service loudness policy is assumed.

## Project compatibility and recovery

The advanced writer uses schema 3. Schema 1 and 2 read/migrate in memory without rewriting originals. The first save preserves exact original bytes in `project.json.v1.bak` or `.v2.bak`; these permanent backups do not rotate. Ordinary `.bak` recovery and revision conflicts remain. Unsupported future main documents never fall back silently to an older backup.

Keep the current JSON separately before restoring a version-specific backup for an older application. New features are not losslessly backported. Media/fonts and cached mix files remain immutable; repair requires identical original bytes. No bulk migration, commit, push, or public deployment is part of this work.

## Runnable checks

Final verification on Windows: 116 TypeScript tests, 24 Python tests, lint/typecheck/build, timeline/recents/background/editor flows, four export presets, 48 legacy/V3 parity frames, and all advanced phase harnesses passed. Full supplied-song output has 2,923 frames and a 97.451-second container; decoded audio has zero measured offset at 5, 45, and 80 seconds. Performance samples include short/full/five-minute exports and a 2,000-lyric/500-background structural project. These checks do not establish independent singing accuracy or cross-platform guarantees.

Run browser/render harnesses sequentially with 5174/3002 free:

```powershell
npm test
npm run lint
npm run typecheck
npm run build
npm run test:alignment
npm run test:timeline
npm run test:audio
npm run test:sync
npm run test:animation
npm run test:text
npm run test:effects
npm run test:processing
npm run test:backgrounds
npm run test:recents
npm run test:visual
```

Advanced reports and media are under `artifacts/advanced/`. Tone tests verify levels and derived/encoded parity without claiming human listening approval. Effects tests retain strict non-video pixel checks and report the small native H.264 decoder difference separately. Render-cost samples are representative, not maximum-project throughput guarantees. The frozen earlier workload baseline is in `artifacts/advanced/baseline.json`.

With the main development server running, `test:editor`, `test:media`, and `test:full-export` exercise the retained upload/alignment/export flow and presets. They create local verification projects; they do not upload publicly.
