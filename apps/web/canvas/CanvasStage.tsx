import {useEffect, useMemo, useRef, useState, type RefObject} from 'react';
import {flushSync} from 'react-dom';
import {Player, type PlayerRef} from '@remotion/player';
import type {TimelineProject} from '../../../packages/project-model/timeline';
import type {ObjectTransform} from '../../../packages/project-model/canvas';
import {durationFrames} from '../../../packages/project-model/proof';
import {objectTransform, visibleObjects, type CanvasClip} from '../../../packages/editor-core/canvas-transforms';
import {TimelineVideo} from '../../../packages/video-composition/TimelineVideo';
import {timelineClipSchema, trackSchema} from '../../../packages/project-model/timeline';
import {deleteClips, updateLine} from '../../../packages/editor-core/timeline-commands';
import {useEditor} from '../store';
import {CanvasOverlay} from './CanvasOverlay';
import {CanvasToolbar} from './CanvasToolbar';
import {TransformControls} from './TransformControls';

export function CanvasStage({project, assets, player, frame, selectedIds, select, attempt, rate, loopRange}: {
  project: TimelineProject; assets: Record<string, string>; player: RefObject<PlayerRef | null>; frame: number; selectedIds: string[];
  select: (clip: CanvasClip | null, toggle?: boolean) => void; attempt: (action: () => void) => void;
  rate: number; loopRange?: {inFrame: number; outFrame: number};
}) {
  const viewport = useRef<HTMLDivElement>(null), pending = useRef<Record<string, ObjectTransform>>({});
  const [root, setRoot] = useState<HTMLDivElement | null>(null), [available, setAvailable] = useState(500), [fitHeight, setFitHeight] = useState(300);
  const [zoom, setZoom] = useState(0), [snapping, setSnapping] = useState(true), [ratio, setRatio] = useState(true);
  const [editing, setEditing] = useState(true), [shift, setShift] = useState(false), [live, setLive] = useState<Record<string, ObjectTransform>>({});
  const [textEdit, setTextEdit] = useState<{id: string; value: string} | null>(null);
  useEffect(() => {
    const element = viewport.current, panel = element?.closest<HTMLElement>('.preview-panel');
    const toolbar = element?.previousElementSibling as HTMLElement | null;
    const observer = new ResizeObserver(() => {
      if (!element) return;
      setAvailable(element.clientWidth - 64);
      if (panel) setFitHeight(Math.max(100, panel.clientHeight - (panel.querySelector('.preview-heading')?.clientHeight ?? 52) -
        (toolbar?.clientHeight ?? 60) - (panel.querySelector('.transport')?.clientHeight ?? 60) - 184));
    });
    if (element) observer.observe(element); if (panel) observer.observe(panel); if (toolbar) observer.observe(toolbar);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {pending.current = {}; setLive({}); setTextEdit(null);}, [project.id]);
  const scale = zoom || Math.min(available / project.width, fitHeight / project.height);
  const objects = visibleObjects(project, frame);
  const selected = objects.filter(c => selectedIds.includes(c.id) && !c.locked && !project.tracks.find(t => t.id === c.trackId)?.locked);
  const previewProject = useMemo(() => Object.keys(live).length ? {...project,
    clips: project.clips.map(c => live[c.id] ? {...c, transform: live[c.id]} : c)} : project, [project, live]);
  const apply = (values: Record<string, ObjectTransform>) => useEditor.getState().edit(d => {
    for (const clip of d.clips) if (values[clip.id]) clip.transform = values[clip.id];
  });
  const finish = (cancel = false) => {
    const values = pending.current; pending.current = {}; setLive({});
    if (!cancel && Object.keys(values).length) attempt(() => apply(values));
  };
  function align(axis: 'x' | 'y') {
    if (!selected.length) return;
    const transforms = selected.map(c => objectTransform(project, c));
    const minimum = Math.min(...transforms.map(t => t[axis]));
    const maximum = Math.max(...transforms.map(t => t[axis] + t[axis === 'x' ? 'width' : 'height']));
    const delta = (project[axis === 'x' ? 'width' : 'height'] - maximum - minimum) / 2;
    attempt(() => apply(Object.fromEntries(selected.map((c, i) => [c.id, {...transforms[i], [axis]: transforms[i][axis] + delta}]))));
  }
  function addText() {
    attempt(() => {
      const id = crypto.randomUUID();
      useEditor.getState().edit(d => {
        const track = trackSchema.parse({id: crypto.randomUUID(), name: 'Text', kind: 'visual'}); d.tracks.push(track);
        d.clips.push(timelineClipSchema.parse({id, trackId: track.id, kind: 'text', text: 'Your text',
          style: {...d.style, karaoke: 'none'}, startMs: Math.min(Math.round(frame * 1000 / d.fps), d.durationMs - Math.ceil(1000 / d.fps)),
          durationMs: Math.min(3000, d.durationMs - Math.min(Math.round(frame * 1000 / d.fps), d.durationMs - Math.ceil(1000 / d.fps)))}));
      });
      select(useEditor.getState().project!.clips.find(c => c.id === id) as CanvasClip);
    });
  }
  useEffect(() => {
    const keyboard = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShift(e.type === 'keydown');
      if (e.type !== 'keydown' || (e.target as HTMLElement).closest('input,textarea,select,[contenteditable]')) return;
      if (!editing || !selected.length || !(e.target as HTMLElement).closest('.canvas-stage')) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {e.preventDefault(); attempt(() => {useEditor.getState().commit(deleteClips(project, selectedIds)); select(null);}); return;}
      const direction = {ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]}[e.key];
      if (direction) {
        e.preventDefault(); const amount = e.shiftKey ? 10 : 1;
        attempt(() => apply(Object.fromEntries(selected.map(c => {const t = objectTransform(project, c);
          return [c.id, {...t, x: t.x + direction[0] * amount, y: t.y + direction[1] * amount}];}))));
      }
    };
    window.addEventListener('keydown', keyboard); window.addEventListener('keyup', keyboard);
    return () => {window.removeEventListener('keydown', keyboard); window.removeEventListener('keyup', keyboard);};
  }, [project, frame, selectedIds, editing]);
  const editText = (clip: CanvasClip) => {if (clip.kind !== 'visual') {player.current?.pause(); setTextEdit({id: clip.id, value: clip.text});}};
  return <div className="canvas-stage" tabIndex={-1}>
    <CanvasToolbar {...{zoom, setZoom, snapping, setSnapping, editing, setEditing, ratio, setRatio, addText, align}} />
    <div className="canvas-viewport" ref={viewport} style={{maxHeight: fitHeight + 64}}><div style={{position: 'relative', width: project.width * scale, height: project.height * scale, margin: 'auto'}}>
      <div className="canvas-project" style={{width: project.width, height: project.height, transform: `scale(${scale})`}}>
        <Player ref={player} component={TimelineVideo} inputProps={{project: previewProject, assets}}
          compositionWidth={project.width} compositionHeight={project.height} durationInFrames={durationFrames(project)} fps={project.fps}
          playbackRate={rate} loop={Boolean(loopRange)} inFrame={loopRange?.inFrame} outFrame={loopRange?.outFrame}
          numberOfSharedAudioTags={0} style={{width: project.width, height: project.height}} />
        {editing && !textEdit && <><CanvasOverlay {...{project, objects, selectedIds, live, select, editText, setRoot}} />
          <TransformControls {...{project, root, snapping, scale}} constrainRotation={shift} clips={selected} ratio={shift || (ratio && selected.some(c => c.kind === 'visual'))}
            start={() => {player.current?.pause(); pending.current = {};}}
            preview={values => {pending.current = values; flushSync(() => setLive(values));}} finish={finish} /></>}
      </div>
    </div></div>
    {textEdit && <div className="canvas-text-editor"><label>Edit canvas text<textarea autoFocus aria-label="Edit canvas text" value={textEdit.value}
      onChange={e => setTextEdit({...textEdit, value: e.target.value})} /></label>
      <button onClick={() => attempt(() => {
        useEditor.getState().edit(d => {const clip = d.clips.find(c => c.id === textEdit.id);
          if (clip?.kind === 'text') clip.text = textEdit.value;
          if (clip?.kind === 'lyric') updateLine(d, clip.sourceLineId, line => {line.text = textEdit.value; line.status = 'manual';});
        }); setTextEdit(null);
      })}>Apply text</button><button onClick={() => setTextEdit(null)}>Cancel</button></div>}
  </div>;
}
