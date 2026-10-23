import {useEffect, useRef, useState} from 'react';
import WaveSurfer from 'wavesurfer.js';
import {snapTime, timeLine, moveLine} from '../../packages/editor-core/commands';
import type {Asset, Project} from '../../packages/project-model/model';
import {useEditor, type Selection} from './store';

export function Waveform({src, time, seek}: {src: string; time: number; seek: (ms: number) => void}) {
  const container = useRef<HTMLDivElement>(null), wave = useRef<WaveSurfer | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setError('');
    const instance = WaveSurfer.create({container: container.current!, url: src, height: 46,
      waveColor: '#bac4d8', progressColor: '#6654c7', cursorWidth: 0, normalize: true, interact: false});
    wave.current = instance;
    instance.on('error', () => setError('Waveform unavailable; playback still works.'));
    return () => {wave.current = null; instance.destroy();};
  }, [src]);
  useEffect(() => {if (wave.current?.getDuration()) wave.current.setTime(time / 1000);}, [time]);
  return <div className="waveform" onClick={e => {const rect = e.currentTarget.getBoundingClientRect();
    const duration = wave.current?.getDuration(); if (duration) seek((e.clientX - rect.left) / rect.width * duration * 1000);}}>
    <div ref={container} />{error && <small>{error}</small>}
  </div>;
}

