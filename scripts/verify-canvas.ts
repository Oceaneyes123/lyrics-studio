import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {chromium, expect} from '@playwright/test';
import {bundle} from '@remotion/bundler';
import {ensureBrowser, renderStill, selectComposition} from '@remotion/renderer';
import {createServer} from 'vite';
import {createApp} from '../apps/api/app';
import {timelineClipSchema, type TimelineProject} from '../packages/project-model/timeline';
import {transformSchema} from '../packages/project-model/canvas';
import {remapCanvas} from '../packages/editor-core/canvas-transforms';
import {setLyrics, updateLine} from '../packages/editor-core/timeline-commands';

const root = await mkdtemp(path.join(tmpdir(), 'lyrics-canvas-browser-')), base = 'http://127.0.0.1:5174';
const api = await createApp({root, mediaOrigin: base});
const web = await createServer({plugins: [{name: 'canvas-test', configureServer(server) {
  server.middlewares.use('/__advanced', (_req, res) => {res.setHeader('Content-Type', 'text/html');
    res.end('<html><body style="margin:0"><div id="root"></div><script type="module" src="/tests/advanced-visual.tsx"></script></body></html>');});
}}], server: {port: 5174, strictPort: true, proxy: {'/api': 'http://127.0.0.1:3002'}}});
const installed = await ensureBrowser(); assert('path' in installed);
const browser = await chromium.launch({executablePath: installed.path});
async function request<T>(route: string, data?: unknown, method = 'POST'): Promise<T> {
  const response = await fetch(`${base}/api${route}`, {method, headers: {'x-local-token': api.token,
    ...(data === undefined ? {} : {'Content-Type': 'application/json'})}, body: data === undefined ? undefined : JSON.stringify(data)});
  if (!response.ok) throw new Error(await response.text()); return response.json() as Promise<T>;
}
const rgb = (file: string) => execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], {windowsHide: true, maxBuffer: 8 * 1024 * 1024});
try {
  await mkdir('artifacts/canvas', {recursive: true});
  await api.app.listen({host: '127.0.0.1', port: 3002}); await web.listen();
  let project = await request<TimelineProject>('/projects');
  Object.assign(project, {width: 640, height: 360, durationMs: 3000, name: 'Canvas verification'});
  project.style.fontSize = 24; project.style.outline = 0;
  setLyrics(project, 'Sing together');
  updateLine(project, project.lyricSource.lines[0].id, l => {
    l.startMs = 0; l.durationMs = 3000; l.status = 'manual';
    l.words = [{text: 'Sing ', startMs: 0, endMs: 1500}, {text: 'together', startMs: 1500, endMs: 3000}];
  });
  project.clips.push(timelineClipSchema.parse({id: 'title', kind: 'text', text: 'Canvas title', trackId: 'track:visual:0',
    style: {...project.style, fontSize: 30}, startMs: 0, durationMs: 3000,
    transform: transformSchema.parse({x: 100, y: 40, width: 300, height: 70})}));
  project = await request<TimelineProject>(`/projects/${project.id}`, project, 'PUT');
  const page = await browser.newPage({viewport: {width: 1700, height: 1100}});
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(base); await page.getByRole('button', {name: `${project.name} Open`, exact: true}).click();
  const title = page.locator('[data-canvas-id="title"]'); await title.click();
  await expect(page.getByLabel('Object x', {exact: true})).toHaveValue('100');
  await expect(page.locator('.moveable-control')).not.toHaveCount(0);
  const state = () => page.evaluate(async () => {
    // @ts-expect-error Vite exposes the actual editor store in this browser-only test.
    const {useEditor} = await import('/apps/web/store.ts');
    return {project: useEditor.getState().project as TimelineProject, history: useEditor.getState().past.length};
  });
  const initial = await state(), bounds = await title.boundingBox(); assert(bounds);
  const displayedScale = bounds.width / 300;
  await page.mouse.move(bounds.x + 35, bounds.y + 25); await page.mouse.down();
  await page.mouse.move(bounds.x + 35 + 40 * displayedScale, bounds.y + 25 + 20 * displayedScale, {steps: 6});
  assert.equal((await state()).history, initial.history, 'Pointer movement must not write project history');
  await page.mouse.up();
  await expect.poll(async () => (await state()).history).toBe(initial.history + 1);
  const moved = (await state()).project.clips.find(c => c.id === 'title')!.transform!;
  assert(Math.abs(moved.x - 140) < 2 && Math.abs(moved.y - 60) < 2, JSON.stringify(moved));
  await page.getByRole('button', {name: 'Undo', exact: true}).click(); await expect(page.getByLabel('Object x', {exact: true})).toHaveValue('100');
  await page.getByRole('button', {name: 'Redo', exact: true}).click(); await expect(page.getByLabel('Object x', {exact: true})).toHaveValue(String(Math.round(moved.x * 1000) / 1000));
  await page.getByLabel('Object rotation', {exact: true}).fill('32'); await page.getByLabel('Object rotation', {exact: true}).press('Enter');
  await expect(page.getByLabel('Object rotation', {exact: true})).toHaveValue('32');
  await page.getByLabel('Canvas zoom', {exact: true}).selectOption('0.5');
  await expect(page.locator('.canvas-project')).toHaveCSS('transform', 'matrix(0.5, 0, 0, 0.5, 0, 0)');
  const beforeResize = (await state()).project.clips.find(c => c.id === 'title')!.transform!;
  const handle = page.locator('.moveable-control.moveable-se'); await handle.waitFor();
  const hb = await handle.boundingBox(); assert(hb);
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2); await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 + 30, hb.y + hb.height / 2 + 20, {steps: 8}); await page.mouse.up();
  await expect.poll(async () => (await state()).project.clips.find(c => c.id === 'title')!.transform!.width).not.toBe(beforeResize.width);
  const rotateHandle = page.locator('.moveable-rotation-control'); const rb = await rotateHandle.boundingBox(); assert(rb);
  await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2); await page.mouse.down();
  await page.mouse.move(rb.x + rb.width / 2 + 55, rb.y + rb.height / 2 + 20, {steps: 8}); await page.mouse.up();
  await expect.poll(async () => (await state()).project.clips.find(c => c.id === 'title')!.transform!.rotation).not.toBe(32);
  await title.dblclick(); await page.getByLabel('Edit canvas text', {exact: true}).fill('Edited title\nWrapped words');
  await page.getByRole('button', {name: 'Apply text', exact: true}).click();
  await page.getByRole('button', {name: 'Lock object', exact: true}).click(); await expect(title).toHaveAttribute('aria-disabled', 'true');
  await page.getByRole('button', {name: 'Unlock object', exact: true}).click();
  await page.getByRole('button', {name: 'Duplicate object', exact: true}).click();
  assert.equal((await state()).project.clips.filter(c => c.kind === 'text').length, 2);
  await page.getByRole('button', {name: 'Delete object', exact: true}).click();
  await title.click(); await title.focus(); const nudge = (await state()).project.clips.find(c => c.id === 'title')!.transform!.x;
  await page.keyboard.press('ArrowRight'); await expect.poll(async () => (await state()).project.clips.find(c => c.id === 'title')!.transform!.x).toBe(nudge + 1);
  await page.getByLabel('Hide object', {exact: false}).check(); await expect(title).toHaveCount(0);
  await page.getByLabel('Hide object', {exact: false}).uncheck();
  await page.getByRole('button', {name: '＋ Text', exact: true}).click();
  assert.equal((await state()).project.clips.filter(c => c.kind === 'text').length, 2);
  await page.getByRole('button', {name: 'Delete object', exact: true}).click();
  await title.click();
  await expect.poll(async () => (await request<{project: TimelineProject}>(`/projects/${project.id}`, undefined, 'GET')).project.clips.find(c => c.id === 'title')?.transform).toEqual((await state()).project.clips.find(c => c.id === 'title')!.transform);
  let saved = (await state()).project; await page.reload(); await page.getByRole('button', {name: `${project.name} Open`, exact: true}).click();
  await title.click(); assert.deepEqual((await state()).project.clips.find(c => c.id === 'title')!.transform, saved.clips.find(c => c.id === 'title')!.transform);
  // Mixed lyric/text group transforms must preserve karaoke timing and form one history action.
  const lyricId = saved.clips.find(c => c.kind === 'lyric')!.id;
  await title.click(); await page.locator(`[data-canvas-id="${lyricId}"]`).click({modifiers: ['Control']});
  await expect(page.locator('.canvas-object[aria-pressed="true"]')).toHaveCount(2);
  await page.getByLabel('Snap canvas', {exact: true}).uncheck();
  const groupStart = await state(), gb = await title.boundingBox(); assert(gb);
  await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2); await page.mouse.down();
  await page.mouse.move(gb.x + gb.width / 2 + 20, gb.y + gb.height / 2 + 12, {steps: 6}); await page.mouse.up();
  await expect.poll(async () => (await state()).history).toBe(groupStart.history + 1);
  const grouped = await state(); assert(grouped.project.clips.find(c => c.id === lyricId)!.transform);
  assert.deepEqual(grouped.project.clips.find(c => c.id === lyricId)!.kind === 'lyric' &&
    (grouped.project.clips.find(c => c.id === lyricId) as {words: unknown}).words,
    (groupStart.project.clips.find(c => c.id === lyricId) as {words: unknown}).words);
  const groupHandle = await page.locator('.moveable-control.moveable-se').boundingBox(); assert(groupHandle);
  await page.mouse.move(groupHandle.x + groupHandle.width / 2, groupHandle.y + groupHandle.height / 2); await page.mouse.down();
  await page.mouse.move(groupHandle.x + groupHandle.width / 2 + 20, groupHandle.y + groupHandle.height / 2 + 10, {steps: 6}); await page.mouse.up();
  await expect.poll(async () => (await state()).history).toBe(grouped.history + 1);
  const groupRot = await page.locator('.moveable-rotation-control').boundingBox(); assert(groupRot);
  await page.mouse.move(groupRot.x + groupRot.width / 2, groupRot.y + groupRot.height / 2); await page.mouse.down();
  await page.mouse.move(groupRot.x + groupRot.width / 2 + 35, groupRot.y + groupRot.height / 2 + 15, {steps: 6}); await page.mouse.up();
  await expect.poll(async () => (await state()).history).toBe(grouped.history + 2);
  await title.click({modifiers: ['Control']});
  await expect(page.locator('.canvas-object[aria-pressed="true"]')).toHaveCount(1);
  // Actual local imports exercise media-specific fit, rotation, alpha and export placement.
  const mediaFiles = [path.join(root, 'canvas-red.png'), path.join(root, 'canvas-green.mp4'), path.join(root, 'canvas-blue.gif')];
  const ffmpeg = (args: string[]) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], {windowsHide: true});
  ffmpeg(['-f', 'lavfi', '-i', 'color=red:s=160x90', '-frames:v', '1', mediaFiles[0]]);
  ffmpeg(['-f', 'lavfi', '-i', 'color=green:s=160x90:r=30:d=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', mediaFiles[1]]);
  ffmpeg(['-f', 'lavfi', '-i', 'color=blue:s=160x90:r=10:d=1', mediaFiles[2]]);
  const song = path.join(root, 'canvas-song.wav');
  ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=3', song]);
  await page.getByLabel('Upload media', {exact: true}).setInputFiles(song);
  await page.getByText('canvas-song.wav imported.', {exact: false}).waitFor();
  for (const [index, file] of mediaFiles.entries()) {
    await page.getByLabel('Upload media', {exact: true}).setInputFiles(file);
    await page.getByText(`${path.basename(file)} imported.`, {exact: false}).waitFor();
    const oldCount = (await state()).project.clips.length;
    await page.locator('.asset').filter({hasText: path.basename(file)}).dragTo(page.getByLabel('+ Layer timeline', {exact: true}), {targetPosition: {x: 0, y: 20}});
    await expect.poll(async () => (await state()).project.clips.length).toBe(oldCount + 1);
    for (const [field, value] of Object.entries({x: 340 + index * 50, y: 40 + index * 60, width: 150, height: 90, rotation: index * 15, opacity: .7})) {
      await page.getByLabel(`Object ${field}`, {exact: true}).fill(String(value)); await page.getByLabel(`Object ${field}`, {exact: true}).press('Enter');
    }
    await page.getByLabel('Object fit', {exact: true}).selectOption(index === 0 ? 'contain' : 'cover');
    const mediaProject = (await state()).project, mediaClip = mediaProject.clips.at(-1)!;
    assert(mediaClip.kind === 'visual'); assert.equal(mediaProject.assets.find(a => a.id === mediaClip.assetId)?.name, path.basename(file));
    const mediaObject = page.locator(`[data-canvas-id="${mediaClip.id}"]`); await mediaObject.click();
    const mb = await mediaObject.boundingBox(); assert(mb);
    const history = (await state()).history;
    await page.mouse.move(mb.x + mb.width / 2, mb.y + mb.height / 2); await page.mouse.down();
    await page.mouse.move(mb.x + mb.width / 2 + 10, mb.y + mb.height / 2 + 5, {steps: 5}); await page.mouse.up();
    await expect.poll(async () => (await state()).history).toBe(history + 1);
  }
  saved = (await state()).project;
  assert.equal(saved.clips.filter(c => c.kind === 'visual').length, 3);
  assert.equal(new Set(saved.clips.filter(c => c.kind === 'visual').map(c => c.trackId)).size, 3);
  await page.getByRole('button', {name: 'Save', exact: true}).click();
  await expect.poll(async () => (await request<{project: TimelineProject}>(`/projects/${project.id}`, undefined, 'GET')).project.clips).toEqual(saved.clips);
  await page.screenshot({path: 'artifacts/canvas/editor.png', fullPage: true});
  const serveUrl = await bundle({entryPoint: path.resolve('apps/api/remotion.tsx'), publicDir: null, outDir: path.resolve('.cache/canvas-bundle')});
  const visual = await browser.newPage({viewport: {width: 900, height: 900}}); await visual.goto(`${base}/__advanced`);
  const results = [];
  for (const [width, height] of [[640, 360], [360, 640]]) {
    const p = structuredClone(saved); remapCanvas(p, width, height);
    const assets = Object.fromEntries(p.assets.map(a => [a.file, `${base}/api/projects/${p.id}/assets/${a.id}?cap=${api.token}`]));
    const props = {project: p, assets}; await visual.evaluate(p => window.advancedVisual.load(p), props);
    await expect(visual.locator('[data-proof-canvas]')).toHaveCSS('width', `${width}px`);
    const composition = await selectComposition({serveUrl, id: 'LyricsEditor', inputProps: props});
    for (const frame of [0, 40, 75]) {
      await visual.evaluate(f => window.advancedVisual.seek(f), frame);
      await visual.locator(`[data-proof-frame="${frame}"]`).waitFor({state: 'attached'});
      const stem = `artifacts/canvas/${width}-${frame}`;
      await visual.locator('[data-proof-canvas]').screenshot({path: `${stem}-preview.png`});
      await renderStill({serveUrl, composition, inputProps: props, frame, output: `${stem}-render.png`, imageFormat: 'png'});
      const a = rgb(`${stem}-preview.png`), b = rgb(`${stem}-render.png`); let total = 0;
      assert.equal(a.length, b.length); for (let i = 0; i < a.length; i++) total += Math.abs(a[i] - b[i]);
      const error = total / a.length; assert(error < .6, `Preview/render mean error ${error}`); results.push({width, height, frame, error});
    }
  }
  const job = await request<{id: string}>(`/projects/${saved.id}/export-jobs`, {allowUntimed: false});
  await expect.poll(async () => {const result = await request<{state: string; error?: string}>(`/jobs/${job.id}`, undefined, 'GET');
    if (result.state === 'failed') throw new Error(result.error); return result.state;
  }, {timeout: 180000}).toBe('succeeded');
  const exported = await fetch(`${base}/api/jobs/${job.id}/result`, {headers: {'x-local-token': api.token}}); assert(exported.ok);
  await writeFile('artifacts/canvas/export.mp4', Buffer.from(await exported.arrayBuffer()));
  const decoded = execFileSync('ffmpeg', ['-v', 'error', '-i', 'artifacts/canvas/export.mp4', '-vf', 'select=eq(n\\,40)', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], {windowsHide: true, maxBuffer: 8 * 1024 * 1024});
  const expected = rgb('artifacts/canvas/640-40-render.png'); assert.equal(decoded.length, expected.length);
  let mp4Error = 0; for (let i = 0; i < decoded.length; i++) mp4Error += Math.abs(decoded[i] - expected[i]);
  mp4Error /= decoded.length; assert(mp4Error < 4, `Decoded MP4 placement mismatch: ${mp4Error}`);
  assert.deepEqual(await page.getByRole('alert').allTextContents(), []);
  assert.deepEqual(errors, []);
  await writeFile('artifacts/canvas/report.json', JSON.stringify({results, errors, mp4Error, groups: true, media: ['image', 'video', 'gif'], gestures: ['drag', 'resize', 'rotate'], persistence: true}, null, 2));
  console.log(`Canvas passed: React 19 Moveable gestures, history, inspector, text, lock/hide, duplicate/delete, zoom, save/reopen and ${results.length} export-parity frames.`);
} finally {
  await browser.close(); await web.close(); await api.app.close();
  assert.equal(path.dirname(root), path.resolve(tmpdir())); assert(path.basename(root).startsWith('lyrics-canvas-browser-'));
  await rm(root, {recursive: true, force: true});
}
