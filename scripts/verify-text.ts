import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp, mkdir, readFile, rm, unlink, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {chromium, expect} from '@playwright/test';
import {bundle} from '@remotion/bundler';
import {ensureBrowser, renderStill, selectComposition} from '@remotion/renderer';
import {createServer} from 'vite';
import {createApp} from '../apps/api/app';
import {setLyrics, updateLine} from '../packages/editor-core/timeline-commands';
import type {TimelineProject} from '../packages/project-model/timeline';

const root = await mkdtemp(path.join(tmpdir(), 'lyrics-text-browser-')), base = 'http://127.0.0.1:5174';
const api = await createApp({root, mediaOrigin: base});
const web = await createServer({plugins: [{name: 'text-test-page', configureServer(server) {
  server.middlewares.use('/__advanced', (_req, res) => {res.setHeader('Content-Type', 'text/html');
    res.end('<html><body style="margin:0"><div id="root"></div><script type="module" src="/tests/advanced-visual.tsx"></script></body></html>');});
}}], server: {port: 5174, strictPort: true, proxy: {'/api': 'http://127.0.0.1:3002'}}});
const installed = await ensureBrowser(); assert('path' in installed);
const browser = await chromium.launch({executablePath: installed.path});
const fontPath = 'node_modules/@fontsource/inter/files/inter-latin-600-normal.woff2';
async function request<T>(route: string, data?: unknown, method = 'POST'): Promise<T> {
  const response = await fetch(`${base}/api${route}`, {method, headers: {'x-local-token': api.token,
    ...(data === undefined ? {} : {'Content-Type': 'application/json'})}, body: data === undefined ? undefined : JSON.stringify(data)});
  if (!response.ok) throw new Error(await response.text()); return response.json() as Promise<T>;
}
const rgb = (file: string) => execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], {windowsHide: true});
try {
  await api.app.listen({host: '127.0.0.1', port: 3002}); await web.listen();
  let project = await request<TimelineProject>('/projects');
  Object.assign(project, {width: 384, height: 216, durationMs: 3000, name: 'Text verification'});
  project.style.fontSize = 32; project.style.y = 50;
  setLyrics(project, '¡Café!\n歌を歌おう مرحبا'); updateLine(project, 'line-1', l => {
    l.text = '¡Café!\n歌を歌おう مرحبا'; l.startMs = 0; l.durationMs = 3000; l.status = 'manual';
    l.words = [{text: '¡Café!\n', startMs: 300, endMs: 900}, {text: '歌を歌おう ', startMs: 1200, endMs: 1900}, {text: 'مرحبا', startMs: 2100, endMs: 2700}];
  });
  // The source is one explicitly multiline clip; do not manufacture another timed occurrence.
  project.lyricSource.lines = project.lyricSource.lines.filter(l => l.id === 'line-1');
  project = await request(`/projects/${project.id}`, project, 'PUT');
  assert.equal(project.clips.find(c => c.kind === 'lyric')?.words.length, 3, 'Fixture must contain actual timed words');
  const page = await browser.newPage({viewport: {width: 1560, height: 1200}}), errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base); await page.getByRole('button', {name: `${project.name} Open`, exact: true}).click();
  await page.getByLabel('Font attribution', {exact: true}).fill('Inter fixture from installed @fontsource/inter');
  await page.getByLabel('Import font', {exact: true}).setInputFiles(fontPath);
  await expect(page.getByLabel('Font', {exact: true}).locator('option')).toHaveCount(4);
  project = (await request<{project: TimelineProject}>(`/projects/${project.id}`, undefined, 'GET')).project;
  const font = project.fonts[0]; assert(font.attribution);
  await page.getByLabel('Font', {exact: true}).selectOption(`font:${font.id}`);
  await page.getByRole('button', {name: 'Word pulse template', exact: true}).click();
  await page.getByLabel('entrance duration (s)', {exact: true}).fill('.3'); await page.getByLabel('entrance duration (s)', {exact: true}).press('Tab');
  await page.getByLabel('Line reveal', {exact: true}).selectOption('accumulate');
  await page.getByLabel('Template name', {exact: true}).fill('Imported pulse'); await page.getByRole('button', {name: 'Save template', exact: true}).click();
  await expect(page.getByLabel('Saved templates', {exact: true}).locator('option')).toHaveCount(2);
  await page.getByRole('button', {name: 'Reset text motion', exact: true}).click(); await page.getByRole('button', {name: 'Apply template', exact: true}).click();
  await expect(page.getByLabel('Word emphasis scale', {exact: true})).toHaveValue('1.15');
  await page.getByRole('button', {name: 'Undo', exact: true}).click(); await expect(page.getByLabel('Word emphasis scale', {exact: true})).toHaveValue('1');
  await page.getByRole('button', {name: 'Redo', exact: true}).click();
  await page.getByLabel('Template name', {exact: true}).fill('Renamed pulse'); await page.getByRole('button', {name: 'Rename template', exact: true}).click();
  await expect(page.getByLabel('Saved templates', {exact: true}).locator('option').last()).toHaveText('Renamed pulse');
  await page.getByRole('button', {name: 'Delete template', exact: true}).click();
  await expect(page.getByLabel('Saved templates', {exact: true}).locator('option')).toHaveCount(1);
  await page.getByRole('button', {name: 'Save', exact: true}).click(); await page.getByRole('status').filter({hasText: /^Saved$/}).waitFor();
  await page.reload(); await page.getByRole('button', {name: `${project.name} Open`, exact: true}).click();
  await expect(page.getByLabel('Font', {exact: true})).toHaveValue(`font:${font.id}`);
  project = (await request<{project: TimelineProject}>(`/projects/${project.id}`, undefined, 'GET')).project;
  project.clips.find(c => c.kind === 'lyric')!.animation = {originMs: 0, curves: {}, colors: {
    color: [{timeMs: 0, value: '#ffffff', easing: 'linear'}, {timeMs: 2000, value: '#ffcc00', easing: 'linear'}],
    activeColor: [{timeMs: 0, value: '#00ff00', easing: 'ease-in'}, {timeMs: 2000, value: '#00ffff', easing: 'linear'}],
  }};
  const assets = {[font.file]: `${base}/api/projects/${project.id}/assets/${font.id}?cap=${api.token}`};
  await mkdir('artifacts/advanced/text', {recursive: true});
  const serveUrl = await bundle({entryPoint: path.resolve('apps/api/remotion.tsx'), publicDir: null, outDir: path.resolve('.cache/text-bundle')});
  const visual = await browser.newPage({viewport: {width: 700, height: 700}}); visual.on('pageerror', error => errors.push(error.message));
  await visual.goto(`${base}/__advanced`); await visual.locator('[data-proof-canvas]').waitFor();
  const results = [];
  for (const [width, height] of [[384, 216], [216, 384]]) for (const reveal of ['line', 'accumulate'] as const) {
    Object.assign(project, {width, height}); project.textMotion!.reveal = reveal;
    const props = {project, assets}; await visual.evaluate(p => window.advancedVisual.load(p), props);
    await expect(visual.locator('[data-proof-canvas]')).toHaveCSS('width', `${width}px`);
    await visual.waitForFunction(id => Array.from(document.fonts).some(face => face.family === `project-font-${id}` && face.status === 'loaded'), font.id);
    const composition = await selectComposition({serveUrl, id: 'LyricsEditor', inputProps: props});
    for (const frame of [0, 15, 30, 45, 75, 15]) {
      await visual.evaluate(f => window.advancedVisual.seek(f), frame); await visual.locator(`[data-proof-frame="${frame}"]`).waitFor({state: 'attached'});
      await expect(visual.locator('[data-word-progress]')).toHaveCount(3);
      if (frame === 15) {
        await expect(visual.locator('[data-reveal-line="0"]')).toHaveCSS('visibility', 'visible');
        await expect(visual.locator('[data-reveal-line="1"]')).toHaveCSS('visibility', 'hidden');
      }
      if (frame === 75) await expect(visual.locator('[data-reveal-line="0"]')).toHaveCSS('visibility', reveal === 'line' ? 'hidden' : 'visible');
      const stem = `artifacts/advanced/text/${width}-${reveal}-${frame}`;
      await visual.locator('[data-proof-canvas]').screenshot({path: `${stem}-preview.png`});
      await renderStill({serveUrl, composition, inputProps: props, frame, output: `${stem}-render.png`, imageFormat: 'png'});
      const a = rgb(`${stem}-preview.png`), b = rgb(`${stem}-render.png`); let total = 0;
      assert.equal(a.length, b.length); for (let i = 0; i < a.length; i++) total += Math.abs(a[i] - b[i]);
      const error = total / a.length; assert(error < .15, `Text ${width} ${reveal} ${frame}: pixel error ${error}`);
      results.push({width, height, reveal, frame, meanAbsolutePixelError: error});
    }
  }
  assert.deepEqual(errors, []);
  await unlink(path.join(root, project.id, 'assets', font.file));
  const missing = await request<{missing: string[]}>(`/projects/${project.id}`, undefined, 'GET'); assert(missing.missing.includes(font.name));
  const badProps = {project, assets: {[font.file]: `${assets[font.file]}&missing=true`}};
  const composition = await selectComposition({serveUrl, id: 'LyricsEditor', inputProps: badProps});
  await assert.rejects(() => renderStill({serveUrl, composition, inputProps: badProps, frame: 15, output: 'artifacts/advanced/text/missing.png'}), /font|fetch|network/i);
  await page.getByLabel(`Repair font ${font.name}`, {exact: true}).setInputFiles(fontPath);
  await expect.poll(async () => (await request<{missing: string[]}>(`/projects/${project.id}`, undefined, 'GET')).missing).toEqual([]);
  assert.deepEqual(await readFile(path.join(root, project.id, 'assets', font.file)), await readFile(fontPath));
  await writeFile('artifacts/advanced/text/report.json', JSON.stringify({results, missingFontRejected: true, identicalRepair: true, errors,
    scope: 'Imported Inter Latin font plus host fallback for other scripts; no cross-platform glyph guarantee.'}, null, 2));
  console.log(`Text passed: imported font, copied presets/rename/delete/undo, save/reopen, ${results.length} shaping/reveal/emphasis preview-render frames, missing font failure and repair.`);
} finally {
  await browser.close(); await web.close(); await api.app.close();
  assert.equal(path.dirname(root), path.resolve(tmpdir())); assert(path.basename(root).startsWith('lyrics-text-browser-'));
  await rm(root, {recursive: true, force: true});
}
