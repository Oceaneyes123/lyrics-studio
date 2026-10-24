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
import {visualClips, splitClip, updateLine, setLyrics} from '../packages/editor-core/timeline-commands';
import {parseTimeline, type TimelineProject} from '../packages/project-model/timeline';

const root = await mkdtemp(path.join(tmpdir(), 'lyrics-animation-browser-')), base = 'http://127.0.0.1:5174';
const api = await createApp({root, mediaOrigin: base});
const web = await createServer({plugins: [{name: 'animation-test-page', configureServer(server) {
  server.middlewares.use('/__advanced', (_req, res) => {res.setHeader('Content-Type', 'text/html');
    res.end('<html><body style="margin:0"><div id="root"></div><script type="module" src="/tests/advanced-visual.tsx"></script></body></html>');});
}}], server: {port: 5174, strictPort: true, proxy: {'/api': 'http://127.0.0.1:3002'}}});
const installed = await ensureBrowser(); assert('path' in installed);
const browser = await chromium.launch({executablePath: installed.path});
async function request<T>(route: string, data?: unknown, method = 'POST'): Promise<T> {
  const response = await fetch(`${base}/api${route}`, {method, headers: {'x-local-token': api.token,
    ...(data instanceof FormData || data === undefined ? {} : {'Content-Type': 'application/json'})},
    body: data instanceof FormData ? data : data === undefined ? undefined : JSON.stringify(data)});
  if (!response.ok) throw new Error(await response.text()); return response.json() as Promise<T>;
}
const rgb = (file: string) => execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], {windowsHide: true});
try {
  await api.app.listen({host: '127.0.0.1', port: 3002}); await web.listen();
  const png = execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=red:s=128x128,drawbox=x=0:y=0:w=64:h=64:color=blue:t=fill', '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-'], {windowsHide: true});
  let project = await request<TimelineProject>('/projects');
  const data = new FormData(); data.set('file', new Blob([png]), 'pattern.png');
  project = (await request<{project: TimelineProject}>(`/projects/${project.id}/assets`, data)).project;
  Object.assign(project, {width: 256, height: 144, durationMs: 3000, name: 'Animation verification'});
  project = await request(`/projects/${project.id}`, project, 'PUT');
  const page = await browser.newPage({viewport: {width: 1560, height: 1200}}), errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base); await page.getByRole('button', {name: `${project.name} Open`, exact: true}).click();
  await page.getByRole('button', {name: 'Add background pattern.png', exact: true}).click();
  await page.locator('.ruler').click({position: {x: 0, y: 10}});
  await page.getByRole('button', {name: 'Add/update keyframe', exact: true}).click();
  await page.locator('.ruler').click({position: {x: 36, y: 10}});
  await page.getByLabel('Keyframe value', {exact: true}).fill('30'); await page.getByLabel('Keyframe value', {exact: true}).press('Tab');
  await page.getByLabel('Keyframe easing', {exact: true}).selectOption('ease-in-out');
  await page.getByRole('button', {name: 'Previous keyframe', exact: true}).click();
  await expect(page.getByLabel('Keyframe value', {exact: true})).toHaveValue('0');
  await page.getByRole('button', {name: 'Next keyframe', exact: true}).click();
  await expect(page.getByLabel('Keyframe value', {exact: true})).toHaveValue('30');
  await page.getByRole('button', {name: 'Delete keyframe', exact: true}).click();
  await page.getByRole('button', {name: 'Undo', exact: true}).click();
  await expect(page.getByLabel('Keyframe value', {exact: true})).toHaveValue('30');
  await page.getByRole('button', {name: 'Save', exact: true}).click(); await page.getByRole('status').filter({hasText: /^Saved$/}).waitFor();
  project = (await request<{project: TimelineProject}>(`/projects/${project.id}`, undefined, 'GET')).project;
  const clip = visualClips(project)[0]; assert.equal(clip.animation?.curves.x?.length, 2);
  clip.animation = {originMs: 0, curves: {x: [{timeMs: 0, value: 0, easing: 'ease-in'}, {timeMs: 1000, value: 30, easing: 'hold'}, {timeMs: 2000, value: -10, easing: 'linear'}],
    rotation: [{timeMs: 0, value: 0, easing: 'linear'}, {timeMs: 2000, value: 45, easing: 'linear'}],
    scale: [{timeMs: 0, value: 1, easing: 'ease-out'}, {timeMs: 2000, value: 1.5, easing: 'linear'}],
    opacity: [{timeMs: 0, value: .4, easing: 'linear'}, {timeMs: 2000, value: 1, easing: 'linear'}]}};
  setLyrics(project, 'Sing again'); updateLine(project, 'line-1', l => {l.startMs = 0; l.durationMs = 3000; l.status = 'manual';});
  const lyric = project.clips.find(c => c.kind === 'lyric')!;
  lyric.animation = {originMs: 0, curves: {fontSize: [{timeMs: 0, value: 20, easing: 'linear'}, {timeMs: 2000, value: 36, easing: 'linear'}],
    y: [{timeMs: 0, value: 40, easing: 'linear'}, {timeMs: 2000, value: 70, easing: 'linear'}]}};
  project = splitClip(parseTimeline(project), clip.id, 1000);
  const assets = {[project.assets[0].file]: `data:image/png;base64,${png.toString('base64')}`};
  await mkdir('artifacts/advanced/animation', {recursive: true});
  const serveUrl = await bundle({entryPoint: path.resolve('apps/api/remotion.tsx'), publicDir: null, outDir: path.resolve('.cache/animation-bundle')});
  const visual = await browser.newPage({viewport: {width: 600, height: 600}}); visual.on('pageerror', error => errors.push(error.message));
  await visual.goto(`${base}/__advanced`); await visual.locator('[data-proof-canvas]').waitFor();
  const results = [];
  for (const fps of [24, 25, 30] as const) {
    project.fps = fps;
    const props = {project, assets};
    await visual.evaluate(p => window.advancedVisual.load(p), props);
    await expect(visual.locator('[data-proof-canvas]')).toHaveCSS('width', '256px');
    const composition = await selectComposition({serveUrl, id: 'LyricsEditor', inputProps: props});
    for (const frame of [fps + 1, 0, fps * 2, Math.round(fps / 2), fps - 1, fps, fps + 1]) {
      await visual.evaluate(f => window.advancedVisual.seek(f), frame);
      await visual.locator(`[data-proof-frame="${frame}"]`).waitFor({state: 'attached'});
      const stem = `artifacts/advanced/animation/${fps}-${frame}`;
      await visual.locator('[data-proof-canvas]').screenshot({path: `${stem}-preview.png`});
      await renderStill({serveUrl, composition, inputProps: props, frame, output: `${stem}-render.png`, imageFormat: 'png'});
      const a = rgb(`${stem}-preview.png`), b = rgb(`${stem}-render.png`); assert.equal(a.length, b.length);
      let total = 0; for (let i = 0; i < a.length; i++) total += Math.abs(a[i] - b[i]);
      const error = total / a.length; assert(error < .15, `Animation ${fps} frame ${frame}: pixel error ${error}`);
      results.push({fps, frame, meanAbsolutePixelError: error});
    }
  }
  assert.deepEqual(errors, []); await writeFile('artifacts/advanced/animation/report.json', JSON.stringify({results, errors}, null, 2));
  await readFile('artifacts/advanced/animation/report.json');
  console.log(`Animation passed: editor key creation/edit/navigation/delete/undo/persistence; ${results.length} preview/render comparisons including splits, discontinuities and random seeks.`);
} finally {
  await browser.close(); await web.close(); await api.app.close();
  assert.equal(path.dirname(root), path.resolve(tmpdir())); assert(path.basename(root).startsWith('lyrics-animation-browser-'));
  await rm(root, {recursive: true, force: true});
}
