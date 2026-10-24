import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {chromium, expect} from '@playwright/test';
import {ensureBrowser} from '@remotion/renderer';
import {createServer} from 'vite';
import {createApp} from '../apps/api/app';
import {audioClips} from '../packages/editor-core/timeline-commands';
import type {TimelineProject} from '../packages/project-model/timeline';
import type {Job} from '../apps/api/jobs';

const root = await mkdtemp(path.join(tmpdir(), 'lyrics-mix-browser-')), output = 'artifacts/advanced/audio';
await mkdir(output, {recursive: true});
const base = 'http://127.0.0.1:5174', api = await createApp({root, mediaOrigin: base});
const web = await createServer({server: {port: 5174, strictPort: true, proxy: {'/api': 'http://127.0.0.1:3002'}}});
const installed = await ensureBrowser(); assert('path' in installed);
const browser = await chromium.launch({executablePath: installed.path});
const ffmpeg = (args: string[]) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], {windowsHide: true});
async function request<T>(route: string, data?: unknown, method = 'POST'): Promise<T> {
  const response = await fetch(`${base}/api${route}`, {method, headers: {'x-local-token': api.token,
    ...(data === undefined || data instanceof FormData ? {} : {'Content-Type': 'application/json'})},
    body: data instanceof FormData ? data : data === undefined ? undefined : JSON.stringify(data)});
  if (!response.ok) throw new Error(await response.text()); return response.json() as Promise<T>;
}
function amplitude(file: string, hz: number, at = 1, seconds = 1) {
  const bytes = ffmpeg(['-i', file, '-vn', '-ac', '1', '-ar', '48000', '-f', 'f32le', '-']);
  const start = Math.round(at * 48000), count = Math.round(seconds * 48000);
  assert(bytes.length >= (start + count) * 4, 'Audio window exceeds decoded output');
  let real = 0, imaginary = 0;
  for (let i = 0; i < count; i++) {const value = bytes.readFloatLE((start + i) * 4), phase = 2 * Math.PI * hz * i / 48000;
    real += value * Math.cos(phase); imaginary += value * Math.sin(phase);}
  return 2 * Math.hypot(real, imaginary) / count;
}
try {
  await api.app.listen({host: '127.0.0.1', port: 3002}); await web.listen();
  for (const hz of [440, 880]) ffmpeg(['-f', 'lavfi', '-i', `sine=frequency=${hz}:sample_rate=48000:duration=4`, path.join(root, `${hz}.wav`)]);
  ffmpeg(['-f', 'lavfi', '-i', 'color=blue:s=64x64:r=30:d=4', '-f', 'lavfi', '-i', 'sine=frequency=1320:sample_rate=48000:duration=4',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path.join(root, 'video.mp4')]);
  let project = await request<TimelineProject>('/projects');
  for (const file of ['440.wav', '880.wav', 'video.mp4']) {
    const data = new FormData(); data.set('file', new Blob([await readFile(path.join(root, file))]), file);
    project = (await request<{project: TimelineProject}>(`/projects/${project.id}/assets`, data)).project;
  }
  assert.equal(audioClips(project).length, 2); assert.equal(project.alignmentSourceClipId, audioClips(project)[0].id);
  project.name = 'Mix verification'; project.width = project.height = 128;
  project = await request(`/projects/${project.id}`, project, 'PUT');
  const page = await browser.newPage({viewport: {width: 1560, height: 1200}});
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(`(() => {
    const captures = new Map();
    const original = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function(...args) {
      const result = original.apply(this, args);
      if (args[0] === this.context.destination && this.context.createMediaStreamDestination) {
        let capture = captures.get(this.context);
        if (!capture) {
          const node = this.context.createMediaStreamDestination(), chunks = [];
          const recorder = new MediaRecorder(node.stream, {mimeType: 'audio/webm;codecs=opus'});
          recorder.ondataavailable = event => {if(event.data.size) chunks.push(event.data);};
          capture = {node, recorder, chunks}; captures.set(this.context, capture); recorder.start();
        }
        original.call(this, capture.node);
      }
      return result;
    };
    window.finishMixCapture = () => Promise.all(Array.from(captures.values()).map(capture => new Promise(resolve => {
      capture.recorder.onstop = async () => resolve(Array.from(new Uint8Array(await new Blob(capture.chunks).arrayBuffer())));
      capture.recorder.stop();
    })));
  })();`);
  await page.goto(base); await page.getByRole('button', {name: `${project.name} Open`, exact: true}).click();
  await expect(page.locator('.track.audio .timeline-clip')).toHaveCount(2);
  await page.getByRole('button', {name: 'Add background video.mp4', exact: true}).click();
  await page.getByLabel('Enable video audio', {exact: true}).check(); await page.getByLabel('Enable video audio', {exact: true}).uncheck();
  const second = audioClips(project)[1];
  await page.locator(`[data-clip-id="${second.id}"]`).click();
  await page.getByLabel('Clip gain (dB)', {exact: true}).fill('6'); await page.getByLabel('Clip gain (dB)', {exact: true}).press('Tab');
  await page.getByLabel('Mixer solo 880.wav', {exact: true}).check(); await page.getByLabel('Mixer solo 880.wav', {exact: true}).uncheck();
  await page.getByRole('button', {name: 'Save', exact: true}).click(); await page.getByRole('status').filter({hasText: /^Saved$/}).waitFor();
  await page.getByRole('button', {name: 'Play / pause', exact: true}).click();
  await page.waitForFunction(() => Number(document.querySelector('[data-proof-frame]')?.getAttribute('data-proof-frame')) >= 90, undefined, {timeout: 20000});
  await page.getByRole('button', {name: 'Play / pause', exact: true}).click();
  const captures = await page.evaluate(() => (window as unknown as {finishMixCapture: () => Promise<number[][]>}).finishMixCapture());
  assert.equal(captures.length, 1, 'The preview must use one shared audio context');
  const preview = `${output}/preview.webm`; await writeFile(preview, Buffer.from(captures[0]));
  const previewRatio = amplitude(preview, 880) / amplitude(preview, 440);
  assert(Math.abs(previewRatio - Math.pow(10, 6 / 20)) < .06, `Preview amplification ratio ${previewRatio}`);
  project = (await request<{project: TimelineProject}>(`/projects/${project.id}`, undefined, 'GET')).project;
  const [a] = audioClips(project), video = project.clips.find(c => c.kind === 'visual')!;
  const trackA = project.tracks.find(t => t.id === a.trackId)!, visualTrack = project.tracks.find(t => t.id === video.trackId)!;
  const measurements = [];
  async function render(name: string) {
    project = await request(`/projects/${project.id}`, project, 'PUT');
    const job = await request<Job>(`/projects/${project.id}/export-jobs`, {allowUntimed: false});
    await expect.poll(async () => {
      const current = await request<Job>(`/jobs/${job.id}`, undefined, 'GET');
      if (['failed', 'cancelled', 'interrupted'].includes(current.state)) throw new Error(current.error ?? current.state);
      return current.state;
    }, {timeout: 120000}).toBe('succeeded');
    const response = await fetch(`${base}/api/jobs/${job.id}/result`, {headers: {'x-local-token': api.token}}); assert(response.ok);
    const file = `${output}/${name}.mp4`; await writeFile(file, Buffer.from(await response.arrayBuffer())); return file;
  }
  // render() replaces the parsed object, so reacquire references for every following setting change.
  const gainFile = await render('gain'), encodedRatio = amplitude(gainFile, 880) / amplitude(gainFile, 440);
  assert(Math.abs(encodedRatio - previewRatio) < .06); measurements.push({case: 'gain', previewRatio, encodedRatio});
  project.tracks.find(t => t.id === trackA.id)!.solo = true;
  const soloFile = await render('solo'); assert(amplitude(soloFile, 880) / amplitude(soloFile, 440) < .02); measurements.push({case: 'solo', passed: true});
  project.tracks.find(t => t.id === trackA.id)!.solo = false;
  audioClips(project)[0].muted = true; audioClips(project)[1].gainDb = 0;
  const muteFile = await render('mute'); assert(amplitude(muteFile, 440) / amplitude(muteFile, 880) < .02); measurements.push({case: 'mute', passed: true});
  audioClips(project)[0].muted = false; audioClips(project)[1].muted = true;
  Object.assign(audioClips(project)[0], {fadeInMs: 1000, fadeOutMs: 1000});
  const fadeFile = await render('fade'), steady = amplitude(fadeFile, 440, 1.5, .5);
  for (const at of [.1, 3.7]) assert(Math.abs(amplitude(fadeFile, 440, at, .2) / steady - .2) < .07, 'Fade must use clip-relative time');
  measurements.push({case: 'fades', passed: true});
  Object.assign(audioClips(project)[0], {fadeInMs: 0, fadeOutMs: 0, startMs: 1000, sourceInMs: 1000, durationMs: 3000});
  const trimFile = await render('trim'); assert(amplitude(trimFile, 440, .2, .2) < steady * .02); assert(amplitude(trimFile, 440, 2) > steady * .9);
  measurements.push({case: 'source-trim', passed: true});
  audioClips(project)[0].muted = true;
  const currentVideo = project.clips.find(c => c.id === video.id)!; if (currentVideo.kind !== 'visual') throw new Error('Expected video'); currentVideo.audioEnabled = true;
  project.tracks.find(t => t.id === visualTrack.id)!.visible = false;
  const videoFile = await render('video-audio'); assert(amplitude(videoFile, 1320) > steady * .8);
  measurements.push({case: 'hidden-video-audio', passed: true});
  await page.reload(); await page.getByRole('button', {name: `${project.name} Open`, exact: true}).click();
  await expect(page.getByLabel('Alignment song', {exact: true})).toHaveValue(a.id);
  const cancelled = await request<Job>(`/projects/${project.id}/export-jobs`, {allowUntimed: false});
  await request(`/jobs/${cancelled.id}/cancel`);
  await expect.poll(async () => (await request<Job>(`/jobs/${cancelled.id}`, undefined, 'GET')).state).toBe('cancelled');
  assert.equal((await fetch(`${base}/api/jobs/${cancelled.id}/result`, {headers: {'x-local-token': api.token}})).status, 409);
  measurements.push({case: 'mix-cancellation', passed: true});
  Object.assign(audioClips(project)[0], {startMs: 0, sourceInMs: 0, durationMs: 4000});
  project.lyricSource = {text: 'Tone test', lines: [{id: 'line-1', text: 'Tone test'}]};
  project = await request(`/projects/${project.id}`, project, 'PUT');
  const alignment = await request<Job>(`/projects/${project.id}/alignment-jobs`, {language: 'en'});
  await request(`/jobs/${alignment.id}/cancel`);
  await expect.poll(async () => (await request<Job>(`/jobs/${alignment.id}`, undefined, 'GET')).state).toBe('cancelled');
  measurements.push({case: 'multi-audio-alignment-acceptance-and-cancel', passed: true});
  assert.deepEqual(errors, []);
  await writeFile(`${output}/report.json`, JSON.stringify({projectId: project.id, measurements, browserErrors: errors,
    scope: 'Synthetic tones; preview Web Audio capture and encoded AAC frequency amplitudes. No human listening approval inferred.'}, null, 2));
  console.log('Audio mixing passed: simultaneous sources, captured preview/export gain parity, solo, mute, fades, source trim, video audio, and persisted reference.');
} finally {
  await browser.close(); await web.close(); await api.app.close();
  assert.equal(path.dirname(root), path.resolve(tmpdir())); assert(path.basename(root).startsWith('lyrics-mix-browser-'));
  await rm(root, {recursive: true, force: true});
}
