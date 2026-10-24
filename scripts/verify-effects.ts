import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {chromium, expect} from '@playwright/test';
import {bundle} from '@remotion/bundler';
import {ensureBrowser, renderStill, selectComposition} from '@remotion/renderer';
import {createServer} from 'vite';
import {createApp} from '../apps/api/app';
import {timelineClipSchema, trackSchema, type TimelineProject} from '../packages/project-model/timeline';
import {effectsSchema} from '../packages/project-model/effects';
import type {Job} from '../apps/api/jobs';

const root = await mkdtemp(path.join(tmpdir(), 'lyrics-effects-browser-')), base = 'http://127.0.0.1:5174';
const api = await createApp({root, mediaOrigin: base});
const web = await createServer({plugins: [{name: 'effects-test-page', configureServer(server) {
  server.middlewares.use('/__advanced', (_req, res) => {res.setHeader('Content-Type', 'text/html');
    res.end('<html><body style="margin:0"><div id="root"></div><script type="module" src="/tests/advanced-visual.tsx"></script></body></html>');});
}}], server: {port: 5174, strictPort: true, proxy: {'/api': 'http://127.0.0.1:3002'}}});
const installed = await ensureBrowser(); assert('path' in installed);
const browser = await chromium.launch({executablePath: installed.path});
const ffmpeg = (args: string[]) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], {windowsHide: true});
async function request<T>(route: string, data?: unknown, method = 'POST'): Promise<T> {
  const response = await fetch(`${base}/api${route}`, {method, headers: {'x-local-token': api.token,
    ...(data instanceof FormData || data === undefined ? {} : {'Content-Type': 'application/json'})},
    body: data instanceof FormData ? data : data === undefined ? undefined : JSON.stringify(data)});
  if (!response.ok) throw new Error(await response.text()); return response.json() as Promise<T>;
}
const rgb = (file: string) => ffmpeg(['-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
try {
  await api.app.listen({host: '127.0.0.1', port: 3002}); await web.listen();
  for (const color of ['red', 'blue']) ffmpeg(['-f', 'lavfi', '-i', `color=${color}:s=64x64`, '-frames:v', '1', path.join(root, `${color}.png`)]);
  ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=s=64x64:r=30:d=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(root, 'video.mp4')]);
  ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=s=64x64:r=4:d=2', path.join(root, 'motion.gif')]);
  ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', path.join(root, 'song.wav')]);
  let project = await request<TimelineProject>('/projects');
  for (const name of ['red.png', 'blue.png', 'video.mp4', 'motion.gif', 'song.wav']) {
    const data = new FormData(); data.set('file', new Blob([await readFile(path.join(root, name))]), name);
    project = (await request<{project: TimelineProject}>(`/projects/${project.id}/assets`, data)).project;
  }
  Object.assign(project, {width: 256, height: 144, name: 'Effects verification'});
  const track = project.tracks.find(t => t.kind === 'visual')!;
  const a = timelineClipSchema.parse({kind: 'visual', id: crypto.randomUUID(), trackId: track.id, assetId: project.assets[0].id, startMs: 0, durationMs: 2000, sourceInMs: 0});
  const b = timelineClipSchema.parse({...a, id: crypto.randomUUID(), assetId: project.assets[1].id, startMs: 1000}); project.clips.push(a, b);
  for (const name of ['video.mp4', 'motion.gif']) {
    const layer = trackSchema.parse({id: crypto.randomUUID(), name, kind: 'visual'}); project.tracks.push(layer);
    project.clips.push(timelineClipSchema.parse({...a, id: crypto.randomUUID(), trackId: layer.id, assetId: project.assets.find(asset => asset.name === name)!.id,
      durationMs: 3000, opacity: .25, scale: .3, x: name === 'motion.gif' ? 30 : -30, effects: effectsSchema.parse({blur: 1})}));
  }
  project = await request(`/projects/${project.id}`, project, 'PUT');
  const page = await browser.newPage({viewport: {width: 1560, height: 1200}}), errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base); await page.getByRole('button', {name: `${project.name} Open`, exact: true}).click();
  await page.locator(`[data-clip-id="${a.id}"]`).click({position: {x: 12, y: 18}}); await page.locator(`[data-clip-id="${b.id}"]`).click({modifiers: ['Control']});
  await page.getByLabel('Contrast', {exact: true}).fill('1.2'); await page.getByLabel('Contrast', {exact: true}).press('Tab');
  await page.locator(`[data-clip-id="${b.id}"]`).click();
  await page.getByRole('button', {name: 'Add transition from overlapping previous clip', exact: true}).click();
  await page.getByLabel('Transition type', {exact: true}).selectOption('wipe');
  await page.getByLabel('Transition duration (s)', {exact: true}).fill('1'); await page.getByLabel('Transition duration (s)', {exact: true}).press('Tab');
  await page.getByLabel('Mask shape', {exact: true}).selectOption('ellipse');
  for (const [label, value] of [['Mask width (%)', '70'], ['Mask height (%)', '60'], ['Mask x (%)', '10'], ['Mask y (%)', '20'], ['Blur (px)', '4'], ['Background blur (px)', '8']]) {
    await page.getByLabel(label, {exact: true}).fill(value); await page.getByLabel(label, {exact: true}).press('Tab');
  }
  await page.getByRole('button', {name: 'Delete clip', exact: true}).click(); await expect(page.getByRole('alert')).toContainText('transition');
  await page.getByRole('button', {name: 'Dismiss error', exact: true}).click();
  await page.getByRole('button', {name: 'Remove transition', exact: true}).click(); await page.getByRole('button', {name: 'Undo', exact: true}).click();
  await page.getByRole('button', {name: 'Save', exact: true}).click(); await page.getByRole('status').filter({hasText: /^Saved$/}).waitFor();
  await page.reload(); await page.getByRole('button', {name: `${project.name} Open`, exact: true}).click(); await page.locator(`[data-clip-id="${b.id}"]`).click();
  await expect(page.getByLabel('Transition type', {exact: true})).toHaveValue('wipe'); await expect(page.getByLabel('Mask shape', {exact: true})).toHaveValue('ellipse');
  project = (await request<{project: TimelineProject}>(`/projects/${project.id}`, undefined, 'GET')).project;
  assert(project.clips.filter(c => c.id === a.id || c.id === b.id).every(c => c.kind === 'visual' && c.effects?.contrast === 1.2));
  const assets = Object.fromEntries(project.assets.map(asset => [asset.file, `${base}/api/projects/${project.id}/assets/${asset.id}?cap=${api.token}`]));
  await mkdir('artifacts/advanced/effects', {recursive: true});
  const serveUrl = await bundle({entryPoint: path.resolve('apps/api/remotion.tsx'), publicDir: null, outDir: path.resolve('.cache/effects-bundle')});
  const visual = await browser.newPage({viewport: {width: 1400, height: 1400}}); visual.on('pageerror', error => {errors.push(error.message); console.log('Effects harness error:', error.message);});
  visual.on('console', message => {if (message.type() === 'error') console.log('Effects harness console:', message.text());});
  await visual.goto(`${base}/__advanced`); await visual.locator('[data-proof-canvas]').waitFor();
  const results = [];
  for (const [width, height] of [[256, 144], [144, 256]]) for (const type of ['dissolve', 'slide', 'zoom', 'wipe', 'blur'] as const) {
    Object.assign(project, {width, height}); project.transitions[0].type = type; project.transitions[0].amount = 100;
    const props = {project, assets}; await visual.evaluate(p => window.advancedVisual.load(p), props);
    await expect(visual.locator('[data-proof-canvas]')).toHaveCSS('width', `${width}px`);
    const composition = await selectComposition({serveUrl, id: 'LyricsEditor', inputProps: props});
    for (const frame of [29, 30, 45, 60, 75, 45]) {
      await visual.evaluate(f => window.advancedVisual.seek(f), frame); await visual.locator(`[data-proof-frame="${frame}"]`).waitFor({state: 'attached'});
      await visual.waitForFunction(frame => Array.from(document.querySelectorAll('video')).every(video => !video.seeking && video.readyState >= 2 && Math.abs(video.currentTime - frame / 30) < .04), frame, {timeout: 10000});
      const stem = `artifacts/advanced/effects/${width}-${type}-${frame}`;
      await visual.locator('[data-proof-canvas]').screenshot({path: `${stem}-preview.png`});
      const started = performance.now(); await renderStill({serveUrl, composition, inputProps: props, frame, output: `${stem}-render.png`, imageFormat: 'png'});
      const renderMs = performance.now() - started, a = rgb(`${stem}-preview.png`), b = rgb(`${stem}-render.png`);
      let total = 0, videoTotal = 0, videoCount = 0, staticTotal = 0, staticCount = 0;
      assert.equal(a.length, b.length);
      for (let i = 0; i < a.length; i++) {
        const pixel = Math.floor(i / 3), x = pixel % width, y = Math.floor(pixel / width), difference = Math.abs(a[i] - b[i]); total += difference;
        // Native H.264 and off-thread extraction have a small measured decoder difference; keep the remaining effects/GIF pixels strict.
        if (x < width * .4 && y >= height * .32 && y < height * .68) {videoTotal += difference; videoCount++;}
        else {staticTotal += difference; staticCount++;}
      }
      const error = total / a.length, videoError = videoTotal / videoCount, staticError = staticTotal / staticCount;
      assert(videoError < 4 && staticError < .15, `Effects ${width} ${type} ${frame}: video ${videoError}, other pixels ${staticError}`);
      results.push({width, height, type, frame, renderMs, meanAbsolutePixelError: error, nativeVideoRegionError: videoError, otherPixelError: staticError});
    }
  }
  const foreground = project.clips.find(c => c.id === b.id)!; assert(foreground.kind === 'visual');
  foreground.effects = effectsSchema.parse({blur: 50, backgroundBlur: 50});
  for (const [width, height] of [[1280, 720], [720, 1280]]) {
    Object.assign(project, {width, height}); const props = {project, assets}, composition = await selectComposition({serveUrl, id: 'LyricsEditor', inputProps: props});
    const started = performance.now(); await renderStill({serveUrl, composition, inputProps: props, frame: 45, output: `artifacts/advanced/effects/cap-${width}.png`, imageFormat: 'png'});
    results.push({width, height, type: '50px-cap', frame: 45, renderMs: performance.now() - started, meanAbsolutePixelError: null});
  }
  Object.assign(project, {width: 256, height: 144}); project = await request(`/projects/${project.id}`, project, 'PUT');
  const job = await request<Job>(`/projects/${project.id}/export-jobs`, {allowUntimed: false});
  await expect.poll(async () => {const current = await request<Job>(`/jobs/${job.id}`, undefined, 'GET'); if (current.state === 'failed') throw new Error(current.error); return current.state;}, {timeout: 120000}).toBe('succeeded');
  const result = await fetch(`${base}/api/jobs/${job.id}/result`, {headers: {'x-local-token': api.token}}); assert(result.ok);
  await writeFile('artifacts/advanced/effects/video.mp4', Buffer.from(await result.arrayBuffer()));
  assert.deepEqual(errors, []); await writeFile('artifacts/advanced/effects/report.json', JSON.stringify({results, errors, caps: {blurPx: 50, backgroundBlurPx: 50},
    scope: 'Representative layered GIF/video/color/mask transitions; cost is per still including browser overhead, not maximum-project throughput.'}, null, 2));
  console.log(`Effects passed: batch inspector, overlap partners, orphan protection, undo/save/reopen; ${results.length} render cases and layered MP4.`);
} finally {
  await browser.close(); await web.close(); await api.app.close();
  assert.equal(path.dirname(root), path.resolve(tmpdir())); assert(path.basename(root).startsWith('lyrics-effects-browser-'));
  await rm(root, {recursive: true, force: true});
}
