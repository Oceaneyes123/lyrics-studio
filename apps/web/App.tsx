import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Player, type PlayerRef} from '@remotion/player';
import {TimelineVideo as ProofVideo} from '../../packages/video-composition/TimelineVideo';
import type {Asset} from '../../packages/project-model/model';
import {timelineClipSchema as clipSchema, trackSchema, type TimelineProject as Project} from '../../packages/project-model/timeline';
import {durationFrames} from '../../packages/project-model/proof';
import {timeLine, moveLine} from '../../packages/editor-core/commands';
import {applyAlignment as mergeAlignment, audioClips, lines, visualClips, updateLine, setLyrics as replaceLyricText, splitClip, deleteClips, selectedClips, moveClips, type Line} from '../../packages/editor-core/timeline-commands';
import type {Job} from '../api/jobs';
import {api, sessionToken, useEditor, type Selection} from './store';
import {Timeline} from './Timeline';
import './editor.css';

function NumberField({label, value, change, step = .1, min, max}: {
  label: string; value: number; change: (value: number) => void; step?: number; min?: number; max?: number;
}) {
  return <label className="number-field">{label}<input key={value} aria-label={label} type="number"
    defaultValue={Number(value.toFixed(3))} step={step} min={min} max={max}
    onKeyDown={e => {if (e.key === 'Enter') e.currentTarget.blur();}}
    onBlur={e => {const n = Number(e.currentTarget.value); if (e.currentTarget.value && Number.isFinite(n) && n !== Number(value.toFixed(3))) change(n); e.currentTarget.value = String(Number(value.toFixed(3)));}} /></label>;
}

