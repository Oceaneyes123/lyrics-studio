Current architecture: shared timeline V3, Remotion Player, Zustand project history. Attachment requires extending existing flow.

Scope reaches timeline schema/storage migration; shared renderer and LyricText; commands (update, trim, split, copy, delete, lock); App/Timeline/store; audio asset narrowing; tests and browser verification. Standalone text must be excluded from media-only code and from crossfade counts. React Moveable candidate source: https://github.com/daybrush/moveable .

Canvas uses project-pixel DOM proxies and Moveable, above the same Remotion composition used by export. Pointer frames shallow-replace only transform-bearing clips; gesture end calls the existing validated Zustand history once. Explicit transforms remap x/width and y/height proportionally on resolution changes. Untransformed V1â€“V3 content keeps legacy render code. Standalone text is intentionally excluded from existing keyframe UI until its evaluator is integrated.

Moveable resize emitted alternating new/old widths under React 19 concurrent rendering. Its installed type documentation explicitly recommends flushSync for React 18+; configured flushSync so event geometry reads the updated target. Single-target array was also changed to a direct target. These are compatibility fixes, not renderer replacements.

All 126 unit tests pass with a 30s timeout for browser-based font validation. Text-edit drafts and pointer previews must survive autosave revision updates; clear them on project switch rather than every project object replacement. No real user project was rewritten during acceptance; tests use isolated temporary storage.

Group rotation passed after moving its handle. Moveable's default group drag area intercepted Ctrl-clicks on child proxies. Disabled drag-area pointer interception and bound group dragging to the overlay root with explicit target/modifier guards, preserving canvas selection semantics.

Final export evidence: six landscape/portrait Player-vs-renderStill frames have mean RGB channel error 0.099–0.107/255. A real API-exported H.264 frame differs from its renderStill by 1.779/255 after compression. Canvas verification asserts exactly three distinct imported PNG/MP4/GIF clips/tracks, alongside transformed lyric/text. Existing background verifier now hides selection overlays only during content pixel screenshots; actual GIF/crossfade/MP4 checks pass unchanged.
