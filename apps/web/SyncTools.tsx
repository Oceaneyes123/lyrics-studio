import {useEffect, useState, type RefObject} from 'react';
import type {PlayerRef} from '@remotion/player';
import type {TimelineProject} from '../../packages/project-model/timeline';
import {lines, updateLine, type Line} from '../../packages/editor-core/timeline-commands';
import {applyTaps, wordBoundary} from '../../packages/editor-core/synchronization';
import {useEditor} from './store';
import {Waveform} from './Waveform';

export function SyncTools({project, line, player, urls, frame, seek, attempt}: {
  project: TimelineProject; line?: Line; player: RefObject<PlayerRef | null>; urls: Record<string, string>;
  frame: number; seek: (ms: number) => void; attempt: (action: () => void) => void;
}) {
  const [zoom, setZoom] = useState(1), [tapping, setTapping] = useState(false);
  const [session, setSession] = useState<{ids: string[]; text: string; taps: number[]; end?: number} | null>(null);
  const reference = project.clips.find(c => c.id === project.alignmentSourceClipId);
  const asset = reference?.kind === 'audio' ? project.assets.find(a => a.id === reference.assetId) : undefined;
  const placement = project.clips.find(c => c.kind === 'lyric' && c.sourceLineId === line?.id);
  const locked = project.tracks.find(t => t.id === placement?.trackId)?.locked;
  const sample = () => Math.round((player.current?.getCurrentFrame() ?? 0) * 1000 / project.fps);
  function tap() {attempt(() => {
    const at = sample();
    if (!session || session.taps.length >= session.ids.length) throw new Error('All line starts are captured; finish at the playhead');
    if ((session.taps.at(-1) ?? -1) >= at) throw new Error('Advance playback before the next tap');
    setSession({...session, taps: [...session.taps, at]});
  });}
  useEffect(() => {
    if (!tapping) return;
    const key = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.code !== 'KeyT' || (event.target as HTMLElement).closest('input,textarea,select,[contenteditable]')) return;
      event.preventDefault(); tap();
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  });
  useEffect(() => {setSession(null); setTapping(false);}, [project.id]);
  function drag(event: React.PointerEvent<HTMLButtonElement>, index: number, edge: 'startMs' | 'endMs') {
    if (!line || locked) return;
    event.preventDefault(); const button = event.currentTarget, lane = button.closest<HTMLElement>('.word-wave-lane')!;
    button.setPointerCapture(event.pointerId);
    const update = (e: PointerEvent) => {const rect = lane.getBoundingClientRect();
      button.style.left = `${Math.max(0, Math.min(100, (e.clientX - rect.left) / rect.width * 100))}%`;};
    const finish = (e: PointerEvent) => {
      button.removeEventListener('pointermove', update); button.removeEventListener('pointerup', finish);
      button.removeEventListener('pointercancel', cancel); button.style.left = `${line.words[index][edge] / line.durationMs! * 100}%`;
      const rect = lane.getBoundingClientRect();
      attempt(() => useEditor.getState().edit(draft => updateLine(draft, line.id, l => wordBoundary(l, index, edge, (e.clientX - rect.left) / rect.width * line.durationMs!))));
    };
    const cancel = () => {button.removeEventListener('pointermove', update); button.removeEventListener('pointerup', finish);
      button.removeEventListener('pointercancel', cancel); button.style.left = `${line.words[index][edge] / line.durationMs! * 100}%`;};
    button.addEventListener('pointermove', update); button.addEventListener('pointerup', finish); button.addEventListener('pointercancel', cancel);
  }
  const sourceStart = line?.startMs !== null && line?.startMs !== undefined && reference?.kind === 'audio' ? line.startMs - reference.startMs + reference.sourceInMs : -1;
  return <section className="sync-tools"><h2>Synchronize lyrics</h2>
    {line?.durationMs && <><label>Word waveform zoom<input aria-label="Word waveform zoom" type="range" min="1" max="8" step=".5" value={zoom} onChange={e => setZoom(Number(e.target.value))} /></label>
      <div className="word-wave-scroll"><div className="word-wave-lane" style={{width: `${zoom * 100}%`}}>
        {asset && sourceStart >= 0 && sourceStart + line.durationMs <= asset.durationMs && <Waveform src={urls[asset.file]} time={frame * 1000 / project.fps - (reference?.startMs ?? 0)}
          range={{startMs: sourceStart, endMs: sourceStart + line.durationMs, sourceDurationMs: asset.durationMs}} seek={ms => seek(ms + reference!.startMs - (reference?.kind === 'audio' ? reference.sourceInMs : 0))} />}
        {line.words.map((word, index) => word.untimed ? null : <div key={word.id ?? index}>
          <span className="word-wave-span" style={{left: `${word.startMs / line.durationMs! * 100}%`, width: `${(word.endMs - word.startMs) / line.durationMs! * 100}%`}}>{word.text}</span>
          {(['startMs', 'endMs'] as const).map(edge => <button key={edge} className="word-boundary" disabled={locked}
            aria-label={`Word ${index + 1} ${edge === 'startMs' ? 'start' : 'end'} boundary`} style={{left: `${word[edge] / line.durationMs! * 100}%`, top: edge === 'startMs' ? 0 : 44, height: 42}}
            onPointerDown={e => drag(e, index, edge)} onKeyDown={e => {
              if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return; e.preventDefault();
              attempt(() => useEditor.getState().edit(draft => updateLine(draft, line.id, l => wordBoundary(l, index, edge,
                word[edge] + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 100 : 10)))));
            }} />)}
        </div>)}
      </div></div><p className="helper">Drag word edges; arrow keys adjust 10 ms, Shift adjusts 100 ms. Gaps remain visible.</p>
      {line.words.some(w => w.untimed) && <p>Untimed: {line.words.filter(w => w.untimed).map(w => w.text).join(' ')}</p>}</>}
    {!session ? <button onClick={() => {const all = lines(project), index = Math.max(0, all.findIndex(l => l.id === line?.id));
      setSession({ids: all.slice(index).map(l => l.id), text: JSON.stringify(all.map(l => [l.id, l.text])), taps: []}); setTapping(true);}}>Arm tap timing</button> : <>
      <p role="status">{tapping ? 'Armed: press T or Tap at each line start.' : 'Review timing before applying.'} {session.taps.length}/{session.ids.length} starts captured.</p>
      {tapping && <><button onClick={tap} disabled={session.taps.length >= session.ids.length}>Tap line start (T)</button>
        <button disabled={!session.taps.length} onClick={() => {setSession({...session, end: sample()}); setTapping(false); player.current?.pause();}}>Finish at playhead</button></>}
      <button disabled={!session.taps.length} onClick={() => {setSession({...session, taps: session.taps.slice(0, -1), end: undefined}); setTapping(true);}}>Undo last tap</button>
      {session.end !== undefined && <><ol>{session.taps.map((at, i) => <li key={i}>{lines(project).find(l => l.id === session.ids[i])?.text}: {(at / 1000).toFixed(3)}s</li>)}</ol>
        <button onClick={() => attempt(() => {
          if (session.text !== JSON.stringify(lines(project).map(l => [l.id, l.text]))) throw new Error('Lyrics changed while tapping. Cancel and start again.');
          useEditor.getState().commit(applyTaps(project, session.ids, session.taps, session.end!)); setSession(null); setTapping(false);
        })}>Apply tap timing</button></>}
      <button onClick={() => {setSession(null); setTapping(false);}}>Cancel tapping</button>
    </>}
  </section>;
}
