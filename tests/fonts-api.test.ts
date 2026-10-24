import {afterEach, beforeEach, expect, it} from 'vitest';
import {mkdtemp, readFile, readdir, rm, unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createApp} from '../apps/api/app';
import {MAX_FONT_BYTES, validateFont} from '../apps/api/text';
import type {TimelineProject} from '../packages/project-model/timeline';
import type {StylePreset} from '../packages/project-model/text';

let api: Awaited<ReturnType<typeof createApp>>, root: string;
const headers = {'x-local-token': 'test-token'};
beforeEach(async () => {root = await mkdtemp(path.join(tmpdir(), 'lyrics-font-test-')); api = await createApp({root, token: 'test-token'});});
afterEach(async () => {await api.app.close(); await rm(root, {recursive: true, force: true});});
async function upload(project: TimelineProject, bytes: Buffer, replacement = '', filename = 'custom.woff2') {
  const payload = Buffer.concat([Buffer.from(`--font-boundary\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`), bytes, Buffer.from('\r\n--font-boundary--\r\n')]);
  return api.app.inject({method: 'POST', url: `/api/projects/${project.id}/fonts${replacement ? `?replace=${replacement}` : ''}`,
    headers: {...headers, 'content-type': 'multipart/form-data; boundary=font-boundary'}, payload});
}
it('imports protected fonts, rejects forged metadata and safely repairs identical originals', async () => {
  const project = (await api.app.inject({method: 'POST', url: '/api/projects', headers})).json<TimelineProject>();
  const bytes = await readFile('node_modules/@fontsource/inter/files/inter-latin-600-normal.woff2');
  const imported = await upload(project, bytes); expect(imported.statusCode).toBe(200);
  const next = imported.json<{project: TimelineProject}>().project, font = next.fonts[0], url = `/api/projects/${project.id}/assets/${font.id}`;
  expect((await api.app.inject(url)).statusCode).toBe(403);
  const served = await api.app.inject({url: `${url}?cap=test-token`, headers: {origin: 'http://localhost:9999'}});
  expect(served.statusCode).toBe(200); expect(served.headers['content-type']).toContain('font/woff2'); expect(served.rawPayload).toEqual(bytes);
  const forged = structuredClone(next); forged.fonts[0].hash = '0'.repeat(64);
  expect((await api.app.inject({method: 'PUT', url: `/api/projects/${project.id}`, headers, payload: forged})).statusCode).toBe(400);
  expect((await upload(next, Buffer.from('invalid font'), font.id)).statusCode).toBe(400);
  expect(await readFile(path.join(root, project.id, 'assets', font.file))).toEqual(bytes);
  await unlink(path.join(root, project.id, 'assets', font.file));
  const missing = (await api.app.inject({url: `/api/projects/${project.id}`, headers})).json<{missing: string[]}>(); expect(missing.missing).toContain(font.name);
  expect((await upload(next, bytes, font.id)).statusCode).toBe(200);
  expect(await readdir(path.join(root, project.id, 'assets'))).toEqual([font.file]);
});
it('enforces font byte/format boundaries and leaves no failed uploads', async () => {
  const project = (await api.app.inject({method: 'POST', url: '/api/projects', headers})).json<TimelineProject>();
  expect((await upload(project, Buffer.from('bad'), '', 'font.svg')).statusCode).toBe(400);
  expect((await upload(project, Buffer.alloc(MAX_FONT_BYTES + 1))).statusCode).toBe(413);
  const malformed = Buffer.alloc(48); malformed.write('wOF2'); malformed.writeUInt32BE(48, 8);
  expect((await upload(project, malformed)).statusCode).toBe(400);
  expect(await readdir(path.join(root, project.id, 'assets'))).toEqual([]);
  const font = Buffer.alloc(28); font.writeUInt32BE(0x00010000); font.writeUInt16BE(1, 4); font.writeUInt32BE(100, 20);
  expect(() => validateFont(font, '.ttf')).toThrow('bounds');
});
it('stores versioned presets and keeps project values unchanged on rename or delete', async () => {
  const project = (await api.app.inject({method: 'POST', url: '/api/projects', headers})).json<TimelineProject>();
  const created = (await api.app.inject({method: 'POST', url: `/api/projects/${project.id}/presets`, headers, payload: {name: 'Test', style: project.style}})).json<StylePreset>();
  expect(created.schemaVersion).toBe(1);
  expect((await api.app.inject({method: 'PUT', url: `/api/presets/${created.id}`, headers, payload: {name: 'Renamed'}})).json<StylePreset>().name).toBe('Renamed');
  expect((await api.app.inject({url: '/api/presets', headers})).json<StylePreset[]>()[0].name).toBe('Renamed');
  expect((await api.app.inject({method: 'DELETE', url: `/api/presets/${created.id}`, headers})).statusCode).toBe(200);
  expect((await api.store.loadTimeline(project.id)).project.style).toEqual(project.style);
});
