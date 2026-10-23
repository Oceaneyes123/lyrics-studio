import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {chromium, expect} from '@playwright/test';
import {ensureBrowser} from '@remotion/renderer';
import {createServer} from 'vite';
import {createApp} from '../apps/api/app';
import type {Project} from '../packages/project-model/model';

const root = await mkdtemp(path.join(tmpdir(), 'lyrics-backgrounds-'));
const base = 'http://127.0.0.1:5174';
const api = await createApp({root, mediaOrigin: base});
const web = await createServer({server: {port: 5174, proxy: {'/api': 'http://127.0.0.1:3002'}}});
const installed = await ensureBrowser();
assert('path' in installed);
const browser = await chromium.launch({executablePath: installed.path});
try {
  await api.app.listen({host: '127.0.0.1', port: 3002}); await web.listen();
  const ffmpeg = (args: string[]) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], {windowsHide: true});
  const png = path.join(root, 'red.png'), gif = path.join(root, 'animated.gif'), audio = path.join(root, 'song.wav'), green = path.join(root, 'green.mp4');
  ffmpeg(['-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono', '-t', '30', audio]);
  ffmpeg(['-f', 'lavfi', '-i', 'color=red:s=64x64', '-frames:v', '1', png]);
  ffmpeg(['-f', 'lavfi', '-i', 'color=0x00ff00:s=64x64:r=30:d=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', green]);
  ffmpeg(['-f', 'lavfi', '-i', 'color=red:s=64x64:r=10:d=0.5', '-f', 'lavfi', '-i', 'color=blue:s=64x64:r=10:d=0.5',
    '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0,split[a][b];[a]palettegen[p];[b][p]paletteuse', gif]);
  const page = await browser.newPage({viewport: {width: 1560, height: 1120}});
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  await page.getByRole('button', {name: 'Create a lyric video', exact: true}).click();
  const upload = page.getByLabel('Upload media', {exact: true});
  for (const file of [audio, png, gif]) {
    await upload.setInputFiles(file);
    await page.getByText(`${path.basename(file)} imported.`, {exact: false}).waitFor();
  }
  const source = page.locator('.asset').filter({hasText: 'red.png'});
  const lane = page.locator('[data-video-layer="0"]');
  await source.dragTo(lane, {targetPosition: {x: 72, y: 20}});
  await expect(page.getByLabel('Clip start (s)', {exact: true})).toHaveValue('2');
  await expect(page.getByLabel('Clip duration (s)', {exact: true})).toHaveValue('28');
  await expect(lane.locator('.timeline-clip')).toHaveCount(1);
  await page.getByRole('button', {name: 'Undo', exact: true}).click();
  await expect(lane.locator('.timeline-clip')).toHaveCount(0);
  await page.getByRole('button', {name: 'Redo', exact: true}).click();
  await expect(lane.locator('.timeline-clip')).toHaveCount(1);
  await page.getByRole('button', {name: 'Delete clip', exact: true}).click();
  const animated = page.locator('.asset').filter({hasText: 'animated.gif'});
  await animated.dragTo(lane, {targetPosition: {x: 36, y: 20}});
  await expect(page.getByLabel('Clip start (s)', {exact: true})).toHaveValue('1');
  // Seek through two cycles while paused: decoded colors must follow timeline time.
  const ruler = page.locator('.ruler');
  async function seek(seconds: number) {await ruler.click({position: {x: seconds * 36, y: 10}});}
  const canvas = page.locator('[data-proof-canvas] canvas');
  async function color() {
    return canvas.evaluate((element: HTMLCanvasElement) => Array.from(element.getContext('2d')!.getImageData(0, 0, 1, 1).data));
  }
  await seek(1.2); await expect.poll(async () => (await color())[0]).toBeGreaterThan(200);
  await seek(1.7); await expect.poll(async () => (await color())[2]).toBeGreaterThan(200);
  await seek(2.2); await expect.poll(async () => (await color())[0]).toBeGreaterThan(200);
  await seek(1.7); await expect.poll(async () => (await color())[2]).toBeGreaterThan(200);
  // Create another visual layer, then move that clip in both time and layer.
  await source.dragTo(page.getByLabel('+ Layer timeline', {exact: true}), {targetPosition: {x: 36, y: 20}});
  const duration = page.getByLabel('Clip duration (s)', {exact: true});
  await duration.fill('2'); await duration.press('Tab');
  const opacity = page.getByLabel('Opacity (%)', {exact: true});
  await opacity.fill('50'); await opacity.press('Tab');
  const redClip = page.locator('[data-video-layer="1"] .timeline-clip');
  await redClip.scrollIntoViewIfNeeded();
  const bounds = await redClip.boundingBox(), target = await page.getByLabel('+ Layer timeline', {exact: true}).boundingBox();
  assert(bounds && target);
  await page.keyboard.down('Alt');
  await page.mouse.move(bounds.x + 20, bounds.y + 20); await page.mouse.down();
  await page.mouse.move(bounds.x + 38, target.y + 20, {steps: 8}); await page.mouse.up();
  await page.keyboard.up('Alt');
  await expect(page.getByLabel('Layer', {exact: true})).toHaveValue('3');
  await expect(page.getByLabel('Clip start (s)', {exact: true})).toHaveValue('1.5');
  await page.getByRole('button', {name: 'Undo', exact: true}).click();
  await expect(page.getByLabel('Layer', {exact: true})).toHaveValue('2');
  await page.getByRole('button', {name: 'Redo', exact: true}).click();
  await expect(page.getByLabel('Layer', {exact: true})).toHaveValue('3');
  await upload.setInputFiles(green);
  await page.getByText('green.mp4 imported.', {exact: false}).waitFor();
  await page.locator('[data-video-layer="1"]').scrollIntoViewIfNeeded();
  await page.locator('.asset').filter({hasText: 'green.mp4'}).dragTo(page.locator('[data-video-layer="1"]'), {sourcePosition: {x: 15, y: 18}, targetPosition: {x: 18, y: 20}});
  await expect(page.getByLabel('Layer', {exact: true})).toHaveValue('2');
  await expect(page.getByLabel('Clip start (s)', {exact: true})).toHaveValue('0.5');
  await opacity.fill('50'); await opacity.press('Tab');
  await seek(1.7);
  const screenshot = path.join(root, 'layers.png');
  async function previewPixel() {
    await page.locator('[data-proof-canvas]').screenshot({path: screenshot});
    return Array.from(ffmpeg(['-i', screenshot, '-vf', 'crop=2:2:4:4', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']).subarray(0, 3));
  }
  const closeColor = (pixel: number[], expected: number[]) => expected.every((value, i) => Math.abs(pixel[i] - value) < 15);
  await expect.poll(async () => closeColor(await previewPixel(), [128, 64, 64])).toBe(true);
  await page.locator('[data-video-layer="2"] .timeline-clip').click();
  const layerField = page.getByLabel('Layer', {exact: true});
  await layerField.fill('1'); await layerField.press('Tab');
  await expect.poll(async () => closeColor(await previewPixel(), [64, 128, 64])).toBe(true);
  await page.getByRole('button', {name: 'Undo', exact: true}).click();
  await page.getByRole('button', {name: 'Save', exact: true}).click();
  await page.getByRole('status').filter({hasText: /^Saved$/}).waitFor();
  const id = await page.getByLabel('Open project', {exact: true}).inputValue();
  const headers = {'x-local-token': api.token};
  const loaded = await page.request.get(`${base}/api/projects/${id}`, {headers}).then(r => r.json());
  const project = loaded.project as Project;
  assert.equal(project.backgrounds.length, 3);
  assert.deepEqual(project.backgrounds.map(c => c.layer), [1, 0, 2]);
  await page.reload();
  await page.getByRole('button', {name: `${project.name} Open`, exact: true}).click();
  await expect(page.locator('.track.video .timeline-clip')).toHaveCount(3);
  await page.locator('[data-video-layer="2"] .timeline-clip').click();
  await expect(opacity).toHaveValue('50');
  await expect(page.getByLabel('Clip start (s)', {exact: true})).toHaveValue('1.5');
  Object.assign(project, {width: 128, height: 128, durationMs: 4000});
  for (const clip of project.backgrounds) clip.durationMs = Math.min(clip.durationMs, project.durationMs - clip.startMs);
  project.audioClips[0].durationMs = 4000;
  assert.equal((await page.request.put(`${base}/api/projects/${id}`, {headers, data: project})).status(), 200);
  const response = await page.request.post(`${base}/api/projects/${id}/export-jobs`, {headers, data: {allowUntimed: false}});
  assert.equal(response.status(), 200, await response.text());
  const job = await response.json();
  await expect.poll(async () => {
    const result = await page.request.get(`${base}/api/jobs/${job.id}`, {headers}).then(r => r.json());
    if (['failed', 'cancelled', 'interrupted'].includes(result.state)) throw new Error(result.error ?? result.state);
    return result.state;
  }, {timeout: 120000}).toBe('succeeded');
  const video = path.join(root, 'result.mp4');
  const exported = await page.request.get(`${base}/api/jobs/${job.id}/result`, {headers});
  assert(exported.ok()); await writeFile(video, await exported.body());
  const pixel = (frame: number) => ffmpeg(['-i', video, '-vf', `select=eq(n\\,${frame}),crop=2:2:0:0`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  assert(closeColor(Array.from(pixel(51).subarray(0, 3)), [128, 64, 64]));
  assert(closeColor(Array.from(pixel(66).subarray(0, 3)), [191, 64, 0]));
  assert.deepEqual(errors, []);
  console.log('Background checks passed: media drops, cross-layer/time dragging, undo/redo, save/reopen, GIF seeking/looping, three-layer preview and MP4 pixels.');
} finally {
  await browser.close(); await web.close(); await api.app.close();
  assert.equal(path.dirname(root), path.resolve(tmpdir())); assert(path.basename(root).startsWith('lyrics-backgrounds-'));
  await rm(root, {recursive: true, force: true});
}
