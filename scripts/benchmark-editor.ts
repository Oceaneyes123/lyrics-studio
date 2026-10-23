import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {chromium} from '@playwright/test';
import {ensureBrowser} from '@remotion/renderer';
import {createServer} from 'vite';
import {createApp} from '../apps/api/app';
import {timelineClipSchema as clipSchema, trackSchema, parseTimeline as parseProject, type TimelineProject as Project} from '../packages/project-model/timeline';
import {audioClips, setLyrics, updateLine} from '../packages/editor-core/timeline-commands';
import type {Job} from '../apps/api/jobs';

const output = 'artifacts/acceptance/performance';
await mkdir(output, {recursive: true});
const root = await mkdtemp(path.join(os.tmpdir(), 'lyrics-benchmark-'));
const base = 'http://127.0.0.1:5174';
const api = await createApp({root, mediaOrigin: base});
const web = await createServer({server: {port: 5174, strictPort: true, proxy: {'/api': 'http://127.0.0.1:3002'}}});
const installed = await ensureBrowser(); assert('path' in installed);
const browser = await chromium.launch({executablePath: installed.path});
const ffmpeg = (args: string[]) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], {windowsHide: true});
const headers = {'x-local-token': api.token};
async function json<T>(route: string, data?: unknown, method = 'POST'): Promise<T> {
  const response = await fetch(`${base}/api${route}`, {method, headers: {...headers, ...(data === undefined || data instanceof FormData ? {} : {'Content-Type': 'application/json'})},
    body: data instanceof FormData ? data : data === undefined ? undefined : JSON.stringify(data)});
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}
const results = [];
let peakNodeRss = process.memoryUsage().rss;
const sampler = setInterval(() => {peakNodeRss = Math.max(peakNodeRss, process.memoryUsage().rss);}, 100);
try {
  await api.app.listen({host: '127.0.0.1', port: 3002}); await web.listen();
  const page = await browser.newPage({viewport: {width: 1560, height: 1120}});
  const browserErrors: string[] = []; page.on('pageerror', error => browserErrors.push(error.message));
  const cdp = await page.context().newCDPSession(page); await cdp.send('Performance.enable');
  const extended = path.join(root, 'five-minutes.wav');
  ffmpeg(['-stream_loop', '3', '-i', path.resolve('music/test.wav'), '-t', '300', extended]);
  const sourceProject = JSON.parse(await readFile('artifacts/acceptance/alignment/original.json', 'utf8'));
  for (const [name, file, durationMs] of [['short', 'music/test.wav', 10000], ['full-song', 'music/test.wav', 97431], ['five-minutes', extended, 300000]] as const) {
    let project = await json<Project>('/projects');
    const data = new FormData(); data.set('file', new Blob([await readFile(file)]), 'song.wav');
    let started = performance.now();
    project = (await json<{project: Project}>(`/projects/${project.id}/assets`, data)).project;
    const importMs = performance.now() - started;
    project.name = `Benchmark ${name}`; project.durationMs = durationMs; audioClips(project)[0].durationMs = durationMs;
    const aligned = sourceProject.lines.filter((line: {startMs: number | null; durationMs: number | null}) =>
      line.startMs !== null && line.startMs + line.durationMs! <= Math.min(durationMs, 97431));
    project.lyricSource.lines = aligned.map((line: {id: string; text: string}) => ({id: line.id, text: line.text}));
    for (const line of aligned) updateLine(project, line.id, target => Object.assign(target, line));
    project = await json<Project>(`/projects/${project.id}`, project, 'PUT');
    await page.goto(base);
    started = performance.now();
    await page.getByRole('button', {name: `${project.name} Open`, exact: true}).click();
    await page.locator('.waveform').locator('canvas').first().waitFor({state: 'attached', timeout: 60000});
    const waveformReadyMs = performance.now() - started;
    const seekMs = [];
    for (let i = 0; i < 10; i++) {
      const target = 1 + i * .5;
      const start = performance.now();
      await page.locator('.ruler').click({position: {x: target * 36, y: 10}});
      await page.locator(`[data-proof-frame="${target * project.fps}"]`).waitFor({state: 'attached'});
      seekMs.push(performance.now() - start);
    }
    const metrics = await cdp.send('Performance.getMetrics');
    started = performance.now();
    const job = await json<Job>(`/projects/${project.id}/export-jobs`, {allowUntimed: true});
    while (true) {
      const status = await json<Job>(`/jobs/${job.id}`, undefined, 'GET');
      if (status.state === 'succeeded') break;
      assert(!['failed', 'cancelled', 'interrupted'].includes(status.state), status.error ?? status.state);
      assert(performance.now() - started < 15 * 60000, 'Benchmark render exceeded 15 minutes');
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    const exportMs = performance.now() - started;
    const video = await fetch(`${base}/api/jobs/${job.id}/result`, {headers}); assert(video.ok);
    const destination = `${output}/${name}.mp4`; await writeFile(destination, Buffer.from(await video.arrayBuffer()));
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', destination], {encoding: 'utf8', windowsHide: true}));
    const stream = probe.streams.find((stream: {codec_type: string}) => stream.codec_type === 'video');
    assert.equal(Number(stream.nb_frames), Math.round(durationMs * project.fps / 1000));
    assert.equal(stream.width, project.width); assert.equal(stream.height, project.height);
    assert(Math.abs(Number(probe.format.duration) - durationMs / 1000) < 1 / project.fps);
    assert.equal(stream.codec_name, 'h264');
    assert.equal(probe.streams.find((stream: {codec_type: string}) => stream.codec_type === 'audio').codec_name, 'aac');
    let audioSync;
    if (name !== 'short') audioSync = JSON.parse(execFileSync('node', ['scripts/python.mjs', 'scripts/check-audio-sync.py', file, destination,
      ...(name === 'five-minutes' ? ['--points', '5', '150', '290'] : [])], {encoding: 'utf8', windowsHide: true}));
    results.push({name, durationMs, width: project.width, height: project.height, fps: project.fps, importMs, waveformReadyMs, seekMs,
      rendererJsHeapBytes: metrics.metrics.find(metric => metric.name === 'JSHeapUsedSize')?.value, exportMs, frames: Number(stream.nb_frames), audioSync});
    console.log(`${name}: import ${Math.round(importMs)}ms, waveform ${Math.round(waveformReadyMs)}ms, export ${(exportMs / 1000).toFixed(1)}s`);
  }
  // Stress the actual editor at its structural clip/lyric caps without rendering an hour-long video.
  let stress = await json<Project>('/projects');
  stress.name = 'Structural limit benchmark'; stress.durationMs = 3600000;
  setLyrics(stress, Array.from({length: 2000}, (_, i) => `Lyric ${i}`).join('\n'));
  for (let i = 0; i < 2000; i++) updateLine(stress, `line-${i + 1}`, line => {line.status = 'manual'; line.startMs = i * 1800; line.durationMs = 1000;});
  const png = path.join(root, 'red.png'); ffmpeg(['-f', 'lavfi', '-i', 'color=red:s=64x64', '-frames:v', '1', png]);
  const form = new FormData(); form.set('file', new Blob([await readFile(png)]), 'red.png');
  const imported = await json<{project: Project}>(`/projects/${stress.id}/assets`, form);
  stress.assets = imported.project.assets; stress.revision = imported.project.revision;
  const visualTracks = Array.from({length: 10}, (_, i) => trackSchema.parse({id: `stress-track-${i}`, name: `Layer ${i + 1}`, kind: 'visual'}));
  stress.tracks.splice(1, 1, ...visualTracks);
  stress.clips.push(...Array.from({length: 500}, (_, i) => clipSchema.parse({id: crypto.randomUUID(), assetId: stress.assets[0].id,
    startMs: Math.floor(i / 10) * 72000, durationMs: 72000, sourceInMs: 0, kind: 'visual', trackId: visualTracks[i % 10].id})));
  const parseStart = performance.now(); parseProject(stress); const validationMs = performance.now() - parseStart;
  await json(`/projects/${stress.id}`, stress, 'PUT'); await page.goto(base);
  const start = performance.now(); await page.getByRole('button', {name: `${stress.name} Open`, exact: true}).click();
  await page.locator('.track.lyric .timeline-clip').last().waitFor({state: 'attached'});
  assert.equal(await page.locator('.track.lyric .timeline-clip').count(), 2000);
  assert.equal(await page.locator('.track.video .timeline-clip').count(), 500);
  const stressOpenMs = performance.now() - start;
  const zoomStart = performance.now();
  await page.getByLabel('Timeline zoom', {exact: true}).fill('80');
  await page.waitForFunction(() => (document.querySelector('.track.lyric .timeline-clip') as HTMLElement)?.style.width === '80px');
  const zoomMs = performance.now() - zoomStart;
  await page.screenshot({path: `${output}/structural-limit.png`});
  assert.deepEqual(browserErrors, []);
  await writeFile(`${output}/report.json`, JSON.stringify({hardware: {os: `${os.type()} ${os.release()}`, cpu: os.cpus()[0]?.model,
    logicalCpus: os.cpus().length, ramBytes: os.totalmem(), node: process.version}, cases: results,
    structuralStress: {lyrics: 2000, backgrounds: 500, layers: 10, durationMs: 3600000, validationMs, openMs: stressOpenMs, zoomMs, exported: false},
    peakNodeRssBytes: peakNodeRss, memoryScope: 'Node API/harness RSS only; excludes Chromium/FFmpeg. JS heap is sampled, not browser peak RSS.',
    browserErrors, limitations: 'Single run per case; warm caches; first export includes bundling. Measurements are not maximum workload guarantees.'}, null, 2));
} finally {
  clearInterval(sampler); await browser.close(); await web.close(); await api.app.close();
  assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert(path.basename(root).startsWith('lyrics-benchmark-'));
  await rm(root, {recursive: true, force: true});
}
