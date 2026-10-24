import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {chromium, expect} from '@playwright/test';
import {ensureBrowser} from '@remotion/renderer';
import {createServer} from 'vite';
import {createApp} from '../apps/api/app';
import {audioClips, lines, setLyrics} from '../packages/editor-core/timeline-commands';
import {lyricLines} from '../packages/project-model/model';
import type {TimelineProject} from '../packages/project-model/timeline';
import type {Job} from '../apps/api/jobs';

const root = await mkdtemp(path.join(tmpdir(), 'lyrics-sync-browser-')), base = 'http://127.0.0.1:5174';
const api = await createApp({root, mediaOrigin: base});
const web = await createServer({server: {port: 5174, strictPort: true, proxy: {'/api': 'http://127.0.0.1:3002'}}});
const installed = await ensureBrowser(); assert('path' in installed);
const browser = await chromium.launch({executablePath: installed.path});
async function request<T>(route: string, data?: unknown, method = 'POST'): Promise<T> {
  const response = await fetch(`${base}/api${route}`, {method, headers: {'x-local-token': api.token,
    ...(data instanceof FormData || data === undefined ? {} : {'Content-Type': 'application/json'})},
    body: data instanceof FormData ? data : data === undefined ? undefined : JSON.stringify(data)});
  if (!response.ok) throw new Error(await response.text()); return response.json() as Promise<T>;
}
async function finish(job: Job) {
  let current = job;
  await expect.poll(async () => {current = await request<Job>(`/jobs/${job.id}`, undefined, 'GET');
    if (['failed', 'cancelled', 'interrupted'].includes(current.state)) throw new Error(current.error ?? current.state);
    return current.state;
  }, {timeout: 180000}).toBe('succeeded'); return current;
}
try {
  await api.app.listen({host: '127.0.0.1', port: 3002}); await web.listen();
  let project = await request<TimelineProject>('/projects');
  for (const name of ['song.wav', 'music.wav']) {
    const data = new FormData(); data.set('file', new Blob([await readFile('music/test.wav')]), name);
    project = (await request<{project: TimelineProject}>(`/projects/${project.id}/assets`, data)).project;
  }
  setLyrics(project, lyricLines(await readFile('music/lyrics.txt', 'utf8')).slice(0, 2).map(l => l.text).join('\n'));
  project.name = 'Synchronization verification'; project.width = project.height = 128; audioClips(project)[1].muted = true;
  project = await request(`/projects/${project.id}`, project, 'PUT');
  const page = await browser.newPage({viewport: {width: 1560, height: 1200}}), errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.goto(base); await page.getByRole('button', {name: `${project.name} Open`, exact: true}).click();
  await page.locator('.lyric-row').first().click(); await page.getByRole('button', {name: 'Arm tap timing', exact: true}).click();
  const seek = async (seconds: number) => {await page.locator('.ruler').click({position: {x: seconds * 36, y: 10}});};
  await seek(2); await page.keyboard.press('t'); await seek(5); await page.getByRole('button', {name: 'Tap line start (T)', exact: true}).click();
  await page.getByRole('button', {name: 'Undo last tap', exact: true}).click(); await page.getByRole('button', {name: 'Tap line start (T)', exact: true}).click();
  await seek(8); await page.getByRole('button', {name: 'Finish at playhead', exact: true}).click();
  await page.getByRole('button', {name: 'Apply tap timing', exact: true}).click();
  await expect(page.getByLabel('Line start (s)', {exact: true})).toHaveValue('2');
  await page.getByRole('button', {name: 'Undo', exact: true}).click(); await expect(page.getByRole('button', {name: 'Place at playhead', exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Redo', exact: true}).click();
  await page.getByRole('button', {name: 'Space words evenly', exact: true}).click();
  await page.getByLabel('Playback speed', {exact: true}).selectOption('0.5'); await page.getByLabel('Loop selected line', {exact: true}).check();
  await page.getByRole('button', {name: 'Play / pause', exact: true}).click();
  await page.waitForFunction(() => Number(document.querySelector('[data-proof-frame]')?.getAttribute('data-proof-frame')) >= 145);
  await page.waitForFunction(() => Number(document.querySelector('[data-proof-frame]')?.getAttribute('data-proof-frame')) < 80);
  await page.getByRole('button', {name: 'Play / pause', exact: true}).click(); await page.getByLabel('Loop selected line', {exact: true}).uncheck();
  const boundary = page.getByRole('button', {name: 'Word 1 end boundary', exact: true}); await boundary.scrollIntoViewIfNeeded();
  const box = await boundary.boundingBox(); assert(box);
  const before = Number(await page.getByLabel('Word 1 end (s)', {exact: true}).inputValue());
  await page.mouse.move(box.x + box.width / 2, box.y + 15); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 - 8, box.y + 15, {steps: 5}); await page.mouse.up();
  await expect.poll(async () => Number(await page.getByLabel('Word 1 end (s)', {exact: true}).inputValue())).toBeLessThan(before);
  await boundary.focus(); await page.keyboard.press('ArrowLeft');
  const corrected = Number(await page.getByLabel('Word 1 end (s)', {exact: true}).inputValue());
  await page.getByRole('button', {name: 'Align to song', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Apply matches', exact: true})).toBeVisible({timeout: 180000});
  await page.getByRole('button', {name: 'Apply matches', exact: true}).click();
  await expect(page.getByLabel('Word 1 end (s)', {exact: true})).toHaveValue(String(corrected));
  await page.getByRole('button', {name: 'Mark reviewed', exact: true}).click();
  await page.getByRole('button', {name: 'Save', exact: true}).click(); await page.getByRole('status').filter({hasText: /^Saved$/}).waitFor();
  await page.reload(); await page.getByRole('button', {name: `${project.name} Open`, exact: true}).click(); await page.locator('.lyric-row').first().click();
  await expect(page.getByLabel('Word 1 end (s)', {exact: true})).toHaveValue(String(corrected));
  project = (await request<{project: TimelineProject}>(`/projects/${project.id}`, undefined, 'GET')).project;
  assert.equal(lines(project)[0].words[0].manualEnd, true); assert.equal(audioClips(project).length, 2);
  project.durationMs = 10000; audioClips(project).forEach(c => {c.durationMs = 10000;});
  project = await request(`/projects/${project.id}`, project, 'PUT');
  const job = await finish(await request<Job>(`/projects/${project.id}/export-jobs`, {allowUntimed: false}));
  const result = await fetch(`${base}/api/jobs/${job.id}/result`, {headers: {'x-local-token': api.token}}); assert(result.ok);
  await mkdir('artifacts/advanced/sync', {recursive: true}); await writeFile('artifacts/advanced/sync/video.mp4', Buffer.from(await result.arrayBuffer()));
  assert.deepEqual(errors, []); await writeFile('artifacts/advanced/sync/report.json', JSON.stringify({correctedEndSeconds: corrected, errors, frames: job.result}, null, 2));
  console.log('Synchronization passed: multi-audio, armed taps, atomic undo, slow loop, pointer/keyboard word edits, real alignment rerun, save/reopen and export.');
} finally {
  await browser.close(); await web.close(); await api.app.close();
  assert.equal(path.dirname(root), path.resolve(tmpdir())); assert(path.basename(root).startsWith('lyrics-sync-browser-'));
  await rm(root, {recursive: true, force: true});
}
