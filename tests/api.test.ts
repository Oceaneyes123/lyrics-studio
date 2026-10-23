import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import * as filesystem from 'node:fs/promises';
import {mkdtemp, rm, writeFile, readFile, unlink, readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createApp, runPython} from '../apps/api/app';
import type {TimelineProject as Project} from '../packages/project-model/timeline';
import {audioClips, setLyrics, updateLine} from '../packages/editor-core/timeline-commands';
import {bundle} from '@remotion/bundler';
import {renderMedia, selectComposition} from '@remotion/renderer';

vi.mock('@remotion/bundler', async importOriginal => {
  const actual = await importOriginal<typeof import('@remotion/bundler')>();
  return {...actual, bundle: vi.fn(actual.bundle)};
});
vi.mock('@remotion/renderer', async importOriginal => {
  const actual = await importOriginal<typeof import('@remotion/renderer')>();
  return {...actual, renderMedia: vi.fn(actual.renderMedia), selectComposition: vi.fn(actual.selectComposition)};
});

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {...actual, writeFile: vi.fn(actual.writeFile), rename: vi.fn(actual.rename)};
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
    const p = await create(); p.name = 'New name'; await instance.store.saveTimeline(p);
    await writeFile(path.join(root, p.id, 'project.json'), 'invalid json');
    const recovered = await instance.store.loadTimeline(p.id); expect(recovered.recovered).toBe(true); expect(recovered.project.name).toBe('Untitled lyric video');
    await instance.store.saveTimeline(recovered.project); expect((await instance.store.loadTimeline(p.id)).recovered).toBe(false);
  });
  it('preserves the last valid document if the replacement write fails', async () => {
    const p = await create();
    const original = await readFile(path.join(root, p.id, 'project.json'), 'utf8');
    const failure = vi.mocked(filesystem.writeFile), originalWrite = failure.getMockImplementation()!;
    failure.mockRejectedValueOnce(Object.assign(new Error('No space left'), {code: 'ENOSPC'}));
    try {await expect(instance.store.saveTimeline({...p, name: 'Must not replace'})).rejects.toThrow('No space');}
    finally {failure.mockReset().mockImplementation(originalWrite);}
    expect(await readFile(path.join(root, p.id, 'project.json'), 'utf8')).toBe(original);
    expect((await instance.store.loadTimeline(p.id)).project.name).toBe(p.name);
  });
  it('never recovers an unsupported future schema into an older document', async () => {
    const p = await create(); await instance.store.saveTimeline(p);
    await writeFile(path.join(root, p.id, 'project.json'), JSON.stringify({...p, schemaVersion: 99}));
    await expect(instance.store.loadTimeline(p.id)).rejects.toThrow('newer');
  });
  it('cleans temporary documents after a failed atomic replacement and permits retry', async () => {
    const p = await create();
    const rename = vi.mocked(filesystem.rename), originalRename = rename.getMockImplementation()!;
    rename.mockImplementation(async (from, to) => {
      if (String(to).endsWith('project.json')) throw Object.assign(new Error('No space left'), {code: 'ENOSPC'});
      return originalRename(from, to);
    });
    try {await expect(instance.store.saveTimeline({...p, name: 'Failed'})).rejects.toThrow('No space');}
    finally {rename.mockReset().mockImplementation(originalRename);}
    expect((await readdir(path.join(root, p.id))).filter(file => file.endsWith('.tmp'))).toEqual([]);
    expect((await instance.store.loadTimeline(p.id)).project).toEqual(p);
    expect((await instance.store.saveTimeline({...p, name: 'Retried'})).name).toBe('Retried');
  });
  it('rejects corrupt media without adding assets or leaving partial uploads', async () => {
    const p = await create();
    for (const filename of ['broken.wav', 'broken.mp3', 'broken.mp4', 'broken.png']) {
      expect((await upload(p, filename, Buffer.from('invalid media'))).statusCode).toBe(400);
    }
    expect((await instance.store.loadTimeline(p.id)).project.assets).toEqual([]);
    expect(await readdir(path.join(root, p.id, 'assets'))).toEqual([]);
  });
  it('removes newly imported media if its document cannot be saved', async () => {
    const p = await create();
    const write = vi.mocked(filesystem.writeFile), originalWrite = write.getMockImplementation()!;
    write.mockRejectedValueOnce(Object.assign(new Error('No space left'), {code: 'ENOSPC'}));
    try {expect((await upload(p)).statusCode).toBe(400);}
    finally {write.mockReset().mockImplementation(originalWrite);}
    expect((await instance.store.loadTimeline(p.id)).project).toEqual(p);
    expect(await readdir(path.join(root, p.id, 'assets'))).toEqual([]);
  });
  it('imports actual audio, serves byte ranges, and blocks forged contents', async () => {
    const p = await create(), response = await upload(p); expect(response.statusCode).toBe(200);
    const result = response.json(); expect(audioClips(result.project)).toHaveLength(1); expect(result.asset.durationMs).toBe(1000);
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
    setLyrics(p, 'Line\nLine');
    for (const id of ['line-1', 'line-2']) updateLine(p, id, line => {line.status = 'manual'; line.startMs = 1000; line.durationMs = 1000;});
    expect((await instance.app.inject({method: 'PUT', url: `/api/projects/${p.id}`, headers, payload: p})).statusCode).toBe(400);
  });
  it('requires lyrics/audio before alignment and explicit review acknowledgement for export', async () => {
    const p = await create();
    expect((await instance.app.inject({method: 'POST', url: `/api/projects/${p.id}/alignment-jobs`, headers, payload: {language: 'en'}})).statusCode).toBe(400);
    const imported = (await upload(p)).json().project as Project;
    setLyrics(imported, 'Missing');
    const saved = await instance.store.saveTimeline(imported);
    expect((await instance.app.inject({method: 'POST', url: `/api/projects/${saved.id}/export-jobs`, headers, payload: {allowUntimed: false}})).statusCode).toBe(400);
  });
  it('cleans failed render output, preserves originals, gates downloads, and permits a new export', async () => {
    const p = await create(), imported = (await upload(p)).json();
    const originals = await readFile(await instance.store.existingFile(p.id, 'assets', imported.asset.file));
    const render = vi.mocked(renderMedia), originalRender = render.getMockImplementation()!;
    const bundleMock = vi.mocked(bundle), originalBundle = bundleMock.getMockImplementation()!;
    const select = vi.mocked(selectComposition), originalSelect = select.getMockImplementation()!;
    bundleMock.mockResolvedValue('injected-test-bundle');
    select.mockResolvedValue({} as Awaited<ReturnType<typeof selectComposition>>);
    try {
      for (const message of ['Unsupported decoder', 'No space left']) {
        render.mockImplementationOnce(async options => {
          await writeFile(String(options.outputLocation), 'partial'); throw new Error(message);
        });
        const job = (await instance.app.inject({method: 'POST', url: `/api/projects/${p.id}/export-jobs`, headers, payload: {allowUntimed: false}})).json();
        await expect.poll(() => instance.jobs.get(job.id).state).toBe('failed');
        expect(instance.jobs.get(job.id).error).toBe(message);
        expect((await readdir(path.join(instance.jobs.folder, job.id))).filter(file => file.endsWith('.mp4'))).toEqual([]);
        expect((await instance.app.inject({url: `/api/jobs/${job.id}/result`, headers})).statusCode).toBe(409);
      }
      render.mockImplementationOnce(async options => {
        await writeFile(String(options.outputLocation), 'injected-success');
        return {} as Awaited<ReturnType<typeof renderMedia>>;
      });
      const retried = (await instance.app.inject({method: 'POST', url: `/api/projects/${p.id}/export-jobs`, headers, payload: {allowUntimed: false}})).json();
      await expect.poll(() => instance.jobs.get(retried.id).state).toBe('succeeded');
      expect(await readFile(await instance.store.existingFile(p.id, 'assets', imported.asset.file))).toEqual(originals);
      expect((await instance.store.loadTimeline(p.id)).project).toEqual(imported.project);
    } finally {
      render.mockReset().mockImplementation(originalRender); bundleMock.mockReset().mockImplementation(originalBundle);
      select.mockReset().mockImplementation(originalSelect);
    }
  });
});

it('stops actual Python worker trees on cancellation and timeout', async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 100);
  try {await expect(runPython(['-c', 'import time; time.sleep(10)'], controller.signal)).rejects.toThrow('Cancelled');}
  finally {clearTimeout(timer);}
  await expect(runPython(['-c', 'import time; time.sleep(10)'], new AbortController().signal, 100)).rejects.toThrow('time limit');
});
