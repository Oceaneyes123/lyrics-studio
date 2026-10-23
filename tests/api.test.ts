import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import * as filesystem from 'node:fs/promises';
import {mkdtemp, rm, writeFile, readFile, unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createApp, runPython} from '../apps/api/app';
import type {Project} from '../packages/project-model/model';

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {...actual, writeFile: vi.fn(actual.writeFile)};
});

function wav() {
  const data = Buffer.alloc(32044); data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22); data.writeUInt32LE(16000, 24);
  data.writeUInt32LE(32000, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(32000, 40);
  return data;
}
describe('Local API, persistence, and media trust boundary', () => {
  let instance: Awaited<ReturnType<typeof createApp>>, root: string;
  const headers = {'x-local-token': 'test-token'};
  beforeEach(async () => {root = await mkdtemp(path.join(tmpdir(), 'lyrics-api-')); instance = await createApp({root, token: 'test-token'});});
  afterEach(async () => {await instance.app.close(); await rm(root, {recursive: true, force: true});});
  const create = async () => (await instance.app.inject({method: 'POST', url: '/api/projects', headers})).json<Project>();
  async function upload(project: Project, name = 'song.wav', contents = wav(), replace = '') {
    const payload = Buffer.concat([Buffer.from(`--test-boundary\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`), contents, Buffer.from('\r\n--test-boundary--\r\n')]);
    return instance.app.inject({method: 'POST', url: `/api/projects/${project.id}/assets${replace ? `?replace=${replace}` : ''}`, headers: {...headers, 'content-type': 'multipart/form-data; boundary=test-boundary'}, payload});
  }
  it('rejects missing capabilities and foreign origins', async () => {
    expect((await instance.app.inject('/api/projects')).statusCode).toBe(403);
    expect((await instance.app.inject({url: '/api/session', headers: {origin: 'https://untrusted.example'}})).statusCode).toBe(403);
    expect((await instance.app.inject({method: 'POST', url: '/api/projects?cap=test-token'})).statusCode).toBe(403);
  });
  it('round trips a project and rejects stale/concurrent saves', async () => {
    const p = await create(); p.name = 'Saved song';
    const responses = await Promise.all([0, 1].map(() => instance.app.inject({method: 'PUT', url: `/api/projects/${p.id}`, headers, payload: p})));
    expect(responses.map(r => r.statusCode).sort()).toEqual([200, 409]);
    const loaded = (await instance.app.inject({url: `/api/projects/${p.id}`, headers})).json();
    expect(loaded.project.name).toBe('Saved song'); expect(loaded.project.revision).toBe(1);
  });
  it('recovers a corrupt main document from the last-good backup', async () => {
    const p = await create(); p.name = 'New name'; await instance.store.save(p);
    await writeFile(path.join(root, p.id, 'project.json'), 'invalid json');
    const recovered = await instance.store.load(p.id); expect(recovered.recovered).toBe(true); expect(recovered.project.name).toBe('Untitled lyric video');
    await instance.store.save(recovered.project); expect((await instance.store.load(p.id)).recovered).toBe(false);
  });
  it('preserves the last valid document if the replacement write fails', async () => {
    const p = await create();
    const original = await readFile(path.join(root, p.id, 'project.json'), 'utf8');
    const failure = vi.mocked(filesystem.writeFile), originalWrite = failure.getMockImplementation()!;
    failure.mockRejectedValueOnce(Object.assign(new Error('No space left'), {code: 'ENOSPC'}));
    try {await expect(instance.store.save({...p, name: 'Must not replace'})).rejects.toThrow('No space');}
    finally {failure.mockReset().mockImplementation(originalWrite);}
    expect(await readFile(path.join(root, p.id, 'project.json'), 'utf8')).toBe(original);
    expect((await instance.store.load(p.id)).project.name).toBe(p.name);
  });
  it('never recovers an unsupported future schema into an older document', async () => {
    const p = await create(); await instance.store.save(p);
    await writeFile(path.join(root, p.id, 'project.json'), JSON.stringify({...p, schemaVersion: 99}));
    await expect(instance.store.load(p.id)).rejects.toThrow('newer');
  });
  it('imports actual audio, serves byte ranges, and blocks forged contents', async () => {
    const p = await create(), response = await upload(p); expect(response.statusCode).toBe(200);
    const result = response.json(); expect(result.project.audioClips).toHaveLength(1); expect(result.asset.durationMs).toBe(1000);
    const route = `/api/projects/${p.id}/assets/${result.asset.id}?cap=test-token`;
    const range = await instance.app.inject({url: route, headers: {range: 'bytes=0-3'}});
    expect(range.statusCode).toBe(206); expect(range.body).toBe('RIFF');
    expect((await instance.app.inject({url: route, headers: {range: 'bytes=999999-'}})).statusCode).toBe(416);
    expect((await upload(p, 'fake.mp3')).statusCode).toBe(400);
    expect((await upload(p, 'file.exe')).statusCode).toBe(400);
  });
  it('rejects forged asset metadata on project saves', async () => {
    const p = await create(); const imported = (await upload(p)).json().project as Project;
    imported.assets[0].file = '11111111-1111-4111-8111-111111111111.wav';
    expect((await instance.app.inject({method: 'PUT', url: `/api/projects/${p.id}`, headers, payload: imported})).statusCode).toBe(400);
  });
  it('imports and serves GIF images while rejecting forged GIF contents', async () => {
    const p = await create();
    const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
    const response = await upload(p, 'background.GIF', gif);
    expect(response.statusCode).toBe(200);
    const {asset, project} = response.json();
    expect(asset.kind).toBe('image'); expect(asset.file).toMatch(/\.gif$/);
    expect(project.assets).toHaveLength(1);
    const served = await instance.app.inject({url: `/api/projects/${p.id}/assets/${asset.id}?cap=test-token`});
    expect(served.headers['content-type']).toBe('image/gif'); expect(served.rawPayload).toEqual(gif);
    const route = `/api/projects/${p.id}/assets/${asset.id}`;
    const renderer = await instance.app.inject({url: `${route}?cap=test-token`, headers: {origin: 'http://localhost:3000'}});
    expect(renderer.statusCode).toBe(200); expect(renderer.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect((await instance.app.inject({url: route, headers: {origin: 'http://localhost:3000'}})).statusCode).toBe(403);
    expect((await instance.app.inject({url: `${route}?cap=test-token`, headers: {origin: 'https://untrusted.example'}})).statusCode).toBe(403);
    expect((await upload(p, 'forged.gif')).statusCode).toBe(400);
  });
  it('repairs missing originals without duplicating assets and rejects different data without deleting the original', async () => {
    const p = await create(), imported = (await upload(p)).json();
    const file = await instance.store.existingFile(p.id, 'assets', imported.asset.file);
    const changed = wav(); changed[50] = 100;
    expect((await upload(p, 'song.wav', changed, imported.asset.id)).statusCode).toBe(400);
    expect(await readFile(file)).toEqual(wav());
    await unlink(file);
    const repaired = await upload(p, 'song.wav', wav(), imported.asset.id);
    expect(repaired.statusCode).toBe(200); expect(repaired.json().project.assets).toHaveLength(1);
    expect(await readFile(file)).toEqual(wav());
  });
  it('returns client validation errors for conflicting lyric intervals', async () => {
    const p = await create();
    p.lines = [0, 1].map(i => ({id: String(i), text: 'Line', status: 'manual', startMs: 1000, durationMs: 1000, words: []}));
    expect((await instance.app.inject({method: 'PUT', url: `/api/projects/${p.id}`, headers, payload: p})).statusCode).toBe(400);
  });
  it('requires lyrics/audio before alignment and explicit review acknowledgement for export', async () => {
    const p = await create();
    expect((await instance.app.inject({method: 'POST', url: `/api/projects/${p.id}/alignment-jobs`, headers, payload: {language: 'en'}})).statusCode).toBe(400);
    const imported = (await upload(p)).json().project as Project;
    imported.lines = [{id: 'untimed', text: 'Missing', startMs: null, durationMs: null, words: [], status: 'unmatched'}];
    const saved = await instance.store.save(imported);
    expect((await instance.app.inject({method: 'POST', url: `/api/projects/${saved.id}/export-jobs`, headers, payload: {allowUntimed: false}})).statusCode).toBe(400);
  });
});

it('stops actual Python worker trees on cancellation and timeout', async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 100);
  try {await expect(runPython(['-c', 'import time; time.sleep(10)'], controller.signal)).rejects.toThrow('Cancelled');}
  finally {clearTimeout(timer);}
  await expect(runPython(['-c', 'import time; time.sleep(10)'], new AbortController().signal, 100)).rejects.toThrow('time limit');
});
