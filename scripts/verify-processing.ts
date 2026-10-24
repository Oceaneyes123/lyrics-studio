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
import type {Loudness} from '../packages/project-model/audio-processing';

const root = await mkdtemp(path.join(tmpdir(), 'lyrics-processing-browser-')), output = 'artifacts/advanced/processing', base = 'http://127.0.0.1:5174';
const api = await createApp({root, mediaOrigin: base});
const web = await createServer({server: {port: 5174, strictPort: true, proxy: {'/api': 'http://127.0.0.1:3002'}}});
const installed = await ensureBrowser(); assert('path' in installed);
const browser = await chromium.launch({executablePath: installed.path});
const ffmpeg = (args: string[]) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], {windowsHide: true, maxBuffer: 4e6});
async function request<T>(route: string, data?: unknown, method = 'POST'): Promise<T> {
  const response = await fetch(`${base}/api${route}`, {method, headers: {'x-local-token': api.token,
    ...(data instanceof FormData || data === undefined ? {} : {'Content-Type': 'application/json'})},
    body: data instanceof FormData ? data : data === undefined ? undefined : JSON.stringify(data)});
  if (!response.ok) throw new Error(await response.text()); return response.json() as Promise<T>;
}
function amplitude(file: string, at: number, hz = 440) {
  const bytes = ffmpeg(['-i', file, '-ss', String(at), '-t', '0.5', '-ac', '1', '-ar', '48000', '-f', 'f32le', '-']);
  let real = 0, imaginary = 0; const samples = bytes.length / 4;
  for (let i = 0; i < samples; i++) {const value = bytes.readFloatLE(i * 4), phase = 2 * Math.PI * hz * i / 48000;
    real += value * Math.cos(phase); imaginary += value * Math.sin(phase);}
  return 2 * Math.hypot(real, imaginary) / samples;
}
try {
  await mkdir(output, {recursive: true}); await api.app.listen({host: '127.0.0.1', port: 3002}); await web.listen();
  ffmpeg(['-f', 'lavfi', '-i', "aevalsrc='if(between(t,2,4),0.2*sin(2*PI*880*t),0)':s=48000:d=8", path.join(root, 'trigger.wav')]);
  ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=8', path.join(root, 'music.wav')]);
  let project = await request<TimelineProject>('/projects');
  for (const name of ['trigger.wav', 'music.wav']) {
    const data = new FormData(); data.set('file', new Blob([await readFile(path.join(root, name))]), name);
    project = (await request<{project: TimelineProject}>(`/projects/${project.id}/assets`, data)).project;
  }
  Object.assign(project, {name: 'Processing verification', width: 128, height: 128}); project = await request(`/projects/${project.id}`, project, 'PUT');
  const page = await browser.newPage({viewport: {width: 1560, height: 1200}}), errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(`(() => {
    const captures = new Map(); let recording = false;
    const original = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function(...args) {
      const result = original.apply(this, args);
      if (args[0] === this.context.destination && this.context.createMediaStreamDestination) {
        let capture = captures.get(this.context);
        if (!capture) {
          const node = this.context.createMediaStreamDestination(), chunks = [];
          const recorder = new MediaRecorder(node.stream, {mimeType: 'audio/webm;codecs=opus'});
          recorder.ondataavailable = event => {if(event.data.size) chunks.push(event.data);};
          capture = {node, recorder, chunks}; captures.set(this.context, capture); if(recording) recorder.start();
        }
        original.call(this, capture.node);
      }
      return result;
    };
    window.beginMixCapture = () => {recording = true; for(const capture of captures.values()) if(capture.recorder.state === 'inactive') capture.recorder.start();};
    window.finishMixCapture = () => Promise.all(Array.from(captures.values()).filter(c => c.recorder.state === 'recording').map(capture => new Promise(resolve => {
      capture.recorder.onstop = async () => resolve(Array.from(new Uint8Array(await new Blob(capture.chunks).arrayBuffer())));
      capture.recorder.stop();
    })));
  })();`);
  await page.goto(base); await page.getByRole('button', {name: `${project.name} Open`, exact: true}).click();
  await page.getByLabel('Enable auto-ducking', {exact: true}).check();
  await page.getByLabel('Ducking trigger', {exact: true}).selectOption(audioClips(project)[0].trackId);
  await page.getByLabel('Enable loudness normalization', {exact: true}).check();
  for (const [label, value] of [['Target loudness (LUFS)', '-20'], ['True-peak ceiling (dBTP)', '-2']]) {
    await page.getByLabel(label, {exact: true}).fill(value); await page.getByLabel(label, {exact: true}).press('Tab');
  }
  await page.getByRole('button', {name: 'Build processed mix', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Apply processed mix', exact: true})).toBeVisible({timeout: 120000});
  await page.getByRole('button', {name: 'Apply processed mix', exact: true}).click();
  await expect(page.getByRole('status').filter({hasText: 'Processed mix is current'})).toBeVisible();
  project = (await request<{project: TimelineProject}>(`/projects/${project.id}`, undefined, 'GET')).project;
  assert(project.processedMix); const derived = await api.store.existingFile(project.id, 'mixes', project.processedMix.file);
  await page.evaluate(() => (window as unknown as {beginMixCapture: () => void}).beginMixCapture());
  await page.getByRole('button', {name: 'Play / pause', exact: true}).click();
  await page.waitForFunction(() => Number(document.querySelector('[data-proof-frame]')?.getAttribute('data-proof-frame')) >= 210, undefined, {timeout: 20000});
  await page.getByRole('button', {name: 'Play / pause', exact: true}).click();
  const captures = await page.evaluate(() => (window as unknown as {finishMixCapture: () => Promise<number[][]>}).finishMixCapture());
  assert.equal(captures.length, 1); const preview = `${output}/preview.webm`; await writeFile(preview, Buffer.from(captures[0]));
  const previewDuckRatio = amplitude(preview, 3) / amplitude(preview, 1);
  assert(Math.abs(previewDuckRatio - Math.pow(10, -12 / 20)) < .04, `Preview duck ratio ${previewDuckRatio}`);
  assert(Math.abs(amplitude(preview, 1) / amplitude(derived, 1) - 1) < .08, 'Preview must play the derived mix once');
  assert.equal(await page.locator('[data-proof-canvas] audio').count(), 1, 'The composition must play only the derived mix');
  const exported = await request<Job>(`/projects/${project.id}/export-jobs`, {allowUntimed: false});
  let finished = exported;
  await expect.poll(async () => {finished = await request<Job>(`/jobs/${exported.id}`, undefined, 'GET');
    if (finished.state === 'failed') throw new Error(finished.error); return finished.state;
  }, {timeout: 120000}).toBe('succeeded');
  const response = await fetch(`${base}/api/jobs/${exported.id}/result`, {headers: {'x-local-token': api.token}}); assert(response.ok);
  const video = `${output}/video.mp4`; await writeFile(video, Buffer.from(await response.arrayBuffer()));
  const encodedDuckRatio = amplitude(video, 3) / amplitude(video, 1); assert(Math.abs(encodedDuckRatio - previewDuckRatio) < .04);
  const encodedAudio = (finished.result as {encodedAudio: Loudness}).encodedAudio;
  assert(Math.abs(encodedAudio.integratedLufs! + 20) <= .7 && encodedAudio.truePeakDb! <= -1.5);
  await page.getByLabel('Master gain (dB)', {exact: true}).fill('-3'); await page.getByLabel('Master gain (dB)', {exact: true}).press('Tab');
  await expect(page.getByRole('status').filter({hasText: 'Processed mix is missing or stale'})).toBeVisible();
  await page.getByRole('button', {name: 'Save', exact: true}).click(); await page.getByRole('status').filter({hasText: /^Saved$/}).waitFor();
  assert.equal((await fetch(`${base}/api/projects/${project.id}/export-jobs`, {method: 'POST', headers: {'x-local-token': api.token, 'Content-Type': 'application/json'}, body: '{}'})).status, 400);
  await page.getByRole('button', {name: 'Undo', exact: true}).click();
  await expect(page.getByRole('status').filter({hasText: 'Processed mix is current'})).toBeVisible();
  await page.getByRole('button', {name: 'Build processed mix', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Apply processed mix', exact: true})).toBeVisible({timeout: 30000});
  const jobs = await request<Job[]>(`/projects/${project.id}/jobs`, undefined, 'GET'); assert((jobs[0].result as {cached: boolean}).cached);
  await page.getByRole('button', {name: 'Apply processed mix', exact: true}).click();
  await page.reload(); await page.getByRole('button', {name: `${project.name} Open`, exact: true}).click();
  await expect(page.getByRole('status').filter({hasText: 'Processed mix is current'})).toBeVisible();
  const fresh = (await request<{project: TimelineProject}>(`/projects/${project.id}`, undefined, 'GET')).project;
  fresh.masterGainDb = -1; await request(`/projects/${project.id}`, fresh, 'PUT');
  const cancelled = await request<Job>(`/projects/${project.id}/audio-processing-jobs`); await request(`/jobs/${cancelled.id}/cancel`);
  await expect.poll(async () => (await request<Job>(`/jobs/${cancelled.id}`, undefined, 'GET')).state).toBe('cancelled');
  assert.deepEqual(errors, []);
  await writeFile(`${output}/report.json`, JSON.stringify({previewDuckRatio, encodedDuckRatio, encodedAudio,
    derivedAudio: project.processedMix.after, originalElementsDisabled: true, staleExportRejected: true, cacheReused: true, cancellation: true, errors}, null, 2));
  console.log('Processed audio passed: actual inspector, captured preview/encoded ducking, one derived playback source, measured AAC targets, cache, stale guard, undo/reopen and cancellation.');
} finally {
  await browser.close(); await web.close(); await api.app.close();
  assert.equal(path.dirname(root), path.resolve(tmpdir())); assert(path.basename(root).startsWith('lyrics-processing-browser-'));
  await rm(root, {recursive: true, force: true});
}
