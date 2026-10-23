# Lyrics Video Editor — MVP Implementation Plan

## 1. Project Goal

Build a lightweight video editor where users can:

1. Import a song and optionally a video or background image.
2. Paste plain-text lyrics without needing an SRT file.
3. Automatically align lyrics to the song.
4. Edit lyric clips and their timing on a visual timeline.
5. Apply lyric styles, transitions, and karaoke highlighting.
6. Preview the video and export it as MP4.

**Primary goal:** Make creating synchronized lyric videos faster and easier than using a general-purpose video editor.

## 2. Recommended Technology Stack

| Component | Technology |
|---|---|
| Frontend | React + TypeScript + Vite |
| Styling | Tailwind CSS + shadcn/ui |
| State management | Zustand + Immer |
| Video preview | Remotion Player |
| Video rendering | Remotion Renderer + FFmpeg |
| Timeline interactions | Custom React components + dnd-kit |
| Audio waveform | WaveSurfer.js |
| Lyric alignment | Python + lyric-align + faster-whisper |
| Vocal isolation | Demucs (optional) |
| Backend | Fastify + Python worker |
| Project storage | JSON + local media folders |
| Testing | Vitest + Playwright |

**Development approach:** Run the frontend, Node backend, and Python alignment worker locally. Do not introduce cloud services, authentication, or a database for the initial MVP.

## 3. Application Architecture

```text
React Editor
  ├── Media Library
  ├── Lyrics Input
  ├── Multitrack Timeline
  ├── Properties Inspector
  └── Remotion Player
           │
     Shared Project State
           │
   ┌───────┴─────────┐
   │                 │
Fastify Backend   Python Worker
   │                 │
   ├── Media Import   ├── Audio Analysis
   ├── Project Save   ├── Faster Whisper
   ├── Export Jobs    ├── Lyric Alignment
   │                 └── Word Timestamps
   │
Remotion Renderer
   │
 FFmpeg
   │
 MP4 Export
```

### Shared project model

All editing operations should update one canonical project object containing:

- Project configuration: FPS, resolution, aspect ratio, duration.
- Media assets: source, type, duration, metadata.
- Tracks: audio, video, and lyrics.
- Clips: position, duration, trim, style, transition.
- Lyric data: line text, word timestamps, alignment status.

Represent time internally as integer milliseconds. Convert to frames for Remotion rendering.

Word timestamps should be relative to their parent lyric clip, allowing a clip to move without losing its internal karaoke timing.

## 4. MVP Features

| Feature | Required capabilities |
|---|---|
| Timeline editing | Drag, resize, split, delete, zoom, snapping |
| Lyric styling | Font, size, color, alignment, position, outline, shadow |
| Media import | MP3, WAV, MP4, JPG, PNG |
| Live preview | Play, pause, seek, frame stepping |
| Simple transitions | Cut, fade-in, fade-out, video crossfade |
| Video controls | Trim, crop, scale, reposition, aspect ratio |
| Export | MP4/H.264 with AAC audio, 720p and 1080p |
| Karaoke highlighting | Active-word colors and progressive highlighting |

Start with three timeline types: **Video**, **Audio**, and **Lyrics**. The lyric track contains separate clips, one per lyric line.

## 5. Automatic Lyrics Alignment Pipeline

**Input:** Uploaded song + pasted plain-text lyrics.

1. Normalize the lyric text, preserving line order and repeated choruses.
2. Analyze the audio and obtain speech recognition segments with timestamps.
3. Optionally separate vocals when music interferes with recognition.
4. Match the supplied lyric lines to recognized vocal timing.
5. Generate line and word-level timing data.
6. Mark unmatched or uncertain lines for correction.
7. Create editable lyric clips on the timeline.

Use `lyric-align` as the first alignment engine, with an adapter interface so it can be replaced later.

Store transcription segments separately to avoid repeating expensive audio processing when the user edits lyric text.

**Important:** Do not silently guess unmatched lyrics. Let users position those lines manually.

## 6. Karaoke Rendering

Each lyric clip stores its text and a sequence of timed words.

At each playback frame:

- Identify the active lyric line.
- Calculate the current time relative to the lyric clip.
- Identify the currently sung word.
- Render previous words in a completed state.
- Highlight the current word.
- Keep upcoming words in the inactive state.