export function Timeline({project, frame, selection, select, seek, attempt, audioUrl, addBackground}: {
  project: Project; frame: number; selection: Selection; select: (s: Selection) => void;
  seek: (ms: number) => void; attempt: (fn: () => void) => void; audioUrl?: string;
  addBackground: (asset: Asset, startMs: number, layer: number) => void;
}) {
  const [zoom, setZoom] = useState(36), [snapping, setSnapping] = useState(true);
  const [ghost, setGhost] = useState<{id: string; start: number; duration: number; layer: number} | null>(null);
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);
  const length = Math.max(700, project.durationMs / 1000 * zoom);
  const topLayer = Math.max(0, ...project.backgrounds.map(c => c.layer));
  const layers = Array.from({length: Math.min(500, topLayer + 2)}, (_, i) => i).reverse();
  const rows = [
    {kind: 'audio' as const, layer: -1, title: 'Audio', clips: project.audioClips.map(c => ({...c, text: project.assets.find(a => a.id === c.assetId)?.name ?? 'Audio'}))},
    ...layers.map(layer => ({kind: 'video' as const, layer, title: layer > topLayer ? '+ Layer' : `Layer ${layer + 1}`,
      clips: project.backgrounds.filter(c => (ghost?.id === c.id ? ghost.layer : c.layer) === layer)
        .map(c => ({...c, text: project.assets.find(a => a.id === c.assetId)?.name ?? 'Background'}))})),
    {kind: 'lyric' as const, layer: -1, title: 'Lyrics', clips: project.lines.filter(l => l.startMs !== null).map(l => ({id: l.id, text: l.text, startMs: l.startMs!, durationMs: l.durationMs!}))},
  ];
  function drag(event: React.PointerEvent, kind: 'audio' | 'video' | 'lyric', clip: {id: string; startMs: number; durationMs: number; layer?: number}, edge: 'move' | 'left' | 'right') {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation(); select({kind, id: clip.id});
    const origin = event.clientX;
    let proposed = {id: clip.id, start: clip.startMs, duration: clip.durationMs, layer: clip.layer ?? 0};
    const move = (e: PointerEvent) => {
      const delta = (e.clientX - origin) * 1000 / zoom;
      const point = snapTime((edge === 'right' ? clip.startMs + clip.durationMs : clip.startMs) + delta, project, zoom, snapping && !e.altKey, frame * 1000 / project.fps);
      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-video-layer]');
      proposed = {id: clip.id, start: edge === 'right' ? clip.startMs : edge === 'move' ? Math.min(point, project.durationMs - clip.durationMs) : point,
        layer: kind === 'video' && edge === 'move' && target ? Number(target.dataset.videoLayer) : proposed.layer,
        duration: edge === 'move' ? clip.durationMs : edge === 'left' ? clip.startMs + clip.durationMs - point : point - clip.startMs};
      setGhost(proposed);
    };
    const stop = () => {window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish); window.removeEventListener('pointercancel', cancel); cleanup.current = null; setGhost(null);};
    const cancel = () => stop();
    const finish = () => {
      stop();
      if (proposed.start === clip.startMs && proposed.duration === clip.durationMs && proposed.layer === (clip.layer ?? 0)) return;
      attempt(() => useEditor.getState().edit(draft => {
        if (kind === 'lyric') {
          const line = draft.lines.find(l => l.id === clip.id)!;
          if (edge === 'move') {moveLine(line, proposed.start); line.status = 'manual';}
          else timeLine(line, proposed.start, proposed.start + proposed.duration);
        } else {
          const media = (kind === 'audio' ? draft.audioClips : draft.backgrounds).find(c => c.id === clip.id)!;
          if (edge === 'left' && draft.assets.find(a => a.id === media.assetId)?.kind !== 'image') media.sourceInMs += proposed.start - clip.startMs;
          media.startMs = proposed.start; media.durationMs = proposed.duration;
          if (kind === 'video') media.layer = proposed.layer;
        }
      }));
    };
    cleanup.current?.(); cleanup.current = stop;
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', finish, {once: true}); window.addEventListener('pointercancel', cancel, {once: true});
  }
  return <section className="timeline-panel" aria-label="Timeline">
    <div className="timeline-toolbar"><h2>Timeline</h2><span>Drop media onto a layer or + Layer. Drag clips across time and layers. Drag edges to trim. Alt bypasses snapping.</span>
      <label><input type="checkbox" checked={snapping} onChange={e => setSnapping(e.target.checked)} /> Snap</label>
      <label>Zoom <input aria-label="Timeline zoom" type="range" min="10" max="160" value={zoom} onChange={e => setZoom(Number(e.target.value))} /></label></div>
    <div className="timeline-scroll"><div className="timeline-content" style={{width: length + 96}}>
      <div className="ruler" style={{marginLeft: 96, width: length}} onClick={e => seek((e.clientX - e.currentTarget.getBoundingClientRect().left) / zoom * 1000)}>
        {Array.from({length: Math.ceil(project.durationMs / 5000) + 1}, (_, i) => <span key={i} style={{left: i * 5 * zoom}}>{i * 5}s</span>)}
      </div>
      {rows.map(row => <div className={`track ${row.kind}`} key={`${row.kind}-${row.layer}`}><div className="track-label">{row.title}<small>{row.clips.length} clips</small></div>
        <div className="track-lane" data-video-layer={row.kind === 'video' ? row.layer : undefined}
          aria-label={row.kind === 'video' ? `${row.title} timeline` : undefined} style={{width: length}} onDoubleClick={e => seek((e.clientX - e.currentTarget.getBoundingClientRect().left) / zoom * 1000)}
          onDragOver={e => {
            if (row.kind === 'video' && e.dataTransfer.types.includes('application/x-lyrics-studio-asset')) {
              e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
            }
          }}
          onDrop={e => {
            if (row.kind !== 'video') return;
            const asset = project.assets.find(a => a.id === e.dataTransfer.getData('application/x-lyrics-studio-asset'));
            if (!asset || asset.kind === 'audio') return;
            e.preventDefault();
            const startMs = snapTime((e.clientX - e.currentTarget.getBoundingClientRect().left) / zoom * 1000,
              project, zoom, snapping && !e.altKey, frame * 1000 / project.fps);
            attempt(() => addBackground(asset, startMs, row.layer));
          }}>
          {row.kind === 'audio' && audioUrl && <Waveform src={audioUrl} time={frame * 1000 / project.fps} seek={seek} />}
          {row.clips.map(clip => {
            const shown = ghost?.id === clip.id ? ghost : {start: clip.startMs, duration: clip.durationMs};
            return <div key={clip.id} role="button" tabIndex={0} aria-label={`Select ${row.kind} ${clip.text}`}
              className={`timeline-clip ${selection?.id === clip.id ? 'selected' : ''}`} style={{left: shown.start / 1000 * zoom, width: Math.max(6, shown.duration / 1000 * zoom)}}
              onClick={() => select({kind: row.kind, id: clip.id})} onPointerDown={e => drag(e, row.kind, clip, 'move')}
              onKeyDown={e => {
                if (e.key === 'Enter') select({kind: row.kind, id: clip.id});
                if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
                e.preventDefault(); const next = clip.startMs + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 1000 : Math.round(1000 / project.fps));
                attempt(() => useEditor.getState().edit(d => {
                  if (row.kind === 'lyric') {const l = d.lines.find(l => l.id === clip.id)!; moveLine(l, next); l.status = 'manual';}
                  else (row.kind === 'audio' ? d.audioClips : d.backgrounds).find(c => c.id === clip.id)!.startMs = next;
                }));
              }}>
              <button className="trim-handle left" aria-label={`Trim start ${clip.text}`} onPointerDown={e => drag(e, row.kind, clip, 'left')} />
              <span>{clip.text}</span>
              <button className="trim-handle right" aria-label={`Trim end ${clip.text}`} onPointerDown={e => drag(e, row.kind, clip, 'right')} />
            </div>;
          })}
        </div>
      </div>)}
      <div className="playhead" style={{left: 96 + frame / project.fps * zoom}} />
    </div></div>
  </section>;
}
