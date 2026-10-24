import {afterEach, beforeEach, expect, it} from 'vitest';
import {execFileSync} from 'node:child_process';
import {mkdtemp, readFile, rm, readdir} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createApp} from '../apps/api/app';
import {currentProcessedMix, duckingEnvelope, duckingSchema, mixSignature, normalizationSchema, type ProcessedMix} from '../packages/project-model/audio-processing';
import {timelineClipSchema, type TimelineProject} from '../packages/project-model/timeline';
import {audioClips} from '../packages/editor-core/timeline-commands';
import type {Job} from '../apps/api/jobs';
import {runFFmpeg} from '../apps/api/ffmpeg';

let api: Awaited<ReturnType<typeof createApp>>, root: string;
const headers = {'x-local-token': 'test-token'};
beforeEach(async () => {root = await mkdtemp(path.join(tmpdir(), 'lyrics-processing-test-')); api = await createApp({root, token: 'test-token'});});
afterEach(async () => {await api.app.close(); await rm(root, {recursive: true, force: true});});
const ffmpeg = (args: string[]) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], {windowsHide: true});
async function fixture() {
  let project = (await api.app.inject({method: 'POST', url: '/api/projects', headers})).json<TimelineProject>();
  const input = ['aevalsrc=\'if(between(t,2,4),0.2*sin(2*PI*880*t),0)\':s=48000:d=8', 'sine=frequency=440:sample_rate=48000:duration=8'];
  for (const [index, source] of input.entries()) {
    const file = path.join(root, `${index}.wav`); ffmpeg(['-f', 'lavfi', '-i', source, file]);
    const bytes = await readFile(file), payload = Buffer.concat([Buffer.from(`--mix-boundary\r\nContent-Disposition: form-data; name="file"; filename="${index}.wav"\r\nContent-Type: audio/wav\r\n\r\n`), bytes, Buffer.from('\r\n--mix-boundary--\r\n')]);
    const response = await api.app.inject({method: 'POST', url: `/api/projects/${project.id}/assets`, headers: {...headers, 'content-type': 'multipart/form-data; boundary=mix-boundary'}, payload});
    expect(response.statusCode).toBe(200); project = response.json<{project: TimelineProject}>().project;
  }
  const [trigger, target] = audioClips(project);
  project.audioProcessing = {ducking: duckingSchema.parse({triggerTrackId: trigger.trackId, targetTrackIds: [target.trackId], releaseMs: 200})};
  project = await api.store.saveTimeline(project); return project;
}
async function processMix(project: TimelineProject) {
  const response = await api.app.inject({method: 'POST', url: `/api/projects/${project.id}/audio-processing-jobs`, headers});
  expect(response.statusCode).toBe(200); const job = response.json<Job>();
  await expect.poll(() => api.jobs.get(job.id).state, {timeout: 30000}).not.toMatch(/queued|running/);
  const done = api.jobs.get(job.id); if (done.state !== 'succeeded') throw new Error(done.error ?? done.state);
  return {...done, result: done.result as {mix: ProcessedMix; cached: boolean}};
}
function amplitude(file: string, at: number, hz = 440) {
  const bytes = ffmpeg(['-i', file, '-ss', String(at), '-t', '0.5', '-ac', '1', '-ar', '48000', '-f', 'f32le', '-']);
  let real = 0, imaginary = 0; const samples = bytes.length / 4;
  for (let i = 0; i < samples; i++) {const value = bytes.readFloatLE(i * 4), phase = 2 * Math.PI * hz * i / 48000;
    real += value * Math.cos(phase); imaginary += value * Math.sin(phase);}
  return 2 * Math.hypot(real, imaginary) / samples;
}
it('uses explicit RMS threshold and 90-percent attack/release times', () => {
  const settings = duckingSchema.parse({triggerTrackId: 'voice', targetTrackIds: ['music'], attackMs: 100, releaseMs: 100, reductionDb: 12, thresholdDb: -20});
  const envelope = duckingEnvelope([...Array(10).fill(.2), ...Array(10).fill(0)], settings);
  expect(envelope[9]).toBeCloseTo(10.8); expect(envelope[19]).toBeCloseTo(1.08);
});
it('caches deterministic ducking, keeps originals, protects stale application and forged mix metadata', async () => {
  let project = await fixture(); const original = await readFile(await api.store.existingFile(project.id, 'assets', project.assets[0].file));
  const first = await processMix(project), mix = first.result.mix, file = await api.store.existingFile(project.id, 'mixes', mix.file);
  expect(first.result.cached).toBe(false); expect(mix.envelope?.maxReductionDb).toBeCloseTo(12);
  expect(amplitude(file, 3) / amplitude(file, 1)).toBeCloseTo(Math.pow(10, -12 / 20), 1);
  expect(amplitude(file, 6) / amplitude(file, 1)).toBeCloseTo(1, 2);
  expect(amplitude(file, 1, 880)).toBeLessThan(.001);
  const repeated = await processMix(project); expect(repeated.result.cached).toBe(true); expect(repeated.result.mix.hash).toBe(mix.hash);
  const apply = await api.app.inject({method: 'POST', url: `/api/projects/${project.id}/audio-processing/${first.id}/apply`, headers});
  expect(apply.statusCode).toBe(200); project = apply.json<TimelineProject>(); expect(currentProcessedMix(project)?.key).toBe(mix.key);
  const signature = mixSignature(project); project.style.x = 30; project.tracks.reverse(); expect(mixSignature(project)).toBe(signature);
  project.masterGainDb = -3; project = await api.store.saveTimeline(project); expect(currentProcessedMix(project)).toBeUndefined();
  expect((await api.app.inject({method: 'POST', url: `/api/projects/${project.id}/audio-processing/${first.id}/apply`, headers})).statusCode).toBe(409);
  expect((await api.app.inject({method: 'POST', url: `/api/projects/${project.id}/export-jobs`, headers, payload: {allowUntimed: false}})).statusCode).toBe(400);
  const forged = structuredClone(project); forged.processedMix!.after.integratedLufs = -1;
  expect((await api.app.inject({method: 'PUT', url: `/api/projects/${project.id}`, headers, payload: forged})).statusCode).toBe(400);
  expect(await readFile(await api.store.existingFile(project.id, 'assets', project.assets[0].file))).toEqual(original);
}, 60000);
it('normalizes the final ducked mix with measured targets and handles silence/failure/retry', async () => {
  let project = await fixture(); project.audioProcessing!.normalization = normalizationSchema.parse({integratedLufs: -20, truePeakDb: -2});
  project = await api.store.saveTimeline(project); const normalized = await processMix(project);
  expect(normalized.result.mix.after.integratedLufs).toBeCloseTo(-20, 0); expect(normalized.result.mix.after.truePeakDb!).toBeLessThanOrEqual(-1.9);
  project.tracks.forEach(t => {t.muted = true;}); project = await api.store.saveTimeline(project);
  const response = await api.app.inject({method: 'POST', url: `/api/projects/${project.id}/audio-processing-jobs`, headers}), failed = response.json<Job>();
  await expect.poll(() => api.jobs.get(failed.id).state, {timeout: 30000}).toBe('failed'); expect(api.jobs.get(failed.id).error).toContain('silent');
  expect((await readdir(path.join(api.jobs.folder, failed.id))).some(name => name.endsWith('.wav') || name.endsWith('.raw'))).toBe(false);
  project.tracks.forEach(t => {t.muted = false;}); project = await api.store.saveTimeline(project);
  expect((await processMix(project)).result.cached).toBe(true);
}, 60000);
it('cancels actual FFmpeg and refuses oversized processing duration', async () => {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 100);
  try {await expect(runFFmpeg(['-re', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=60', '-f', 'null', '-'], controller.signal)).rejects.toThrow('Cancelled');}
  finally {clearTimeout(timer);}
  let project = await fixture(); project.durationMs = 3600001; project = await api.store.saveTimeline(project);
  expect((await api.app.inject({method: 'POST', url: `/api/projects/${project.id}/audio-processing-jobs`, headers})).statusCode).toBe(400);
}, 60000);
it('uses the lower fade envelope when fades overlap', async () => {
  let project = await fixture(); project.audioProcessing!.ducking!.reductionDb = 0;
  const target = audioClips(project)[1]; target.fadeInMs = target.fadeOutMs = 5000;
  project = await api.store.saveTimeline(project); const done = await processMix(project);
  const file = await api.store.existingFile(project.id, 'mixes', done.result.mix.file);
  const original = await api.store.existingFile(project.id, 'assets', project.assets.find(a => a.id === target.assetId)!.file);
  expect(amplitude(file, 4) / amplitude(original, 4)).toBeCloseTo(.75, 1);
}, 60000);
it('treats an opted-in video without an audio stream as silence', async () => {
  let project = await fixture(); const file = path.join(root, 'silent.mp4');
  ffmpeg(['-f', 'lavfi', '-i', 'color=blue:s=64x64:r=30:d=8', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', file]);
  const bytes = await readFile(file), payload = Buffer.concat([Buffer.from('--video-boundary\r\nContent-Disposition: form-data; name="file"; filename="silent.mp4"\r\nContent-Type: video/mp4\r\n\r\n'), bytes, Buffer.from('\r\n--video-boundary--\r\n')]);
  const response = await api.app.inject({method: 'POST', url: `/api/projects/${project.id}/assets`, headers: {...headers, 'content-type': 'multipart/form-data; boundary=video-boundary'}, payload});
  expect(response.statusCode).toBe(200); const imported = response.json<{project: TimelineProject; asset: {id: string}}>(); project = imported.project;
  project.clips.push(timelineClipSchema.parse({id: crypto.randomUUID(), trackId: project.tracks.find(t => t.kind === 'visual')!.id,
    kind: 'visual', assetId: imported.asset.id, startMs: 0, durationMs: 8000, sourceInMs: 0, audioEnabled: true}));
  project = await api.store.saveTimeline(project); expect((await processMix(project)).state).toBe('succeeded');
}, 60000);
