import {useEffect, useState} from 'react';
import type {TimelineProject} from '../../packages/project-model/timeline';
import {textMotionSchema, type StylePreset, type TextMotion} from '../../packages/project-model/text';
import {lines, updateLine} from '../../packages/editor-core/timeline-commands';
import {applyPreset} from '../../packages/editor-core/presets';
import {api, useEditor} from './store';
import {NumberField} from './Fields';

export function TextTools({project, lineId, prepareImport, fontsChanged, perform, attempt}: {
  project: TimelineProject; lineId?: string; prepareImport: () => Promise<void>; fontsChanged: () => void;
  perform: (action: () => Promise<void>) => Promise<void>; attempt: (action: () => void) => void;
}) {
  const [presets, setPresets] = useState<StylePreset[]>([]), [selected, setSelected] = useState(''), [name, setName] = useState('');
  const [attribution, setAttribution] = useState('');
  useEffect(() => {api<StylePreset[]>('/presets').then(setPresets).catch(error => attempt(() => {throw error;}));}, [project.id]);
  const line = lines(project).find(l => l.id === lineId), preset = presets.find(p => p.id === selected);
  const motion = textMotionSchema.parse(line?.textMotion ?? project.textMotion ?? {});
  const edit = (action: (motion: TextMotion) => void) => attempt(() => useEditor.getState().edit(draft => {
    if (lineId) updateLine(draft, lineId, line => {line.textMotion ??= structuredClone(motion); action(line.textMotion);});
    else {draft.textMotion ??= structuredClone(motion); action(draft.textMotion);}
  }));
  async function importFont(file: File, replacement?: string) {
    if (file.size > 20 * 1024 * 1024) throw new Error('Font exceeds 20 MiB');
    await prepareImport(); const data = new FormData(); data.set('file', file);
    const version = useEditor.getState().version;
    const query = new URLSearchParams({attribution}); if (replacement) query.set('replace', replacement);
    const result = await api<{project: TimelineProject}>(`/projects/${project.id}/fonts?${query}`, {method: 'POST', body: data});
    const current = useEditor.getState(); if (current.project?.id !== project.id) return;
    const changed = current.version !== version;
    current.open(changed ? {...current.project, fonts: result.project.fonts, revision: result.project.revision} : result.project);
    if (changed) useEditor.getState().edit(() => {});
    fontsChanged();
  }
  return <section><h2>Fonts and templates</h2>
    <label>Font attribution (optional)<input aria-label="Font attribution" value={attribution} maxLength={2000} onChange={e => setAttribution(e.target.value)} /></label>
    <label>Import local font<input aria-label="Import font" type="file" accept=".ttf,.otf,.woff,.woff2" onChange={e => {
      const file = e.target.files?.[0]; e.target.value = ''; if (file) void perform(() => importFont(file));
    }} /></label>
    {project.fonts.map(font => <label key={font.id}>Repair {font.name}{font.attribution && <small>{font.attribution}</small>}<input aria-label={`Repair font ${font.name}`} type="file" accept=".ttf,.otf,.woff,.woff2" onChange={e => {
      const file = e.target.files?.[0]; e.target.value = ''; if (file) void perform(() => importFont(file, font.id));
    }} /></label>)}
    <NumberField label="Word emphasis scale" value={motion.emphasis.scale} min={1} max={2} step={.05} change={value => edit(m => {m.emphasis.scale = value;})} />
    <NumberField label="Word emphasis offset (px)" value={motion.emphasis.offsetY} min={-100} max={100} step={1} change={value => edit(m => {m.emphasis.offsetY = value;})} />
    {(['entrance', 'exit'] as const).map(side => <div key={side}><strong>Lyric {side}</strong><div className="field-grid">
      <NumberField label={`${side} duration (s)`} value={motion[side].durationMs / 1000} min={0} max={5} change={value => edit(m => {m[side].durationMs = Math.round(value * 1000);})} />
      <NumberField label={`${side} offset (px)`} value={motion[side].offsetY} min={-100} max={100} change={value => edit(m => {m[side].offsetY = value;})} />
      <NumberField label={`${side} scale`} value={motion[side].scale} min={.1} max={5} change={value => edit(m => {m[side].scale = value;})} />
    </div><label>{side} easing<select aria-label={`${side} easing`} value={motion[side].easing} onChange={e => edit(m => {m[side].easing = e.target.value as typeof motion.entrance.easing;})}>
      {['linear', 'hold', 'ease-in', 'ease-out', 'ease-in-out'].map(value => <option key={value}>{value}</option>)}</select></label></div>)}
    <label>Line reveal<select aria-label="Line reveal" value={motion.reveal} onChange={e => edit(m => {m.reveal = e.target.value as typeof motion.reveal;})}>
      <option value="none">All lines</option><option value="line">Current sung line</option><option value="accumulate">Accumulate sung lines</option></select></label>
    <div className="inline"><button onClick={() => edit(m => Object.assign(m, textMotionSchema.parse({emphasis: {scale: 1.15, offsetY: -4}})))}>Word pulse template</button>
      <button onClick={() => edit(m => Object.assign(m, textMotionSchema.parse({entrance: {durationMs: 300, offsetY: 16}, exit: {durationMs: 200}, reveal: 'accumulate'})))}>Gentle reveal template</button>
      <button onClick={() => edit(m => Object.assign(m, textMotionSchema.parse({})))}>Reset text motion</button></div>
    <label>Template name<input aria-label="Template name" value={name} maxLength={80} onChange={e => setName(e.target.value)} /></label>
    <button disabled={!name.trim()} onClick={() => void perform(async () => {
      const created = await api<StylePreset>(`/projects/${project.id}/presets`, {method: 'POST', body: JSON.stringify({name, style: line?.style ?? project.style,
        motion, animation: line?.animation})});
      setPresets([...presets, created]); setSelected(created.id);
    })}>Save template</button>
    <label>Saved templates<select aria-label="Saved templates" value={selected} onChange={e => {setSelected(e.target.value); setName(presets.find(p => p.id === e.target.value)?.name ?? '');}}>
      <option value="">Choose template</option>{presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    <div className="inline"><button disabled={!preset} onClick={() => preset && attempt(() => useEditor.getState().commit(applyPreset(project, preset, lineId)))}>Apply template</button>
      <button disabled={!preset || !name.trim()} onClick={() => preset && void perform(async () => {
        const renamed = await api<StylePreset>(`/presets/${preset.id}`, {method: 'PUT', body: JSON.stringify({name})}); setPresets(presets.map(p => p.id === renamed.id ? renamed : p));
      })}>Rename template</button>
      <button disabled={!preset} onClick={() => preset && void perform(async () => {await api(`/presets/${preset.id}`, {method: 'DELETE'}); setPresets(presets.filter(p => p.id !== preset.id)); setSelected('');})}>Delete template</button></div>
    <small>Templates copy values. Imported fonts must also exist in the target project. Motion follows actual word timing.</small>
  </section>;
}
