import type {TimelineProject} from '../../../packages/project-model/timeline';
import type {ObjectTransform} from '../../../packages/project-model/canvas';
import {objectTransform, type CanvasClip} from '../../../packages/editor-core/canvas-transforms';
import {copyClips, pasteClips, deleteClips, changeTimeline} from '../../../packages/editor-core/timeline-commands';
import {trackSchema} from '../../../packages/project-model/timeline';
import {useEditor} from '../store';
import {NumberField} from '../Fields';

export function TransformInspector({project, clip, selectedIds, select, attempt}: {
  project: TimelineProject; clip: CanvasClip; selectedIds: string[]; select: (clip: CanvasClip | null) => void; attempt: (action: () => void) => void;
}) {
  const ids = selectedIds.length ? selectedIds : [clip.id], t = objectTransform(project, clip);
  const locked = clip.locked || project.tracks.find(track => track.id === clip.trackId)?.locked;
  const patch = (values: Partial<ObjectTransform>) => attempt(() => useEditor.getState().edit(d => {
    const target = d.clips.find(c => c.id === clip.id) as CanvasClip;
    target.transform = {...objectTransform(d, target), ...values};
  }));
  const duplicate = () => attempt(() => {
    const clipboard = copyClips(project, ids), tracks = new Map<string, string>();
    const base = changeTimeline(project, d => {
      for (const c of clipboard.clips) {
        if (c.locked || d.tracks.find(t => t.id === c.trackId)?.locked) throw new Error('Unlock objects before duplicating');
        const original = c.trackId;
        if (!tracks.has(original)) {
          const track = trackSchema.parse({...d.tracks.find(t => t.id === original), id: crypto.randomUUID(), name: 'Copy', locked: false});
          d.tracks.splice(d.tracks.findIndex(t => t.id === original) + 1, 0, track); tracks.set(original, track.id);
        }
        c.trackId = tracks.get(original)!;
      }
    });
    const next = pasteClips(base, clipboard, Math.min(...clipboard.clips.map(c => c.startMs)));
    useEditor.getState().commit(next); select(next.clips.at(-1) as CanvasClip);
  });
  const order = (direction: number) => attempt(() => useEditor.getState().edit(d => {
    const target = d.clips.find(c => c.id === clip.id)!, index = d.tracks.findIndex(t => t.id === target.trackId);
    const track = trackSchema.parse({...d.tracks[index], id: crypto.randomUUID(), name: `${clip.kind} layer`, locked: false});
    d.tracks.splice(Math.max(0, Math.min(d.tracks.length, index + (direction > 0 ? 2 : -1))), 0, track); target.trackId = track.id;
  }));
  const text = clip.kind === 'text' ? clip : null;
  const textStyle = (values: object) => attempt(() => useEditor.getState().edit(d => {
    const target = d.clips.find(c => c.id === clip.id); if (target?.kind === 'text') Object.assign(target.style, values);
  }));
  return <section className="transform-inspector"><h2>Canvas object</h2>
    <fieldset disabled={Boolean(locked)}><div className="field-grid">
      {(['x', 'y', 'width', 'height', 'rotation', 'opacity', 'anchorX', 'anchorY'] as const).map(key =>
        <NumberField key={key} label={`Object ${key}`} value={t[key]} step={key === 'opacity' || key.startsWith('anchor') ? .05 : 1}
          min={key === 'width' || key === 'height' ? 1 : key === 'opacity' || key.startsWith('anchor') ? 0 : undefined}
          max={key === 'opacity' || key.startsWith('anchor') ? 1 : undefined} change={n => patch({[key]: n})} />)}
    </div>
    {clip.kind === 'visual' && <label>Object fit<select aria-label="Object fit" value={t.fit} onChange={e => patch({fit: e.target.value as 'cover' | 'contain'})}>
      <option value="cover">Cover</option><option value="contain">Contain</option></select></label>}
    <div className="inline"><button onClick={() => patch({flipX: !t.flipX})}>Flip horizontally</button><button onClick={() => patch({flipY: !t.flipY})}>Flip vertically</button></div>
    <button onClick={() => attempt(() => useEditor.getState().edit(d => {delete d.clips.find(c => c.id === clip.id)!.transform;}))}>Reset transform</button>
    <div className="inline"><button onClick={duplicate}>Duplicate object</button><button onClick={() => order(1)}>Bring forward</button><button onClick={() => order(-1)}>Send backward</button>
      <button onClick={() => attempt(() => {useEditor.getState().commit(deleteClips(project, ids)); select(null);})}>Delete object</button></div>
    <label><input type="checkbox" checked={Boolean(clip.hidden)} onChange={e => attempt(() => useEditor.getState().edit(d => {d.clips.find(c => c.id === clip.id)!.hidden = e.target.checked;}))} /> Hide object</label>
    {text && <><label>Text content<textarea aria-label="Text content" key={text.id + text.text} defaultValue={text.text} onBlur={e => {
      if (e.target.value !== text.text) attempt(() => useEditor.getState().edit(d => {const c = d.clips.find(c => c.id === text.id); if (c?.kind === 'text') c.text = e.target.value;}));
    }} /></label><div className="field-grid">
      <NumberField label="Text start (s)" value={text.startMs / 1000} change={n => attempt(() => useEditor.getState().edit(d => {d.clips.find(c => c.id === text.id)!.startMs = Math.round(n * 1000);}))} />
      <NumberField label="Text duration (s)" value={text.durationMs / 1000} change={n => attempt(() => useEditor.getState().edit(d => {d.clips.find(c => c.id === text.id)!.durationMs = Math.round(n * 1000);}))} />
      <NumberField label="Text size" value={text.style.fontSize} min={16} max={200} change={n => textStyle({fontSize: n})} />
      <NumberField label="Text outline" value={text.style.outline} min={0} max={8} change={n => textStyle({outline: n})} />
    </div><label>Text font<select aria-label="Text font" value={text.style.font} onChange={e => textStyle({font: e.target.value})}>
      {['Inter', 'Arial', 'Georgia', ...project.fonts.map(f => `font:${f.id}`)].map(font => <option key={font} value={font}>{project.fonts.find(f => `font:${f.id}` === font)?.name ?? font}</option>)}
    </select></label><label>Text alignment<select value={text.style.align} onChange={e => textStyle({align: e.target.value})}>
      {['left', 'center', 'right'].map(v => <option key={v}>{v}</option>)}</select></label>
    <label>Text color<input aria-label="Text color" type="color" value={text.style.color} onChange={e => textStyle({color: e.target.value})} /></label>
    <label><input type="checkbox" checked={text.style.shadow} onChange={e => textStyle({shadow: e.target.checked})} /> Text shadow</label>
    <label><input type="checkbox" checked={Boolean(text.boxBackground)} onChange={e => attempt(() => useEditor.getState().edit(d => {
      const c = d.clips.find(c => c.id === text.id); if (c?.kind === 'text') c.boxBackground = e.target.checked ? '#17212d' : undefined;
    }))} /> Text background</label>{text.boxBackground && <input aria-label="Text background color" type="color" value={text.boxBackground} onChange={e => attempt(() => useEditor.getState().edit(d => {
      const c = d.clips.find(c => c.id === text.id); if (c?.kind === 'text') c.boxBackground = e.target.value;
    }))} />}</>}
    </fieldset>
    <button aria-pressed={Boolean(clip.locked)} onClick={() => attempt(() => useEditor.getState().edit(d => {d.clips.find(c => c.id === clip.id)!.locked = !clip.locked;}))}>{clip.locked ? 'Unlock object' : 'Lock object'}</button>
  </section>;
}
