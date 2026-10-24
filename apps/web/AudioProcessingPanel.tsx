import type {TimelineProject} from '../../packages/project-model/timeline';
import {currentProcessedMix, duckingSchema, normalizationSchema, processingEnabled} from '../../packages/project-model/audio-processing';
import type {Job} from '../api/jobs';
import {api, useEditor} from './store';
import {NumberField} from './Fields';
import {hasAudio} from '../../packages/video-composition/audio';

export function AudioProcessingPanel({project, job, setJob, flush, perform, attempt}: {project: TimelineProject; job: Job | null;
  setJob: (job: Job | null) => void; flush: () => Promise<void>; perform: (action: () => Promise<void>) => Promise<void>; attempt: (action: () => void) => void}) {
  const settings = project.audioProcessing, ducking = settings?.ducking, normalization = settings?.normalization;
  const audibleTracks = project.tracks.filter(t => project.clips.some(c => c.trackId === t.id && hasAudio(c)));
  const tracks = project.tracks.filter(t => audibleTracks.includes(t) || t.id === ducking?.triggerTrackId || ducking?.targetTrackIds.includes(t.id)), current = currentProcessedMix(project);
  const active = job?.state === 'running' || job?.state === 'queued';
  const result = job?.kind === 'audio-processing' && job.state === 'succeeded';
  return <section><h2>Audio processing</h2>
    <label><input aria-label="Enable auto-ducking" type="checkbox" checked={Boolean(ducking)} onChange={e => attempt(() => useEditor.getState().edit(draft => {
      draft.audioProcessing ??= {};
      if (!e.target.checked) delete draft.audioProcessing.ducking;
      else {
        if (audibleTracks.length < 2) throw new Error('Add a second audio track before enabling ducking');
        draft.audioProcessing.ducking = duckingSchema.parse({triggerTrackId: audibleTracks[0].id, targetTrackIds: [audibleTracks[1].id]});
      }
    }))} /> Auto-duck target tracks</label>
    {ducking && <><label>Trigger track<select aria-label="Ducking trigger" value={ducking.triggerTrackId} onChange={e => attempt(() => useEditor.getState().edit(draft => {
      const d = draft.audioProcessing!.ducking!;
      d.targetTrackIds = d.targetTrackIds.map(id => id === e.target.value ? d.triggerTrackId : id); d.triggerTrackId = e.target.value;
    }))}>{tracks.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
      <fieldset><legend>Duck these tracks</legend>{tracks.filter(t => t.id !== ducking.triggerTrackId).map(track => <label key={track.id}>
        <input aria-label={`Duck ${track.name}`} type="checkbox" checked={ducking.targetTrackIds.includes(track.id)}
          disabled={ducking.targetTrackIds.length === 1 && ducking.targetTrackIds[0] === track.id} onChange={e => attempt(() => useEditor.getState().edit(draft => {
            const d = draft.audioProcessing!.ducking!; d.targetTrackIds = e.target.checked ? [...d.targetTrackIds, track.id] : d.targetTrackIds.filter(id => id !== track.id);
          }))} />{track.name}</label>)}</fieldset>
      <div className="field-grid">{([['thresholdDb', 'Trigger threshold (dBFS)', -60, 0], ['reductionDb', 'Ducking reduction (dB)', 0, 30],
        ['attackMs', 'Ducking attack (ms)', 1, 2000], ['releaseMs', 'Ducking release (ms)', 1, 5000]] as const).map(([property, label, min, max]) =>
        <NumberField key={property} label={label} value={ducking[property]} min={min} max={max} step={1} change={value => attempt(() => useEditor.getState().edit(draft => {draft.audioProcessing!.ducking![property] = value;}))} />)}</div>
      <small>Amplitude from the complete trigger track drives ducking. This does not isolate vocals from a mixed song.</small></>}
    <label><input aria-label="Enable loudness normalization" type="checkbox" checked={Boolean(normalization)} onChange={e => attempt(() => useEditor.getState().edit(draft => {
      draft.audioProcessing ??= {}; if (e.target.checked) draft.audioProcessing.normalization = normalizationSchema.parse({}); else delete draft.audioProcessing.normalization;
    }))} /> Normalize the final mix</label>
    {normalization && <div className="field-grid">{([['integratedLufs', 'Target loudness (LUFS)', -36, -5], ['truePeakDb', 'True-peak ceiling (dBTP)', -9, -1], ['loudnessRange', 'Loudness range (LU)', 1, 20]] as const).map(([property, label, min, max]) =>
      <NumberField key={property} label={label} value={normalization[property]} min={min} max={max} step={.1} change={value => attempt(() => useEditor.getState().edit(draft => {draft.audioProcessing!.normalization![property] = value;}))} />)}</div>}
    {processingEnabled(project) && <><p role="status">{current ? 'Processed mix is current and drives preview/export.' : 'Processed mix is missing or stale. Preview uses original mixing; rebuild before export.'}</p>
      <button disabled={active} onClick={() => void perform(async () => {await flush(); setJob(await api<Job>(`/projects/${project.id}/audio-processing-jobs`, {method: 'POST'}));})}>Build processed mix</button>
      {result && <button onClick={() => void perform(async () => {
        await flush(); const next = await api<TimelineProject>(`/projects/${project.id}/audio-processing/${job!.id}/apply`, {method: 'POST'});
        const current = useEditor.getState(); if (current.project?.id !== next.id) return;
        useEditor.setState({project: {...current.project, processedMix: next.processedMix, revision: next.revision}, version: current.version + 1}); setJob(null);
      })}>Apply processed mix</button>}
      {current && <p>Measured: {current.after.integratedLufs ?? 'silence'} LUFS · {current.after.truePeakDb ?? 'silence'} dBTP
        {current.envelope && ` · up to ${current.envelope.maxReductionDb.toFixed(1)} dB ducking`}</p>}
    </>}
    <small>Processing supports up to one hour and 64 distinct input files. Derived mixes are cached locally; originals stay unchanged.</small>
  </section>;
}
