import {createHash} from 'node:crypto';
import {createReadStream, createWriteStream} from 'node:fs';
import {mkdir, readFile, rename, unlink, writeFile} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import {msToFrame, durationFrames} from '../../packages/project-model/proof';
import {duckingEnvelope, mixSignature, processedMixSchema, processingEnabled, type Loudness, type ProcessedMix} from '../../packages/project-model/audio-processing';
import type {TimelineProject} from '../../packages/project-model/timeline';
import {audioGain, hasAudio} from '../../packages/video-composition/audio';
import {atomicJson, HttpError, type Storage} from './storage';
import type {Jobs} from './jobs';
import {hashFile, runFFmpeg} from './ffmpeg';

function loudnorm(project: TimelineProject, headroom = false) {
  const target = project.audioProcessing?.normalization;
  return `loudnorm=I=${target?.integratedLufs ?? -16}:TP=${Math.max(-9, (target?.truePeakDb ?? -1.5) - (headroom ? .5 : 0))}:LRA=${target?.loudnessRange ?? 11}`;
}
function parseLoudnorm(diagnostic: string) {
  const json = diagnostic.match(/\{\s*"input_i"[\s\S]*?\}/)?.[0]; if (!json) throw new Error('FFmpeg returned no loudness analysis');
  return JSON.parse(json) as Record<string, string>;
}
function metrics(values: Record<string, string>): Loudness {
  const number = (key: string) => Number.isFinite(Number(values[key])) ? Number(values[key]) : null;
  return {integratedLufs: number('input_i'), truePeakDb: number('input_tp'), loudnessRange: number('input_lra')};
}
export async function measureLoudness(file: string, project: TimelineProject, signal: AbortSignal) {
  const diagnostic = await runFFmpeg(['-i', file, '-vn', '-af', `${loudnorm(project)}:print_format=json`, '-f', 'null', '-'], signal);
  return metrics(parseLoudnorm(diagnostic));
}
export function validateLoudness(measured: Loudness, project: TimelineProject, encoded = false) {
  const target = project.audioProcessing?.normalization; if (!target) return;
  const tolerance = encoded ? .7 : .5;
  if (measured.integratedLufs === null || measured.truePeakDb === null) throw new Error('The final mix is silent. Unmute audible audio before normalizing.');
  if (Math.abs(measured.integratedLufs - target.integratedLufs) > tolerance || measured.truePeakDb > target.truePeakDb + (encoded ? .5 : .1))
    throw new Error(`Measured audio misses its targets (${measured.integratedLufs} LUFS, ${measured.truePeakDb} dBTP). Lower the loudness target or leave more peak headroom and rebuild.`);
}
async function rmsWindows(file: string, signal: AbortSignal) {
  const result: number[] = []; let sum = 0, samples = 0;
  for await (const chunk of createReadStream(file)) {
    signal.throwIfAborted(); const bytes = chunk as Buffer;
    for (let offset = 0; offset + 4 <= bytes.length; offset += 4) {
      const value = bytes.readFloatLE(offset); sum += value * value; samples++;
      if (samples === 480) {result.push(Math.sqrt(sum / samples)); sum = samples = 0;}
    }
  }
  if (samples) result.push(Math.sqrt(sum / samples)); return result;
}
async function writeControl(file: string, reductions: number[], signal: AbortSignal) {
  async function* chunks() {
    for (const reduction of reductions) {signal.throwIfAborted(); yield Buffer.from(new Float32Array(960).fill(Math.pow(10, -reduction / 20)).buffer);}
  }
  await pipeline(Readable.from(chunks()), createWriteStream(file), {signal});
}
async function buildGraph(project: TimelineProject, store: Storage, signal: AbortSignal, trackIds?: string[]) {
  let clips = project.clips.filter(c => hasAudio(c) && (!trackIds || trackIds.includes(c.trackId))).filter(clip =>
    audioGain({...project, masterGainDb: 0}, {...clip, fadeInMs: 0, fadeOutMs: 0} as typeof clip, msToFrame(clip.startMs, project.fps) * 1000 / project.fps) > 0);
  let assets = project.assets.filter(asset => clips.some(c => c.kind !== 'lyric' && c.kind !== 'text' && c.assetId === asset.id));
  // shortcut: cap processing at 64 distinct sources to fit Windows process arguments; use an input manifest before raising this cap.
  if (assets.length > 64) throw new HttpError(400, 'Audio processing currently supports at most 64 distinct source files');
  for (const asset of assets.filter(a => a.kind === 'video')) {
    const file = await store.existingFile(project.id, 'assets', asset.file);
    const {stdout} = await promisify(execFile)('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'json', file], {windowsHide: true, timeout: 30000, signal});
    if (!JSON.parse(stdout).streams?.length) {
      assets = assets.filter(a => a.id !== asset.id); clips = clips.filter(c => c.kind === 'lyric' || c.kind === 'text' || c.assetId !== asset.id);
    }
  }
  const inputs: string[] = [];
  for (const asset of assets) inputs.push('-i', await store.existingFile(project.id, 'assets', asset.file));
  const graph: string[] = [], labels = new Map<string, string[]>();
  for (const [assetIndex, asset] of assets.entries()) {
    const occurrences = clips.filter(c => c.kind !== 'lyric' && c.kind !== 'text' && c.assetId === asset.id);
    const names = occurrences.map((_, i) => `asset${assetIndex}clip${i}`);
    graph.push(`[${assetIndex}:a]asplit=${occurrences.length}${names.map(n => `[${n}]`).join('')}`);
    occurrences.forEach((clip, index) => {
      if (clip.kind === 'lyric' || clip.kind === 'text') return;
      const start = msToFrame(clip.startMs, project.fps) / project.fps;
      const duration = (msToFrame(clip.startMs + clip.durationMs, project.fps) - msToFrame(clip.startMs, project.fps)) / project.fps;
      const offset = msToFrame(clip.sourceInMs, project.fps) / project.fps;
      const gain = audioGain({...project, masterGainDb: 0}, {...clip, fadeInMs: 0, fadeOutMs: 0}, start * 1000);
      const output = `clip${assetIndex}_${index}`, filters = [`atrim=start=${offset}:duration=${duration}`, 'asetpts=PTS-STARTPTS',
        'aresample=48000', 'aformat=sample_fmts=fltp:channel_layouts=stereo', `volume=${gain}`];
      if (clip.fadeInMs || clip.fadeOutMs) filters.push(`aeval='val(ch)*max(0,min(1,min(${clip.fadeInMs ? `t/${clip.fadeInMs / 1000}` : 1},${clip.fadeOutMs ? `(${duration}-t)/${clip.fadeOutMs / 1000}` : 1})))':c=same`);
      filters.push(`adelay=${Math.round(start * 48000)}S:all=1`);
      graph.push(`[${names[index]}]${filters.join(',')}[${output}]`);
      labels.set(clip.trackId, [...(labels.get(clip.trackId) ?? []), output]);
    });
  }
  const tracks = new Map<string, string>();
  for (const [id, clips] of labels) {
    const label = `track${tracks.size}`;
    graph.push(`${clips.map(n => `[${n}]`).join('')}amix=inputs=${clips.length}:normalize=0[${label}]`); tracks.set(id, label);
  }
  return {inputs, graph, tracks, inputCount: assets.length};
}
async function cachedMix(store: Storage, projectId: string, key: string) {
  const value = processedMixSchema.parse(JSON.parse(await readFile(await store.existingFile(projectId, 'mixes', `${key}.json`), 'utf8')));
  const file = await store.existingFile(projectId, 'mixes', value.file);
  if (await hashFile(file) !== value.hash) throw new Error('Cached audio file changed; rebuild it');
  return value;
}
export function registerAudioProcessingRoutes(app: FastifyInstance, store: Storage, jobs: Jobs) {
  const identity = z.string().uuid();
  app.post<{Params: {id: string}}>('/api/projects/:id/audio-processing-jobs', async request => {
    const project = (await store.loadTimeline(identity.parse(request.params.id))).project;
    if (!processingEnabled(project)) throw new HttpError(400, 'Enable ducking or normalization first');
    if (project.durationMs > 3600000) throw new HttpError(400, 'Audio processing currently supports projects up to one hour');
    const signature = mixSignature(project), key = createHash('sha256').update(signature).digest('hex');
    return jobs.start(project.id, project.revision, 'audio-processing', async (job, signal, update) => {
      try {const mix = await cachedMix(store, project.id, key); if (mix.signature === signature) return {mix, cached: true};} catch { /* Missing or damaged cache is regenerated from originals. */ }
      const directory = path.join(jobs.folder, job.id); await mkdir(directory, {recursive: true});
      const graphFile = path.join(directory, 'mix.ffgraph'), triggerFile = path.join(directory, 'trigger.raw'), controlFile = path.join(directory, 'control.raw');
      const rawMix = path.join(directory, 'mix.wav'), processed = path.join(directory, 'processed.wav');
      const duration = durationFrames(project) / project.fps, temporary = [graphFile, triggerFile, controlFile, rawMix, processed];
      let envelope: ProcessedMix['envelope'];
      try {
        const ducking = project.audioProcessing?.ducking;
        if (ducking) {
          await update('Analyzing trigger amplitude', .1);
          const trigger = await buildGraph(project, store, signal, [ducking.triggerTrackId]);
          const label = trigger.tracks.get(ducking.triggerTrackId);
          trigger.graph.push(label ? `[${label}]apad,atrim=duration=${duration},aformat=channel_layouts=mono[trigger]` : `anullsrc=r=48000:cl=mono,atrim=duration=${duration}[trigger]`);
          await writeFile(graphFile, trigger.graph.join(';'));
          await runFFmpeg(['-v', 'error', ...trigger.inputs, '-filter_complex_script', graphFile, '-map', '[trigger]', '-ar', '48000', '-ac', '1', '-f', 'f32le', triggerFile], signal);
          const reductions = duckingEnvelope(await rmsWindows(triggerFile, signal), ducking);
          await writeControl(controlFile, reductions, signal);
          envelope = {stepMs: 10, windows: reductions.length, maxReductionDb: reductions.reduce((max, value) => Math.max(max, value), 0)};
          await atomicJson(path.join(directory, 'envelope.json'), {stepMs: 10, reductionDb: reductions});
        }
        await update('Mixing original sources', .4);
        const base = await buildGraph(project, store, signal), outputs: string[] = [];
        const targets = [...base.tracks].filter(([id]) => ducking?.targetTrackIds.includes(id));
        if (targets.length) base.graph.push(`[${base.inputCount}:a]asplit=${targets.length}${targets.map((_, i) => `[control${i}]`).join('')}`);
        for (const [id, label] of base.tracks) {
          const index = targets.findIndex(([target]) => target === id);
          if (index >= 0) {base.graph.push(`[${label}][control${index}]amultiply[ducked${index}]`); outputs.push(`ducked${index}`);}
          else outputs.push(label);
        }
        const combined = outputs.length ? `${outputs.map(n => `[${n}]`).join('')}amix=inputs=${outputs.length}:normalize=0` : 'anullsrc=r=48000:cl=stereo';
        base.graph.push(`${combined},volume=${Math.pow(10, project.masterGainDb / 20)},apad,atrim=duration=${duration}[mix]`);
        await writeFile(graphFile, base.graph.join(';'));
        await runFFmpeg(['-v', 'error', ...base.inputs, ...(targets.length ? ['-f', 'f32le', '-ar', '48000', '-ac', '2', '-i', controlFile] : []),
          '-filter_complex_script', graphFile, '-map', '[mix]', '-ar', '48000', '-ac', '2', '-c:a', 'pcm_f32le', rawMix], signal);
        const before = await measureLoudness(rawMix, project, signal); let resultFile = rawMix;
        if (project.audioProcessing?.normalization) {
          await update('Analyzing and normalizing final mix', .65);
          const analysis = parseLoudnorm(await runFFmpeg(['-i', rawMix, '-af', `${loudnorm(project, true)}:print_format=json`, '-f', 'null', '-'], signal));
          if (before.integratedLufs === null) throw new Error('The final mix is silent. Unmute audible audio before normalizing.');
          const measured = `:measured_I=${analysis.input_i}:measured_TP=${analysis.input_tp}:measured_LRA=${analysis.input_lra}:measured_thresh=${analysis.input_thresh}:offset=${analysis.target_offset}:linear=true`;
          await runFFmpeg(['-v', 'error', '-i', rawMix, '-af', `${loudnorm(project, true)}${measured}`, '-ar', '48000', '-c:a', 'pcm_f32le', processed], signal); resultFile = processed;
        }
        const after = await measureLoudness(resultFile, project, signal); validateLoudness(after, project);
        signal.throwIfAborted(); await update('Caching verified audio mix', .95);
        await mkdir(await store.location(project.id, 'mixes'), {recursive: true}); const folder = await store.existingFile(project.id, 'mixes');
        const mix = processedMixSchema.parse({id: key, key, file: `${key}.wav`, hash: await hashFile(resultFile), signature, before, after, envelope});
        signal.throwIfAborted(); await rename(resultFile, path.join(folder, mix.file)); await atomicJson(path.join(folder, `${key}.json`), mix);
        return {mix, cached: false};
      } finally {for (const file of temporary) await unlink(file).catch(() => {});}
    });
  });
  app.post<{Params: {id: string; jobId: string}}>('/api/projects/:id/audio-processing/:jobId/apply', async request => {
    const id = identity.parse(request.params.id), job = jobs.get(identity.parse(request.params.jobId));
    if (job.projectId !== id || job.kind !== 'audio-processing' || job.state !== 'succeeded') throw new HttpError(409, 'Processed audio is not ready for this project');
    const mix = processedMixSchema.parse((job.result as {mix?: unknown})?.mix), {project} = await store.loadTimeline(id);
    if (!processingEnabled(project) || mix.signature !== mixSignature(project)) throw new HttpError(409, 'Audio sources or processing settings changed. Rebuild the mix.');
    project.processedMix = await cachedMix(store, id, mix.key); return store.saveTimeline(project);
  });
}