export function App() {
  const {project, dirty, version, past, future, token} = useEditor();
  const player = useRef<PlayerRef>(null), saving = useRef<Promise<Project> | null>(null);
  const [projects, setProjects] = useState<{id: string; name: string}[]>([]);
  const [hiddenRecents, setHiddenRecents] = useState<string[]>(() => {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem('lyrics-studio-hidden-recents') ?? '[]');
      return Array.isArray(stored) && stored.every(id => typeof id === 'string') ? stored : [];
    } catch {return [];}
  });
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false), [saveState, setSaveState] = useState('Saved');
  const [selection, setPrimarySelection] = useState<Selection>(null), [frame, setFrame] = useState(0);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [lyrics, setLyrics] = useState(''), [language, setLanguage] = useState('en');
  const [job, setJob] = useState<Job | null>(null), [lastExport, setLastExport] = useState('');
  const [exportOpen, setExportOpen] = useState(false), [allowUntimed, setAllowUntimed] = useState(false);
  const [importing, setImporting] = useState(false);
  const [styleScope, setStyleScope] = useState<'project' | 'line'>('project');
  const activeJob = job?.state === 'running' || job?.state === 'queued';
  const recentProjects = projects.filter(p => !hiddenRecents.includes(p.id));
  const attempt = useCallback((action: () => void) => {try {action(); setError('');} catch (e) {setError(e instanceof Error ? e.message : 'Edit failed');}}, []);
  function setSelection(next: Selection, mode: 'single' | 'toggle' | 'range' = 'single') {
    setPrimarySelection(next);
    if (!project || !next) {setSelectedIds([]); return;}
    const clip = project.clips.find(c => next.kind === 'lyric' ? c.kind === 'lyric' && c.sourceLineId === next.id : c.id === next.id);
    if (!clip) {setSelectedIds([]); return;}
    let ids = [clip.id];
    if (mode === 'toggle') ids = selectedIds.includes(clip.id) ? selectedIds.filter(id => id !== clip.id) : [...selectedIds, clip.id];
    if (mode === 'range' && selectedIds.length) {
      const anchor = project.clips.find(c => c.id === selectedIds[0]);
      if (anchor?.trackId === clip.trackId) ids = project.clips.filter(c => c.trackId === clip.trackId && c.startMs >= Math.min(anchor.startMs, clip.startMs) && c.startMs <= Math.max(anchor.startMs, clip.startMs)).map(c => c.id);
    }
    setSelectedIds(selectedClips(project, ids).map(c => c.id));
  }
  async function perform(action: () => Promise<void>) {
    setBusy(true); setError(''); try {await action();} catch (e) {setError(e instanceof Error ? e.message : 'Operation failed');} finally {setBusy(false);}
  }
  const refresh = () => api<{id: string; name: string}[]>('/projects').then(setProjects);
  useEffect(() => {
    sessionToken().then(refresh).catch(e => setError(String(e.message)));
  }, []);
  useEffect(() => {setLyrics(project?.lyricSource.text ?? '');}, [project?.id, project?.lyricSource.text]);
  const save = useCallback(async (): Promise<Project> => {
    if (saving.current) return saving.current;
    const state = useEditor.getState(); if (!state.project) throw new Error('Create a project first');
    if (!state.dirty) return state.project;
    const snapshot = state.project; setSaveState('Saving…');
    saving.current = api<Project>(`/projects/${snapshot.id}`, {method: 'PUT', body: JSON.stringify(snapshot)})
      .then(saved => {useEditor.getState().saved(saved, state.version); setProjects(list => list.map(p => p.id === saved.id ? {id: p.id, name: saved.name} : p)); setSaveState('Saved'); return saved;})
      .catch(e => {setSaveState('Save failed'); throw e;}).finally(() => {saving.current = null;});
    return saving.current;
  }, []);
  async function flush() {await save(); if (useEditor.getState().dirty) await save();}
  useEffect(() => {
    if (!dirty || importing) return;
    const timeout = setTimeout(() => {save().catch(e => setError(e.message));}, 1200);
    return () => clearTimeout(timeout);
  }, [version, dirty, importing, save]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {if (project && (useEditor.getState().dirty || lyrics !== project.lyricSource.text)) {event.preventDefault(); event.returnValue = '';}};
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [lyrics, project?.lyricSource.text]);
  useEffect(() => {
    const instance = player.current; if (!instance) return;
    const update = ({detail}: {detail: {frame: number}}) => setFrame(detail.frame);
    instance.addEventListener('frameupdate', update);
    return () => instance.removeEventListener('frameupdate', update);
  }, [project?.id]);
  useEffect(() => {
    const keyboard = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if ((e.target as HTMLElement).closest('input,textarea,select,[contenteditable]')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {e.preventDefault(); e.shiftKey ? useEditor.getState().redo() : useEditor.getState().undo();}
      if (e.code === 'Space' && !(e.target as HTMLElement).closest('button,a,[role="button"]')) {e.preventDefault(); player.current?.toggle();}
    };
    window.addEventListener('keydown', keyboard); return () => window.removeEventListener('keydown', keyboard);
  }, []);
  useEffect(() => {
    if (!job || !activeJob) return;
    const timer = setInterval(() => {
      api<Job>(`/jobs/${job.id}`).then(next => {
        if (useEditor.getState().project?.id !== next.projectId) return;
        setJob(next);
        if (next.state === 'succeeded' && next.kind === 'export') setLastExport(next.id);
        if (next.state === 'failed') setError(next.error ?? 'Job failed');
      }).catch(e => setError(e.message));
    }, 1000);
    return () => clearInterval(timer);
  }, [job?.id, activeJob]);
  const assetUrls = useMemo(() => Object.fromEntries((project?.assets ?? []).map(asset =>
    [asset.file, `/api/projects/${project!.id}/assets/${asset.id}?cap=${token}`])), [project?.id, project?.assets, token]);
  const seek = (ms: number) => {
    if (!project) return; const next = Math.max(0, Math.min(durationFrames(project) - 1, Math.round(ms * project.fps / 1000)));
    player.current?.pause(); player.current?.seekTo(next); setFrame(next);
  };
  async function open(id: string) {
    if (project && (useEditor.getState().dirty || lyrics !== project.lyricSource.text) && !confirm('Discard unsaved changes and reopen the selected project?')) return;
    const result = await api<{project: Project; recovered: boolean; missing: string[]}>(`/projects/${id}`);
    useEditor.getState().open(result.project); setSelection(null); setFrame(0); setJob(null); setLastExport('');
    const previousJobs = await api<Job[]>(`/projects/${id}/jobs`);
    setJob(previousJobs[0] ?? null);
    setLastExport(previousJobs.find(j => j.kind === 'export' && j.state === 'succeeded')?.id ?? '');
    setNotice(result.recovered ? 'Recovered the last-good project backup. Save to repair the main file.' :
      result.missing.length ? `Missing media: ${result.missing.join(', ')}. Reimport the original files.` : '');
    if (result.recovered) useEditor.getState().edit(() => {});
  }
  async function create() {
    if (project && (dirty || lyrics !== project.lyricSource.text) && !confirm('Discard unsaved changes and create a new project?')) return;
    const next = await api<Project>('/projects', {method: 'POST'});
    useEditor.getState().open(next); setSelection(null); setFrame(0); setJob(null); setNotice(''); setLastExport(''); await refresh();
  }
  async function importFile(file: File, replace?: string) {
    if (!project) throw new Error('Create a project first');
    if (file.size > 500 * 1024 * 1024) throw new Error('Files must be smaller than 500 MB');
    if (lyrics !== project.lyricSource.text && !applyLyrics()) return;
    await flush(); setImporting(true);
    try {
      const data = new FormData(); data.set('file', file);
      const result = await api<{project: Project; asset: Asset}>(`/projects/${project.id}/assets${replace ? `?replace=${replace}` : ''}`, {method: 'POST', body: data});
      useEditor.getState().open(result.project);
      setNotice(replace ? `${result.asset.name} repaired. Existing clips are preserved.` : `${result.asset.name} imported. ${result.asset.kind === 'audio' ? 'Paste lyrics to begin alignment.' : 'Drag it onto a visual layer.'}`);
    } finally {setImporting(false);}
  }
  function applyLyrics() {
    if (!project) return false;
    if (lyrics === project.lyricSource.text) return true;
    if (lines(project).some(l => l.startMs !== null) && !confirm('Replace existing lyric clips with the new text? You can undo this change.')) return false;
    useEditor.getState().edit(draft => {replaceLyricText(draft, lyrics);});
    setSelection(null); return true;
  }
  async function align() {
    if (!lyrics.trim()) throw new Error('Paste the song lyrics first');
    if (!applyLyrics()) return;
    await flush(); const current = useEditor.getState().project!;
    setJob(await api<Job>(`/projects/${current.id}/alignment-jobs`, {method: 'POST', body: JSON.stringify({language})}));
  }
  function applyAlignment(replaceManual = false) {
    if (!project || !job || job.kind !== 'alignment' || job.state !== 'succeeded') return;
    const result = job.result as {sourceLyrics: string; audioHash: string; lines: Line[]};
    if (job.projectId !== project.id) throw new Error('Alignment belongs to another project');
    if (replaceManual && !confirm('Replace all timing, including manual corrections? Undo can restore the previous clips.')) return;
    const next = mergeAlignment(project, result, replaceManual);
    useEditor.getState().commit(next); setJob(null); setNotice('Alignment applied. Manual timing was preserved; review automatic matches and untimed lines.');
  }
  function ensureVisualTrack(draft: Project, layer: number) {
    let track = draft.tracks.filter(track => track.kind === 'visual')[layer];
    while (!track) {
      const created = trackSchema.parse({id: crypto.randomUUID(), name: `Layer ${draft.tracks.filter(t => t.kind === 'visual').length + 1}`, kind: 'visual'});
      const lyricIndex = draft.tracks.findIndex(t => t.kind === 'lyrics');
      draft.tracks.splice(lyricIndex < 0 ? draft.tracks.length : lyricIndex, 0, created);
      track = draft.tracks.filter(t => t.kind === 'visual')[layer];
    }
    return track;
  }
  function addBackground(asset: Asset, startMs = Math.round(frame * 1000 / project!.fps), layer = project!.tracks.filter(t => t.kind === 'visual').length) {
    useEditor.getState().edit(draft => {
      const track = ensureVisualTrack(draft, layer);
      const durationMs = Math.min(draft.durationMs - startMs, asset.kind === 'image' ? draft.durationMs : asset.durationMs);
      const overlap = Math.min(500, durationMs);
      const previous = visualClips(draft).filter(c => c.trackId === track.id && c.startMs <= startMs).at(-1);
      const clip = clipSchema.parse({id: crypto.randomUUID(), assetId: asset.id, kind: 'visual', trackId: track.id, startMs, durationMs,
        sourceInMs: 0, fadeInMs: previous && previous.startMs + previous.durationMs > startMs ? overlap : 0});
      draft.clips.push(clip); setSelection({kind: 'video', id: clip.id});
    });
  }
  function deleteSelection() {
    if (!project || !selection) return;
    if (selection.kind === 'lyric' && !primaryClip) {
      useEditor.getState().edit(d => {d.lyricSource.lines = d.lyricSource.lines.filter(l => l.id !== selection.id);});
    } else useEditor.getState().commit(deleteClips(project, selectedIds));
    setSelection(null);
  }
  function splitSelection() {
    if (!project || !primaryClip) return;
    useEditor.getState().commit(splitClip(project, primaryClip.id, Math.round(frame * 1000 / project.fps)));
  }
  const primaryClip = project && selection ? project.clips.find(c => selection.kind === 'lyric' ? c.kind === 'lyric' && c.sourceLineId === selection.id : c.id === selection.id) : undefined;
  const line = selection?.kind === 'lyric' && project ? lines(project).find(l => l.id === selection.id) : undefined;
  const media = primaryClip?.kind !== 'lyric' ? primaryClip : undefined;
  const editLine = (action: (line: Line) => void) => attempt(() => useEditor.getState().edit(d => updateLine(d, line!.id, action)));
  const editMedia = (action: (clip: NonNullable<typeof media>) => void) => attempt(() => useEditor.getState().edit(d => action(d.clips.find(c => c.id === media!.id) as NonNullable<typeof media>)));

  const activeStyle = styleScope === 'line' && line ? line.style ?? project!.style : project?.style;
  const patchStyle = (values: Record<string, unknown>) => attempt(() => useEditor.getState().edit(d => {
    if (styleScope === 'line' && line) {
      updateLine(d, line.id, selected => {selected.style ??= {...d.style}; Object.assign(selected.style, values);});
    } else Object.assign(d.style, values);
  }));
  const editStyle = (key: keyof Project['style'], value: unknown) => patchStyle({[key]: value});

  return <div className="studio">
    <header className="app-header"><a className="brand" href="/">◒ <span>Lyrics Studio</span></a>
      {project && <input className="project-name" aria-label="Project name" value={project.name} onChange={e => attempt(() => useEditor.getState().edit(d => {d.name = e.target.value;}))} />}
      <span className="save-state" role="status">{project && lyrics !== project.lyricSource.text ? 'Unsaved lyrics' : dirty && saveState === 'Saved' ? 'Unsaved changes' : saveState}</span>
      <div className="header-actions"><select aria-label="Open project" disabled={busy} value={project?.id ?? ''} onChange={e => e.target.value && void perform(() => open(e.target.value))}>
        <option value="" disabled>Open project</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <button onClick={() => void perform(create)} disabled={busy}>New project</button>
        <button disabled={!project || busy} onClick={() => void perform(async () => {if (project && lyrics !== project.lyricSource.text && !applyLyrics()) return; await flush(); await refresh();})}>Save</button>
        <button className="primary" disabled={!(project ? audioClips(project).length : 0) || busy || activeJob} onClick={() => attempt(() => {
          if (project && lyrics !== project.lyricSource.text && !applyLyrics()) return;
          setExportOpen(true); setAllowUntimed(false);
        })}>Export MP4</button></div>
    </header>
    {error && <div className="message error" role="alert">{error}<button aria-label="Dismiss error" onClick={() => setError('')}>×</button></div>}
    {notice && <div className="message notice" role="status">{notice}<button aria-label="Dismiss notice" onClick={() => setNotice('')}>×</button></div>}
    {!project ? <main className="welcome"><div className="record-mark">◉</div><h1>Give your song<br />a place on screen.</h1>
      <p>Upload a song, paste the words, and shape the timing.<br />Your projects and media stay on this computer.</p>
      <button className="primary" disabled={busy} onClick={() => void perform(create)}>Create a lyric video</button>
      {recentProjects.length > 0 && <div className="recent"><h2>Recent projects</h2>{recentProjects.map(p => <div className="recent-project" key={p.id}>
        <button disabled={busy} onClick={() => void perform(() => open(p.id))}>{p.name}<span>Open</span></button>
        <button className="remove-recent" aria-label={`Remove ${p.name} from recents`} title="Remove from recents; project files are kept" onClick={() => attempt(() => {
          const next = [...hiddenRecents, p.id];
          localStorage.setItem('lyrics-studio-hidden-recents', JSON.stringify(next)); setHiddenRecents(next);
        })}>Remove</button>
      </div>)}</div>}
    </main> : <>
      <main className="workbench">
        <aside className="library-panel panel"><section><h2>Media</h2><label className={`upload-zone ${busy ? 'disabled' : ''}`}>
          <span>＋ Import media</span><small>WAV, MP3, MP4, JPG, PNG, GIF · up to 500 MB</small>
          <input aria-label="Upload media" type="file" accept=".wav,.mp3,.mp4,.jpg,.jpeg,.png,.gif" disabled={busy || activeJob} onChange={e => {
            const file = e.target.files?.[0]; e.target.value = ''; if (file) void perform(() => importFile(file));
          }} /></label>
          <div className="asset-list">{project.assets.map(asset => <div className="asset" key={asset.id}
            draggable={asset.kind !== 'audio'} title={asset.kind !== 'audio' ? 'Drag onto a visual layer to add media' : undefined}
            onDragStart={e => {e.dataTransfer.setData('application/x-lyrics-studio-asset', asset.id); e.dataTransfer.effectAllowed = 'copy';}}>
            <span className={`asset-icon ${asset.kind}`}>{asset.kind === 'audio' ? '♫' : asset.kind === 'video' ? '▷' : '▧'}</span>
            <div><strong title={asset.name}>{asset.name}</strong><small>{asset.kind}{asset.durationMs ? ` · ${(asset.durationMs / 1000).toFixed(1)}s` : ''}</small></div>
            {asset.kind !== 'audio' ? <button aria-label={`Add background ${asset.name}`} onClick={() => attempt(() => addBackground(asset))}>＋</button> :
              !audioClips(project).length && <button aria-label={`Use audio ${asset.name}`} onClick={() => attempt(() => useEditor.getState().edit(d => {
                d.durationMs = Math.max(d.durationMs, asset.durationMs);
                d.clips.push(clipSchema.parse({id: crypto.randomUUID(), assetId: asset.id, kind: 'audio', trackId: d.tracks.find(t => t.kind === 'audio')!.id, startMs: 0, durationMs: asset.durationMs, sourceInMs: 0}));
              }))}>＋</button>}
            <label className="repair-media" title="Restore a missing file using the identical original">Repair<input aria-label={`Repair ${asset.name}`} type="file" accept=".wav,.mp3,.mp4,.jpg,.jpeg,.png,.gif" disabled={busy} onChange={e => {
              const file = e.target.files?.[0]; e.target.value = ''; if (file) void perform(() => importFile(file, asset.id));
            }} /></label>
          </div>)}</div>
        </section><section className="lyrics-source"><h2>Lyrics <span>Plain text</span></h2>
          <textarea aria-label="Paste lyrics" placeholder={'Paste your song lyrics here.\n\n[Verse] and [Chorus] headings are supported.'} value={lyrics} onChange={e => setLyrics(e.target.value)} />
          <div className="inline"><select aria-label="Lyrics language" value={language} onChange={e => setLanguage(e.target.value)}>
            <option value="en">English</option><option value="tl">Filipino</option><option value="es">Spanish</option><option value="ja">Japanese</option></select>
            <button onClick={() => attempt(() => {applyLyrics();})}>Use lyrics</button></div>
          <button className="primary full" disabled={busy || activeJob || !audioClips(project).length || !lyrics.trim()} onClick={() => void perform(align)}>Align to song</button>
          <small className="helper">Automatic timing needs review. First use may download model weights (about 150 MB).</small>
        </section></aside>
        <section className="preview-panel"><div className="preview-heading"><h2>Preview</h2><span>{project.width} × {project.height} / {project.fps} fps</span></div>
          <div className="preview-stage"><Player key={project.id} ref={player} component={ProofVideo} inputProps={{project, assets: assetUrls}}
            compositionWidth={project.width} compositionHeight={project.height} durationInFrames={durationFrames(project)} fps={project.fps}
            controls style={{width: '100%', maxHeight: 410, aspectRatio: `${project.width}/${project.height}`}} /></div>
          <div className="transport"><button aria-label="Previous frame" onClick={() => seek((frame - 1) * 1000 / project.fps)}>‹</button>
            <button onClick={() => player.current?.toggle()}>Play / pause</button><button aria-label="Next frame" onClick={() => seek((frame + 1) * 1000 / project.fps)}>›</button>
            <output>{(frame / project.fps).toFixed(3)}s <span>/ {(project.durationMs / 1000).toFixed(3)}s</span></output>
            <button disabled={!past.length} onClick={() => useEditor.getState().undo()}>Undo</button><button disabled={!future.length} onClick={() => useEditor.getState().redo()}>Redo</button></div>
          <div className="lyric-review"><div className="review-heading"><h2>Lyric clips</h2><span>{lines(project).filter(l => l.startMs !== null).length}/{lines(project).length} timed</span>
            <button onClick={() => attempt(() => useEditor.getState().edit(d => {const id = crypto.randomUUID(); d.lyricSource.lines.push({id, text: 'New lyric'}); setSelection({kind: 'lyric', id});}))}>＋ Add line</button></div>
            {!lines(project).length && <p className="empty-hint">Paste lyrics to create your first line.</p>}
            {lines(project).map((l, index) => <button key={l.id} className={`lyric-row ${selection?.id === l.id ? 'selected' : ''}`} onClick={() => {setSelection({kind: 'lyric', id: l.id}); if (l.startMs !== null) seek(l.startMs);}}>
              <span className="line-number">{index + 1}</span><span className={`timing-status ${l.status}`}>{l.startMs === null ? 'Untimed' : `${(l.startMs / 1000).toFixed(2)}s`}</span>
              <span className="line-text">{l.text}</span><small>{l.status === 'manual' ? 'Edited' : l.status === 'review' ? 'Review' : 'Place manually'}</small>
            </button>)}
          </div>
        </section>
        <aside className="inspector panel"><section><h2>{line ? 'Lyric timing' : media ? 'Clip properties' : 'Project settings'}</h2>
          {line ? <>
            <label>Line text<textarea key={line.id + line.text} defaultValue={line.text} onBlur={e => {
              if (e.target.value !== line.text) editLine(l => {l.text = e.target.value; l.words = []; if (l.startMs !== null) l.status = 'manual';});
            }} /></label>
            {line.reason && <p className="helper" role="status">{line.reason}</p>}
            {line.startMs === null ? <button className="primary full" onClick={() => editLine(l => {
              const start = Math.round(frame * 1000 / project.fps);
              const next = lines(project).filter(other => other.startMs !== null && other.startMs > start).reduce((end, other) => Math.min(end, other.startMs!), project.durationMs);
              timeLine(l, start, Math.min(start + 2000, next));
            })}>Place at playhead</button> : <div className="field-grid">
              <NumberField label="Line start (s)" value={line.startMs / 1000} change={n => editLine(l => {moveLine(l, Math.round(n * 1000)); l.status = 'manual';})} />
              <NumberField label="Line end (s)" value={(line.startMs + line.durationMs!) / 1000} change={n => editLine(l => timeLine(l, l.startMs!, Math.round(n * 1000)))} />
            </div>}
            {line.startMs !== null && <><div className="inline"><button onClick={() => editLine(l => {l.status = 'manual';})}>Mark reviewed</button>
              <button onClick={() => editLine(l => {const tokens = l.text.match(/\s*\S+\s*/g) ?? []; l.words = tokens.map((text, i) => ({text,
                startMs: Math.round(i * l.durationMs! / tokens.length), endMs: Math.round((i + 1) * l.durationMs! / tokens.length)})); l.status = 'review';})}>Space words evenly</button></div>
              <p className="helper">Word times are relative to this line. Even spacing is approximate; correct it by ear.</p>
              <div className="word-list">{line.words.map((word, index) => <div className="word-row" key={`${line.id}-${index}`}><strong>{word.text}</strong>
                <NumberField label={`Word ${index + 1} start (s)`} value={word.startMs / 1000} step={.01} change={n => editLine(l => {l.words[index].startMs = Math.round(n * 1000); l.status = 'manual';})} />
                <NumberField label={`Word ${index + 1} end (s)`} value={word.endMs / 1000} step={.01} change={n => editLine(l => {l.words[index].endMs = Math.round(n * 1000); l.status = 'manual';})} />
              </div>)}</div></>}
          </> : media ? <>
            <div className="field-grid"><NumberField label="Clip start (s)" value={media.startMs / 1000} change={n => editMedia(c => {c.startMs = Math.round(n * 1000);})} />
              <NumberField label="Clip duration (s)" value={media.durationMs / 1000} change={n => editMedia(c => {c.durationMs = Math.round(n * 1000);})} />
              <NumberField label="Source trim (s)" value={media.sourceInMs / 1000} change={n => editMedia(c => {c.sourceInMs = Math.round(n * 1000);})} /></div>
            {selection?.kind === 'video' && <><label>Fit<select value={media.fit} onChange={e => editMedia(c => {c.fit = e.target.value as 'cover' | 'contain';})}><option value="cover">Crop to fill</option><option value="contain">Fit inside</option></select></label>
              <div className="field-grid"><NumberField label="Layer" value={project.tracks.filter(t => t.kind === 'visual').findIndex(t => t.id === media.trackId) + 1} min={1} max={500} step={1} change={n => attempt(() => useEditor.getState().edit(d => {d.clips.find(c => c.id === media.id)!.trackId = ensureVisualTrack(d, n - 1).id;}))} />
                <NumberField label="Opacity (%)" value={media.opacity * 100} min={0} max={100} step={1} change={n => editMedia(c => {c.opacity = n / 100;})} />
                <NumberField label="Scale" value={media.scale} change={n => editMedia(c => {c.scale = n;})} />
                <NumberField label="Horizontal offset (%)" value={media.x} change={n => editMedia(c => {c.x = n;})} />
                <NumberField label="Vertical offset (%)" value={media.y} change={n => editMedia(c => {c.y = n;})} />
                <NumberField label="Fade in (s)" value={media.fadeInMs / 1000} change={n => editMedia(c => {c.fadeInMs = Math.round(n * 1000);})} />
                <NumberField label="Fade out (s)" value={media.fadeOutMs / 1000} change={n => editMedia(c => {c.fadeOutMs = Math.round(n * 1000);})} /></div>
              <small>Higher layers appear above lower layers. Overlap clips on one layer for a crossfade.</small></>}
          </> : <><label>Canvas<select aria-label="Canvas preset" value={`${project.width}x${project.height}`} onChange={e => attempt(() => useEditor.getState().edit(d => {
            const [width, height] = e.target.value.split('x').map(Number); d.width = width; d.height = height;
          }))}><option value="1280x720">Landscape · 720p</option><option value="1920x1080">Landscape · 1080p</option><option value="720x1280">Portrait · 720p</option><option value="1080x1920">Portrait · 1080p</option></select></label>
            <label>Frame rate<select aria-label="Frame rate" value={project.fps} onChange={e => attempt(() => useEditor.getState().edit(d => {d.fps = Number(e.target.value) as Project['fps'];}))}>
              {[24, 25, 30].map(f => <option key={f} value={f}>{f} fps</option>)}</select></label>
            <NumberField label="Project duration (s)" value={project.durationMs / 1000} change={n => attempt(() => useEditor.getState().edit(d => {d.durationMs = Math.round(n * 1000);}))} />
          </>}
          {selection && <div className="inline"><button onClick={() => attempt(splitSelection)}>Split at playhead</button><button onClick={() => attempt(deleteSelection)}>Delete clip</button>
            <button onClick={() => setSelection(null)}>Project</button></div>}
        </section>{selectedIds.length > 1 && <section><h2>{selectedIds.length} selected clips</h2>
          <NumberField label="Move selection by (s)" value={0} change={n => attempt(() => useEditor.getState().commit(moveClips(project, selectedIds, Math.round(n * 1000))))} />
          {selectedClips(project, selectedIds).every(c => c.kind === 'visual') && <NumberField label="Selection opacity (%)" value={media?.opacity ? media.opacity * 100 : 100} min={0} max={100} step={1}
            change={n => attempt(() => useEditor.getState().edit(d => {for (const c of d.clips) if (selectedIds.includes(c.id) && c.kind === 'visual') c.opacity = n / 100;}))} />}
        </section>}<section><h2>Lyric style</h2><label>Apply to<select aria-label="Style scope" value={styleScope === 'line' && line ? 'line' : 'project'} onChange={e => setStyleScope(e.target.value as 'line' | 'project')}>
          <option value="project">All lines without overrides</option><option value="line" disabled={!line}>Selected lyric line</option></select></label>
          {line?.style && <button onClick={() => editLine(l => {delete l.style;})}>Use project style</button>}
          <div className="inline"><button onClick={() => patchStyle({y: 50, fontSize: 64, karaoke: 'none', outline: 0})}>Centered title</button>
          <button onClick={() => patchStyle({y: 72, fontSize: 52, karaoke: 'progressive', outline: 1})}>Karaoke</button></div>
          <label>Font<select value={activeStyle!.font} onChange={e => editStyle('font', e.target.value)}><option>Inter</option><option>Georgia</option><option>Arial</option></select></label>
          <div className="field-grid"><NumberField label="Font size" value={activeStyle!.fontSize} change={n => editStyle('fontSize', n)} />
            <NumberField label="Outline" value={activeStyle!.outline} change={n => editStyle('outline', n)} />
            <NumberField label="Text X (%)" value={activeStyle!.x} change={n => editStyle('x', n)} />
            <NumberField label="Text Y (%)" value={activeStyle!.y} change={n => editStyle('y', n)} />
            {(['color', 'activeColor'] as const).map(key => <label key={key}>{key === 'color' ? 'Text color' : 'Highlight'}<input aria-label={key} type="color" value={activeStyle![key]} onChange={e => editStyle(key, e.target.value)} /></label>)}
            <label>Canvas color<input aria-label="Canvas color" type="color" value={project.style.background} onChange={e => attempt(() => useEditor.getState().edit(d => {d.style.background = e.target.value;}))} /></label></div>
          <label>Alignment<select value={activeStyle!.align} onChange={e => editStyle('align', e.target.value)}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label>
          <label>Karaoke<select aria-label="Karaoke style" value={activeStyle!.karaoke} onChange={e => editStyle('karaoke', e.target.value)}><option value="progressive">Progressive fill</option><option value="word">Word colors</option><option value="none">Plain text</option></select></label>
          <NumberField label="Lyric fade (s)" value={activeStyle!.fadeMs / 1000} change={n => editStyle('fadeMs', Math.round(n * 1000))} />
          <label className="checkbox"><input type="checkbox" checked={activeStyle!.shadow} onChange={e => editStyle('shadow', e.target.checked)} /> Text shadow</label>
        </section></aside>
      </main>
      <Timeline project={project} frame={frame} selection={selection} selectedIds={selectedIds} select={setSelection} setSelectedIds={setSelectedIds} seek={seek} attempt={attempt}
        addBackground={addBackground}
        audioUrl={project.assets.find(a => a.kind === 'audio') ? assetUrls[project.assets.find(a => a.kind === 'audio')!.file] : undefined} />
    </>}
    <footer className="status-bar"><span>Local workspace</span>{job ? <div className="job-status" role="status"><strong>{job.kind === 'alignment' ? 'Lyrics alignment' : 'MP4 export'}</strong>
      <span>{job.stage}</span>{job.progress !== null && <progress value={job.progress} max={1} />}
      {activeJob && <button onClick={() => void perform(async () => {setJob(await api<Job>(`/jobs/${job.id}/cancel`, {method: 'POST'}));})}>Cancel</button>}
      {job.state === 'succeeded' && job.kind === 'alignment' && <><button className="primary" onClick={() => attempt(() => applyAlignment())}>Apply matches</button>
        <button onClick={() => attempt(() => applyAlignment(true))}>Replace all timing</button></>}
      {job.state === 'succeeded' && job.kind === 'export' && <a href={`/api/jobs/${job.id}/result?cap=${token}`} download>Download MP4</a>}
    </div> : <span>Space: play/pause · Ctrl/Cmd Z: undo</span>}
      {lastExport && job?.kind !== 'export' && <a href={`/api/jobs/${lastExport}/result?cap=${token}`} download>Download latest MP4</a>}
    </footer>
    {exportOpen && project && <dialog ref={node => {if (node && !node.open) node.showModal();}} onCancel={() => setExportOpen(false)} className="export-dialog" aria-labelledby="export-title"><h2 id="export-title">Export your lyric video</h2>
      <p>{project.width} × {project.height} · {project.fps} fps · {(project.durationMs / 1000).toFixed(1)} seconds</p>
      <p>Export uses the saved project snapshot. You can keep editing while it renders.</p>
      {lines(project).some(l => l.status !== 'manual') && <label className="checkbox"><input aria-label="Export with unreviewed lyrics" type="checkbox" checked={allowUntimed} onChange={e => setAllowUntimed(e.target.checked)} />
        Export unreviewed timing and omit untimed lyrics ({lines(project).filter(l => l.startMs === null).length} untimed)</label>}
      <div className="inline"><button onClick={() => setExportOpen(false)}>Cancel</button><button className="primary"
        disabled={busy || (!allowUntimed && lines(project).some(l => l.status !== 'manual'))} onClick={() => void perform(async () => {
          await flush(); const current = useEditor.getState().project!;
          setJob(await api<Job>(`/projects/${current.id}/export-jobs`, {method: 'POST', body: JSON.stringify({allowUntimed})})); setExportOpen(false);
        })}>Start export</button></div>
    </dialog>}
  </div>;
}
