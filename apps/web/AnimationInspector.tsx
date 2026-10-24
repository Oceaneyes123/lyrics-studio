import {useState} from 'react';
import type {Clip, TimelineProject} from '../../packages/project-model/timeline';
import {animationProperties, colorProperties, propertyBounds, type AnimationProperty} from '../../packages/project-model/animation';
import {animatedValue} from '../../packages/video-composition/animation';
import {useEditor} from './store';
import {NumberField} from './Fields';

export function AnimationInspector({project, clip, frame, seek, attempt}: {project: TimelineProject; clip: Clip;
  frame: number; seek: (ms: number) => void; attempt: (action: () => void) => void}) {
  const [property, setProperty] = useState<AnimationProperty>('x');
  // shortcut: standalone text stays static; add its animation evaluator before enabling keyframe controls.
  if (clip.kind === 'audio' || clip.kind === 'text') return null;
  const at = Math.round(frame * 1000 / project.fps - clip.startMs), time = at + (clip.animation?.originMs ?? 0);
  const keys = clip.animation?.curves[property] ?? [], key = keys.find(key => key.timeMs === time);
  const style = clip.kind === 'lyric' ? clip.style ?? project.style : undefined;
  const fallback = property === 'fontSize' ? style?.fontSize ?? 52 : clip.kind === 'visual' ? clip[property] :
    property === 'x' || property === 'y' ? style![property] : property === 'rotation' ? 0 : 1;
  const value = animatedValue(clip.animation, property, at, fallback), [min, max] = propertyBounds[property];
  const inside = at >= 0 && at < clip.durationMs;
  function setKey(value: number, easing = key?.easing ?? 'linear') {
    attempt(() => useEditor.getState().edit(draft => {
      if (!inside) throw new Error('Seek inside this clip to add a keyframe');
      const target = draft.clips.find(c => c.id === clip.id)!;
      target.animation ??= {originMs: 0, curves: {}};
      target.animation.curves[property] = [...(target.animation.curves[property] ?? []).filter(k => k.timeMs !== time),
        {timeMs: time, value, easing}].sort((a, b) => a.timeMs - b.timeMs);
    }));
  }
  const previous = keys.filter(k => k.timeMs < time).at(-1), next = keys.find(k => k.timeMs > time);
  return <section><h2>Keyframe animation</h2>
    <label>Property<select aria-label="Animated property" value={property} onChange={e => setProperty(e.target.value as AnimationProperty)}>
      {animationProperties.filter(p => clip.kind === 'lyric' || p !== 'fontSize').map(p => <option key={p}>{p}</option>)}</select></label>
    <NumberField label="Keyframe value" value={value} min={min} max={max} step={.01} change={n => setKey(n)} />
    <label>Segment easing<select aria-label="Keyframe easing" value={key?.easing ?? 'linear'} onChange={e => setKey(value, e.target.value as NonNullable<typeof key>['easing'])}>
      {['linear', 'hold', 'ease-in', 'ease-out', 'ease-in-out'].map(e => <option key={e}>{e}</option>)}</select></label>
    <div className="inline"><button disabled={!inside} onClick={() => setKey(value)}>Add/update keyframe</button>
      <button disabled={!key} onClick={() => attempt(() => useEditor.getState().edit(draft => {
        const animation = draft.clips.find(c => c.id === clip.id)!.animation!;
        const remaining = animation.curves[property]!.filter(k => k.timeMs !== time);
        if (remaining.length) animation.curves[property] = remaining; else delete animation.curves[property];
      }))}>Delete keyframe</button>
      <button disabled={!keys.length} onClick={() => attempt(() => useEditor.getState().edit(draft => {delete draft.clips.find(c => c.id === clip.id)!.animation?.curves[property];}))}>Reset property animation</button>
      <button disabled={!previous || previous.timeMs < (clip.animation?.originMs ?? 0)} onClick={() => previous && seek(clip.startMs + previous.timeMs - (clip.animation?.originMs ?? 0))}>Previous keyframe</button>
      <button disabled={!next || next.timeMs - (clip.animation?.originMs ?? 0) >= clip.durationMs} onClick={() => next && seek(clip.startMs + next.timeMs - (clip.animation?.originMs ?? 0))}>Next keyframe</button>
    </div>{clip.kind === 'lyric' && colorProperties.map(property => {
      const keys = clip.animation?.colors?.[property] ?? [], key = keys.find(k => k.timeMs === time);
      const updateColor = (value: string, easing = key?.easing ?? 'linear') => attempt(() => useEditor.getState().edit(draft => {
        const target = draft.clips.find(c => c.id === clip.id)!; target.animation ??= {originMs: 0, curves: {}}; target.animation.colors ??= {};
        target.animation.colors[property] = [...keys.filter(k => k.timeMs !== time), {timeMs: time, value, easing}].sort((a, b) => a.timeMs - b.timeMs);
      }));
      return <div key={property}><label>{property === 'color' ? 'Text color keyframe' : 'Highlight color keyframe'}<input type="color" disabled={!inside}
        aria-label={`${property} keyframe`} value={key?.value ?? style![property]} onChange={e => updateColor(e.target.value)} /></label>
        <label>Color easing<select aria-label={`${property} keyframe easing`} disabled={!inside} value={key?.easing ?? 'linear'} onChange={e => updateColor(key?.value ?? style![property], e.target.value as NonNullable<typeof key>['easing'])}>
          {['linear', 'hold', 'ease-in', 'ease-out', 'ease-in-out'].map(easing => <option key={easing}>{easing}</option>)}</select></label>
        <button disabled={!key} onClick={() => attempt(() => useEditor.getState().edit(draft => {
          const colors = draft.clips.find(c => c.id === clip.id)!.animation!.colors!, remaining = keys.filter(k => k.timeMs !== time);
          if (remaining.length) colors[property] = remaining; else delete colors[property];
        }))}>Delete {property} keyframe</button>
        <button disabled={!keys.length} onClick={() => attempt(() => useEditor.getState().edit(draft => {delete draft.clips.find(c => c.id === clip.id)!.animation?.colors?.[property];}))}>Reset {property} animation</button></div>;
    })}<small>Times stay in milliseconds when FPS changes. Animated properties override static controls until reset.</small>
  </section>;
}