Initial karaoke styles:

- Word-by-word color change.
- Progressive color-fill highlight.
- Optional active-word scale animation.

Manual word timing adjustment must be available because automatic alignment may be inaccurate.

## 7. Implementation Milestones

### Milestone 0 — Technical Proof of Concept

**Objective:** Validate the two highest-risk components before building the complete editor.

- Test lyric alignment on different songs.
- Check line and word timing quality.
- Test Remotion preview and MP4 rendering with the same data.
- Confirm audio stays synchronized after export.

**Deliverable:** A simple exported lyric video generated from pasted lyrics.

### Milestone 1 — Editor Foundation

- Initialize frontend and backend.
- Build editor layout and resizable panels.
- Implement project schema and local persistence.
- Create media import and preview player.
- Build the initial timeline and waveform.

**Deliverable:** Users can load, preview, and save a media project.

### Milestone 2 — Timeline Editing

- Create video, audio, and lyric tracks.
- Implement drag-and-drop positioning.
- Add clip trim, split, and delete.
- Add zoom, snapping, and playhead seeking.
- Add undo/redo using edit history.
- Synchronize playback and timeline position.

**Deliverable:** A working basic multitrack video editor.

### Milestone 3 — Automatic Lyrics

- Build the lyrics input panel.
- Integrate the Python alignment worker.
- Generate timed lyric clips automatically.
- Show alignment progress and failed matches.
- Allow line and word timing correction.
- Cache intermediate alignment results.

**Deliverable:** Pasted lyrics appear as synchronized, editable timeline clips.

### Milestone 4 — Visual Editing and Karaoke

- Add text styling and lyric presets.
- Implement basic transitions.
- Add video cropping, scaling, and positioning.
- Implement word-level karaoke highlighting.
- Add 9:16 and 16:9 canvas presets.
- Ensure styles work in both preview and rendering.

**Deliverable:** Users can create a complete, styled lyric video.

### Milestone 5 — Export and Quality Assurance

- Implement background export jobs.
- Add resolution and frame-rate settings.
- Show render progress and errors.
- Generate downloadable MP4 files.
- Test synchronization, transitions, and media compatibility.
- Improve performance and error recovery.

**Deliverable:** A complete, usable MVP.

## 8. Suggested Repository Structure

```text
lyrics-video-editor/
├── apps/
│   ├── web/                  # React editor
│   └── api/                  # Fastify backend
├── packages/
│   ├── project-model/        # Shared schemas
│   ├── editor-core/          # Timeline logic
│   └── video-composition/    # Remotion components
├── services/
│   └── lyric-alignment/      # Python worker
├── storage/
│   └── projects/             # JSON and media
├── tests/
└── docs/
```

## 9. MVP Acceptance Criteria

The MVP is complete when:

- A song and plain-text lyrics can be imported without SRT.
- The application can automatically generate timed lyric clips.
- Users can manually correct both line and word timing.
- Clips can be dragged, trimmed, split, and deleted.
- Lyrics display correctly during playback.
- Karaoke highlighting follows saved word timestamps.
- Media, lyric styles, and transitions appear in the exported video.
- Video exports successfully in portrait and landscape formats.
- Preview and export match within one frame for deterministic visual timing.
- Projects can be saved, reopened, and edited again.

Test with songs containing repeated choruses, long instrumental gaps, sustained vocals, fast singing, and inaccurate lyric text.

## 10. Post-MVP Features

Exclude these from the initial implementation:

- Multiple audio mixing tracks.
- Advanced motion graphics and keyframe editing.
- AI video generation.
- Cloud storage and collaboration.
- Accounts and subscriptions.
- Mobile editing.
- Complex visual effects.
- Automatic lyric translation.

These can be introduced once the core editor is stable.

## 11. Development Principles

1. **Lyrics-first:** Prioritize synchronization and correction over advanced video editing.
2. **Shared rendering:** Use the same Remotion composition for preview and export.
3. **Non-destructive editing:** Never modify the original media assets.
4. **Modular alignment:** Keep the Python alignment engine replaceable.
5. **Local-first:** Minimize infrastructure and recurring costs.
6. **Small milestones:** Every milestone should produce a working, testable result.

**First implementation task:** Complete Milestone 0 before committing to the full editor architecture.