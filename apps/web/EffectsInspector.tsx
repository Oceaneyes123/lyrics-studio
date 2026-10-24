import type {Clip, TimelineProject} from '../../packages/project-model/timeline';
import {effectsSchema, transitionSchema, type VisualEffects, type VisualTransition} from '../../packages/project-model/effects';
import {useEditor} from './store';
import {NumberField} from './Fields';

export function EffectsInspector({project, clips, attempt}: {project: TimelineProject; clips: Extract<Clip, {kind: 'visual'}>[]; attempt: (action: () => void) => void}) {
  if (!clips.length) return null;
  const clip = clips[0], effects = effectsSchema.parse(clip.effects ?? {}), ids = new Set(clips.map(c => c.id));
  const edit = (action: (effects: VisualEffects) => void) => attempt(() => useEditor.getState().edit(draft => {
    for (const clip of draft.clips) if (clip.kind === 'visual' && ids.has(clip.id)) {clip.effects ??= effectsSchema.parse({}); action(clip.effects);}
  }));
  const transition = project.transitions.find(t => t.toClipId === clip.id || t.fromClipId === clip.id);
  const ordered = project.clips.filter(c => c.trackId === clip.trackId).sort((a, b) => a.startMs - b.startMs), previous = ordered[ordered.indexOf(clip) - 1];
  const overlap = previous ? previous.startMs + previous.durationMs - clip.startMs : 0;
  const editTransition = (action: (transition: VisualTransition) => void) => attempt(() => useEditor.getState().edit(draft => action(draft.transitions.find(t => t.id === transition!.id)!)));
  return <section><h2>Visual effects{clips.length > 1 ? ` · ${clips.length} clips` : ''}</h2><div className="field-grid">
    {([['brightness', 0, 2, .05], ['contrast', 0, 2, .05], ['saturation', 0, 3, .05], ['hue', -180, 180, 1], ['blur', 0, 50, 1], ['backgroundBlur', 0, 50, 1]] as const).map(([property, min, max, step]) =>
      <NumberField key={property} label={property === 'backgroundBlur' ? 'Background blur (px)' : property === 'blur' ? 'Blur (px)' : property === 'hue' ? 'Hue (degrees)' : property[0].toUpperCase() + property.slice(1)}
        value={effects[property]} min={min} max={max} step={step} change={value => edit(effects => {effects[property] = value;})} />)}
    </div><label>Mask<select aria-label="Mask shape" value={effects.mask?.shape ?? 'none'} onChange={e => edit(effects => {
      if (e.target.value === 'none') delete effects.mask; else effects.mask = {...(effects.mask ?? {x: 0, y: 0, width: 100, height: 100}), shape: e.target.value as 'rectangle' | 'ellipse'};
    })}><option value="none">None</option><option value="rectangle">Rectangle</option><option value="ellipse">Ellipse</option></select></label>
    {effects.mask && <div className="field-grid">{(['x', 'y', 'width', 'height'] as const).map(property => <NumberField key={property} label={`Mask ${property} (%)`}
      value={effects.mask![property]} min={property === 'width' || property === 'height' ? 1 : 0} max={100} change={value => edit(effects => {effects.mask ??= {...effectsSchema.parse({mask: {shape: 'rectangle'}}).mask!}; effects.mask[property] = value;})} />)}</div>}
    <button onClick={() => attempt(() => useEditor.getState().edit(draft => {for (const c of draft.clips) if (c.kind === 'visual' && ids.has(c.id)) delete c.effects;}))}>Reset visual effects</button>
    {clips.length === 1 && <><h2>Transition</h2>{transition ? <>
      <p className="helper">Linked overlapping neighbors. Remove this transition before separating or deleting its partners.</p>
      <label>Type<select aria-label="Transition type" value={transition.type} onChange={e => editTransition(t => {t.type = e.target.value as typeof t.type;})}>
        {['dissolve', 'slide', 'zoom', 'wipe', 'blur'].map(type => <option key={type}>{type}</option>)}</select></label>
      <NumberField label="Transition duration (s)" value={transition.durationMs / 1000} min={.001} max={5} change={value => editTransition(t => {t.durationMs = Math.round(value * 1000);})} />
      {(transition.type === 'slide' || transition.type === 'wipe') && <label>Direction<select aria-label="Transition direction" value={transition.direction} onChange={e => editTransition(t => {t.direction = e.target.value as typeof t.direction;})}>
        {['left', 'right', 'up', 'down'].map(direction => <option key={direction}>{direction}</option>)}</select></label>}
      {['slide', 'zoom', 'blur'].includes(transition.type) && <NumberField label="Transition amount" value={transition.amount} min={0} max={100} change={value => editTransition(t => {t.amount = value;})} />}
      <label>Easing<select aria-label="Transition easing" value={transition.easing} onChange={e => editTransition(t => {t.easing = e.target.value as typeof t.easing;})}>
        {['linear', 'hold', 'ease-in', 'ease-out', 'ease-in-out'].map(easing => <option key={easing}>{easing}</option>)}</select></label>
      <button onClick={() => attempt(() => useEditor.getState().edit(draft => {draft.transitions = draft.transitions.filter(t => t.id !== transition.id);} ))}>Remove transition</button>
    </> : <button disabled={!previous || overlap <= 0 || clip.startMs + clip.durationMs < previous.startMs + previous.durationMs} onClick={() => attempt(() => useEditor.getState().edit(draft => {
      draft.transitions.push(transitionSchema.parse({id: crypto.randomUUID(), fromClipId: previous.id, toClipId: clip.id, type: 'dissolve', durationMs: Math.min(500, overlap)}));
    }))}>Add transition from overlapping previous clip</button>}</>}
    <small>Blur caps at 50 px. Background blur adds a muted copy behind the sharp picture. Masks and transition wipes use separate wrappers.</small>
  </section>;
}
