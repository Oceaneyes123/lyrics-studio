import type {TimelineProject} from '../../packages/project-model/timeline';
import {audioClips} from '../../packages/editor-core/timeline-commands';
import {hasAudio} from '../../packages/video-composition/audio';
import {useEditor} from './store';
import {NumberField} from './Fields';

export function AudioMixer({project, attempt}: {project: TimelineProject; attempt: (action: () => void) => void}) {
  const edit = (action: (draft: TimelineProject) => void) => attempt(() => useEditor.getState().edit(action));
  return <section className="audio-mixer"><h2>Audio mixer</h2>
    <label>Alignment song<select aria-label="Alignment song" value={project.alignmentSourceClipId ?? ''} onChange={e => edit(d => {d.alignmentSourceClipId = e.target.value || null;})}>
      <option value="">Choose reference audio</option>
      {audioClips(project).map(clip => {
        const asset = project.assets.find(asset => asset.id === clip.assetId)!;
        const edited = clip.sourceInMs !== 0 || clip.durationMs !== asset.durationMs;
        return <option key={clip.id} value={clip.id} disabled={edited}>{asset.name} · {(clip.startMs / 1000).toFixed(2)}s{edited ? ' (edited)' : ''}</option>;
      })}
    </select></label>
    <NumberField label="Master gain (dB)" value={project.masterGainDb} min={-60} max={6} change={n => edit(d => {d.masterGainDb = n;})} />
    {project.tracks.filter(track => track.kind === 'audio' || project.clips.some(c => c.trackId === track.id && hasAudio(c))).map(track => <div className="mix-track" key={track.id}>
      <strong>{track.name}</strong>
      <NumberField label={`${track.name} gain (dB)`} value={track.gainDb} min={-60} max={6} change={n => edit(d => {d.tracks.find(t => t.id === track.id)!.gainDb = n;})} />
      <div className="inline"><label className="checkbox"><input type="checkbox" aria-label={`Mixer mute ${track.name}`} checked={track.muted} onChange={e => edit(d => {d.tracks.find(t => t.id === track.id)!.muted = e.target.checked;})} />Mute</label>
        <label className="checkbox"><input type="checkbox" aria-label={`Mixer solo ${track.name}`} checked={track.solo} onChange={e => edit(d => {d.tracks.find(t => t.id === track.id)!.solo = e.target.checked;})} />Solo</label></div>
    </div>)}
    <small className="helper">Overlapping sources add together. Reduce gain to avoid clipping.</small>
  </section>;
}
