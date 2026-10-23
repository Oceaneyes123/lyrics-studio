import {useEffect, useRef, useState} from 'react';
import {trackSchema, type Clip, type TimelineProject as Project} from '../../packages/project-model/timeline';
import {changeTimeline, copyClips, deleteClips, groupClips, moveClips, pasteClips, selectedClips, snapTimeline, updateLine, type ClipClipboard} from '../../packages/editor-core/timeline-commands';
import {timeLine} from '../../packages/editor-core/commands';
import type {Asset} from '../../packages/project-model/model';
import {useEditor, type Selection} from './store';
import {Waveform} from './Waveform';

export function Timeline({project, frame, selection, selectedIds, select, setSelectedIds, seek, attempt, audioUrl, addBackground}: {
  project: Project; frame: number; selection: Selection; selectedIds: string[];
  select: (selection: Selection, mode?: 'single' | 'toggle' | 'range') => void; setSelectedIds: (ids: string[]) => void;
  seek: (ms: number) => void; attempt: (fn: () => void) => void; audioUrl?: string;
  addBackground: (asset: Asset, startMs: number, layer: number) => void;
}) {
  const [zoom, setZoom] = useState(36), [snapping, setSnapping] = useState(true);
  const [ghost, setGhost] = useState<{ids: string[]; delta: number; edge?: 'left' | 'right'} | null>(null);
  const [rectangle, setRectangle] = useState<{x: number; y: number; width: number; height: number} | null>(null);
  const clipboard = useRef<ClipClipboard | null>(null), cleanup = useRef<(() => void) | null>(null), dragged = useRef(false);
  useEffect(() => {clipboard.current = null; return () => cleanup.current?.();}, [project.id]);
  const length = Math.max(700, project.durationMs / 1000 * zoom);
  const visuals = project.tracks.filter(track => track.kind === 'visual');
  const identity = (clip: Clip): Selection => ({id: clip.kind === 'lyric' ? clip.sourceLineId : clip.id, kind: clip.kind === 'visual' ? 'video' : clip.kind});
  const label = (clip: Clip) => clip.kind === 'lyric' ? clip.text : project.assets.find(asset => asset.id === clip.assetId)?.name ?? 'Media';
  const commit = (next: Project) => useEditor.getState().commit(next);
  function copy(cut = false) {
    clipboard.current = copyClips(project, selectedIds);
    if (cut) {commit(deleteClips(project, selectedIds)); setSelectedIds([]); select(null);}
  }
  function paste() {if (clipboard.current) commit(pasteClips(project, clipboard.current, Math.round(frame * 1000 / project.fps)));}
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || (event.target as HTMLElement)?.closest('input,textarea,select,[contenteditable="true"]')) return;
      if (!(event.ctrlKey || event.metaKey)) return;
      const action = event.key.toLowerCase();
      if (['c', 'x', 'v'].includes(action)) {event.preventDefault(); attempt(() => action === 'v' ? paste() : copy(action === 'x'));}
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  });
  function addTrack(kind: 'audio' | 'visual' | 'lyrics') {
    useEditor.getState().edit(draft => {
      const track = trackSchema.parse({id: crypto.randomUUID(), name: `${kind === 'visual' ? 'Layer' : kind === 'audio' ? 'Audio' : 'Lyrics'} ${draft.tracks.filter(t => t.kind === kind).length + 1}`, kind});
      const index = kind === 'visual' ? draft.tracks.findIndex(t => t.kind === 'lyrics') : -1;
      draft.tracks.splice(index < 0 ? draft.tracks.length : index, 0, track);
    });
  }
  function drag(event: React.PointerEvent, clip: Clip, edge?: 'left' | 'right') {
    event.stopPropagation();
    dragged.current = false;
    if (event.button !== 0 || (!edge && (event.ctrlKey || event.metaKey || event.shiftKey))) return;
    if (project.tracks.find(t => t.id === clip.trackId)!.locked) {attempt(() => {throw new Error('Unlock this track before editing');}); return;}
    if (edge && clip.groupId && !event.altKey) {attempt(() => {throw new Error('Hold Alt to trim a grouped clip individually');}); return;}
    const ids = edge ? [clip.id] : selectedClips(project, selectedIds.includes(clip.id) ? selectedIds : [clip.id]).map(c => c.id);
    if (!selectedIds.includes(clip.id)) select(identity(clip));
    const startX = event.clientX; let delta = 0, destination = clip.trackId;
    const controller = new AbortController(); cleanup.current?.(); cleanup.current = () => controller.abort();
    event.currentTarget.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => {
      const reference = edge === 'right' ? clip.startMs + clip.durationMs : clip.startMs;
      delta = snapTimeline(reference + (e.clientX - startX) * 1000 / zoom, project, zoom, snapping && !e.altKey, frame * 1000 / project.fps) - reference;
      dragged.current = Math.abs(e.clientX - startX) > 2 || e.clientY !== event.clientY;
      destination = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-track-id]')?.dataset.trackId ?? clip.trackId;
      const extraLayer = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-new-layer]');
      if (extraLayer && clip.kind === 'visual') destination = 'new-visual-track';
      setGhost({ids, delta, edge});
    };
    const up = () => {
      controller.abort(); setGhost(null);
      if (!dragged.current) return;
      attempt(() => {
        let target = project;
        if (destination === 'new-visual-track') {
          target = changeTimeline(project, draft => {
            const track = trackSchema.parse({id: crypto.randomUUID(), name: `Layer ${visuals.length + 1}`, kind: 'visual'});
            const index = draft.tracks.findIndex(t => t.kind === 'lyrics'); draft.tracks.splice(index < 0 ? draft.tracks.length : index, 0, track); destination = track.id;
          });
        }
        if (!edge) commit(moveClips(target, ids, delta, destination, clip.trackId));
        else commit(changeTimeline(target, draft => {
          const changed = draft.clips.find(c => c.id === clip.id)!;
          if (changed.kind === 'lyric') updateLine(draft, changed.sourceLineId, line => timeLine(line,
            clip.startMs + (edge === 'left' ? delta : 0), clip.startMs + clip.durationMs + (edge === 'right' ? delta : 0)));
          else {
            changed.startMs += edge === 'left' ? delta : 0; changed.durationMs += edge === 'left' ? -delta : delta;
            if (edge === 'left' && draft.assets.find(asset => asset.id === changed.assetId)?.kind !== 'image') changed.sourceInMs += delta;
            changed.fadeInMs = Math.min(changed.fadeInMs, changed.durationMs); changed.fadeOutMs = Math.min(changed.fadeOutMs, changed.durationMs);
          }
        }));
      });
    };
    document.addEventListener('pointermove', move, {signal: controller.signal}); document.addEventListener('pointerup', up, {once: true, signal: controller.signal});
    document.addEventListener('pointercancel', () => {controller.abort(); setGhost(null);}, {once: true, signal: controller.signal});
  }
  function rectangleSelect(event: React.PointerEvent) {
    if (event.button !== 0 || (event.target as HTMLElement).closest('[data-clip-id],button,input')) return;
    const start = {x: event.clientX, y: event.clientY}, additive = event.ctrlKey || event.metaKey;
    const controller = new AbortController(); cleanup.current?.(); cleanup.current = () => controller.abort();
    let rect = {x: start.x, y: start.y, width: 0, height: 0};
    document.addEventListener('pointermove', e => {
      rect = {x: Math.min(start.x, e.clientX), y: Math.min(start.y, e.clientY), width: Math.abs(e.clientX - start.x), height: Math.abs(e.clientY - start.y)}; setRectangle(rect);
    }, {signal: controller.signal});
    document.addEventListener('pointerup', () => {
      controller.abort(); setRectangle(null);
      const ids = Array.from(document.querySelectorAll<HTMLElement>('[data-clip-id]')).filter(element => {
        const bounds = element.getBoundingClientRect();
        return bounds.left < rect.x + rect.width && bounds.right > rect.x && bounds.top < rect.y + rect.height && bounds.bottom > rect.y;
      }).map(element => element.dataset.clipId!);
      const expanded = selectedClips(project, [...(additive ? selectedIds : []), ...ids]);
      select(expanded[0] ? identity(expanded[0]) : null); setSelectedIds(expanded.map(clip => clip.id));
    }, {once: true, signal: controller.signal});
    document.addEventListener('pointercancel', () => {controller.abort(); setRectangle(null);}, {once: true, signal: controller.signal});
  }
  function drop(event: React.DragEvent, layer: number) {
    event.preventDefault();
    const asset = project.assets.find(a => a.id === event.dataTransfer.getData('application/x-lyrics-studio-asset'));
    if (!asset || asset.kind === 'audio') return;
    const start = snapTimeline((event.clientX - event.currentTarget.getBoundingClientRect().left) * 1000 / zoom, project, zoom, snapping && !event.altKey, frame * 1000 / project.fps);
    attempt(() => addBackground(asset, start, layer));
  }
  return <section className="timeline-panel panel" aria-label="Timeline">
    <div className="timeline-toolbar"><h2>Timeline</h2><span>{selectedIds.length} selected</span>
      <button onClick={() => attempt(() => addTrack('audio'))}>＋ Audio track</button><button onClick={() => attempt(() => addTrack('lyrics'))}>＋ Lyrics track</button>
      <button disabled={!selectedIds.length} onClick={() => attempt(() => copy())}>Copy</button><button disabled={!selectedIds.length} onClick={() => attempt(() => copy(true))}>Cut</button><button onClick={() => attempt(paste)}>Paste</button>
      <button disabled={selectedIds.length < 2} onClick={() => attempt(() => commit(groupClips(project, selectedIds, crypto.randomUUID())))}>Group</button>
      <button disabled={!selectedIds.length} onClick={() => attempt(() => commit(groupClips(project, selectedIds, null)))}>Ungroup</button>
      <button disabled={!selectedIds.length} onClick={() => attempt(() => {commit(deleteClips(project, selectedIds, true)); select(null);})}>Ripple delete</button>
      <label><input type="checkbox" checked={snapping} onChange={e => setSnapping(e.target.checked)} /> Snap</label>
      <label>Zoom <input aria-label="Timeline zoom" type="range" min="10" max="160" value={zoom} onChange={e => setZoom(Number(e.target.value))} /></label>
    </div>
    {audioUrl && <div className="timeline-waveform"><Waveform src={audioUrl} time={frame * 1000 / project.fps} seek={seek} /></div>}
    <div className="timeline-scroll"><div className="timeline-content" style={{width: length + 130}}>
      <div className="ruler" style={{width: length, marginLeft: 130}} onClick={e => seek((e.clientX - e.currentTarget.getBoundingClientRect().left) * 1000 / zoom)}>
        {Array.from({length: Math.ceil(project.durationMs / 1000) + 1}, (_, i) => i % Math.max(1, Math.ceil(60 / zoom)) === 0 && <span key={i} style={{left: i * zoom}}>{i}s</span>)}
      </div>
      <div className="track video"><div className="track-label"><button onClick={() => attempt(() => addTrack('visual'))}>＋ Layer</button></div>
        <div className="track-lane" style={{width: length}} data-new-layer aria-label="+ Layer timeline" data-video-layer={visuals.length}
          onDragOver={e => e.preventDefault()} onDrop={e => drop(e, visuals.length)} /></div>
      {[...project.tracks].reverse().map(track => {
        const index = project.tracks.findIndex(t => t.id === track.id), visualIndex = visuals.findIndex(t => t.id === track.id);
        return <div key={track.id} className={`track ${track.kind === 'visual' ? 'video' : track.kind === 'lyrics' ? 'lyric' : 'audio'} ${track.locked ? 'locked' : ''}`}>
          <div className="track-label"><input aria-label={`Track name ${track.id}`} value={track.name} onChange={e => attempt(() => useEditor.getState().edit(d => {d.tracks.find(t => t.id === track.id)!.name = e.target.value;}))} />
            <div className="track-controls"><button aria-label={`${track.locked ? 'Unlock' : 'Lock'} ${track.name}`} aria-pressed={track.locked} onClick={() => attempt(() => useEditor.getState().edit(d => {d.tracks.find(t => t.id === track.id)!.locked = !track.locked;}))}>L</button>
              {track.kind !== 'lyrics' && <button aria-label={`Mute ${track.name}`} aria-pressed={track.muted} onClick={() => attempt(() => useEditor.getState().edit(d => {d.tracks.find(t => t.id === track.id)!.muted = !track.muted;}))}>M</button>}
              {track.kind !== 'audio' && <button aria-label={`Hide ${track.name}`} aria-pressed={!track.visible} onClick={() => attempt(() => useEditor.getState().edit(d => {d.tracks.find(t => t.id === track.id)!.visible = !track.visible;}))}>V</button>}
              <button aria-label={`Move ${track.name} up`} disabled={index === project.tracks.length - 1} onClick={() => attempt(() => useEditor.getState().edit(d => {[d.tracks[index], d.tracks[index + 1]] = [d.tracks[index + 1], d.tracks[index]];}))}>↑</button>
              <button aria-label={`Move ${track.name} down`} disabled={!index} onClick={() => attempt(() => useEditor.getState().edit(d => {[d.tracks[index], d.tracks[index - 1]] = [d.tracks[index - 1], d.tracks[index]];}))}>↓</button>
              <button aria-label={`Delete track ${track.name}`} onClick={() => attempt(() => useEditor.getState().edit(d => {d.clips = d.clips.filter(c => c.trackId !== track.id); d.tracks = d.tracks.filter(t => t.id !== track.id);}))}>×</button>
            </div></div>
          <div className="track-lane" style={{width: length}} data-track-id={track.id} data-video-layer={track.kind === 'visual' ? visualIndex : undefined}
            onPointerDown={rectangleSelect} onDragOver={e => track.kind === 'visual' && e.preventDefault()} onDrop={e => track.kind === 'visual' && drop(e, visualIndex)}>
            {project.clips.filter(c => c.trackId === track.id).map(clip => {
              const shown = ghost?.ids.includes(clip.id) ? ghost : null, start = clip.startMs + (shown && shown.edge !== 'right' ? shown.delta : 0);
              const duration = clip.durationMs + (shown?.edge ? shown.delta * (shown.edge === 'left' ? -1 : 1) : 0);
              return <div key={clip.id} data-clip-id={clip.id} role="button" tabIndex={0} aria-label={`${track.name}: ${label(clip)}`} aria-pressed={selectedIds.includes(clip.id)}
                className={`timeline-clip ${selectedIds.includes(clip.id) ? 'selected' : ''}`} style={{left: start / 1000 * zoom, width: Math.max(6, duration / 1000 * zoom)}}
                onPointerDown={e => drag(e, clip)} onClick={e => {if (dragged.current) {dragged.current = false; return;} select(identity(clip), e.ctrlKey || e.metaKey ? 'toggle' : e.shiftKey ? 'range' : 'single');}}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {e.preventDefault(); select(identity(clip), e.ctrlKey || e.metaKey ? 'toggle' : 'single');}
                  if (['ArrowLeft', 'ArrowRight'].includes(e.key)) {e.preventDefault(); attempt(() => commit(moveClips(project, selectedIds.includes(clip.id) ? selectedIds : [clip.id], Math.round(1000 / project.fps) * (e.key === 'ArrowLeft' ? -1 : 1))));}
                  if (e.key === 'Delete') {e.preventDefault(); attempt(() => commit(deleteClips(project, selectedIds.includes(clip.id) ? selectedIds : [clip.id])));}
                }}>
                <button className="trim-handle left" aria-label={`Trim start ${label(clip)}`} onPointerDown={e => drag(e, clip, 'left')} /><span>{label(clip)}</span>
                <button className="trim-handle right" aria-label={`Trim end ${label(clip)}`} onPointerDown={e => drag(e, clip, 'right')} />
              </div>;
            })}
          </div>
        </div>;
      })}
      <div className="playhead" style={{left: 130 + frame / project.fps * zoom}} />
    </div></div>
    {rectangle && <div className="selection-rectangle" style={{position: 'fixed', left: rectangle.x, top: rectangle.y, width: rectangle.width, height: rectangle.height}} />}
    <small className="helper">Ctrl/Cmd-click toggles; Shift-click selects a range. Drag empty space to select. Alt trims grouped clips individually and bypasses snapping.</small>
    {selection && <span className="sr-only">Primary selection {selection.id}</span>}
  </section>;
}
