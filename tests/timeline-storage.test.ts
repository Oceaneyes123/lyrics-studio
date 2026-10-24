import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import fixtures from './fixtures/v1-projects.json';
import {Storage} from '../apps/api/storage';
import {parseProject} from '../packages/project-model/model';
import {migrateTimeline} from '../packages/project-model/timeline';

vi.mock('node:fs/promises', async original => {
  const actual = await original<typeof fs>(); return {...actual, writeFile: vi.fn(actual.writeFile)};
});
let store: Storage, root: string, file: string, original: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(tmpdir(), 'lyrics-v2-storage-')); store = new Storage(root); await store.init();
  const p = parseProject(fixtures[2]);
  await fs.mkdir(path.join(root, p.id, 'assets'), {recursive: true});
  file = path.join(root, p.id, 'project.json'); original = JSON.stringify(p);
  await fs.writeFile(file, original);
});
afterEach(async () => {await fs.rm(root, {recursive: true, force: true});});
it('migrates reads in memory and saves a byte-identical permanent V1 backup only once', async () => {
  const loaded = await store.loadTimeline(fixtures[2].id);
  expect(loaded.project.schemaVersion).toBe(4); expect(loaded.project.revision).toBe(8);
  expect(await fs.readFile(file, 'utf8')).toBe(original);
  expect(await fs.readdir(path.dirname(file))).toEqual(['assets', 'project.json']);
  const saved = await store.saveTimeline(loaded.project);
  expect(saved.revision).toBe(9); expect(await fs.readFile(`${file}.v1.bak`, 'utf8')).toBe(original);
  await store.saveTimeline({...saved, name: 'Another edit'});
  expect(await fs.readFile(`${file}.v1.bak`, 'utf8')).toBe(original);
  expect((await store.loadTimeline(fixtures[2].id)).project.name).toBe('Another edit');
});
it('preserves V1 and its backup when the first V3 replacement fails, then permits retry', async () => {
  const loaded = await store.loadTimeline(fixtures[2].id), write = vi.mocked(fs.writeFile), implementation = write.getMockImplementation()!;
  write.mockRejectedValueOnce(Object.assign(new Error('Disk full'), {code: 'ENOSPC'}));
  try {await expect(store.saveTimeline(loaded.project)).rejects.toThrow('Disk full');}
  finally {write.mockReset().mockImplementation(implementation);}
  expect(await fs.readFile(file, 'utf8')).toBe(original);
  expect(await fs.readFile(`${file}.v1.bak`, 'utf8')).toBe(original);
  expect((await fs.readdir(path.dirname(file))).filter(name => name.endsWith('.tmp'))).toEqual([]);
  expect((await store.saveTimeline(loaded.project)).revision).toBe(9);
});
it('recovers V1 and V2 backups but never downgrades future main documents', async () => {
  await store.saveTimeline((await store.loadTimeline(fixtures[2].id)).project);
  await fs.writeFile(file, '{broken');
  const recoveredV1 = await store.loadTimeline(fixtures[2].id); expect(recoveredV1.recovered).toBe(true);
  expect(recoveredV1.project.revision).toBe(8);
  const repaired = await store.saveTimeline(recoveredV1.project); await store.saveTimeline(repaired);
  await fs.writeFile(file, '{broken');
  expect((await store.loadTimeline(fixtures[2].id)).project.revision).toBe(9);
  await fs.writeFile(file, JSON.stringify({...repaired, schemaVersion: 999}));
  await expect(store.loadTimeline(fixtures[2].id)).rejects.toThrow('newer');
});
it('rejects stale migrated saves and forged assets without modifying disk', async () => {
  const loaded = (await store.loadTimeline(fixtures[2].id)).project;
  await store.saveTimeline(loaded);
  await expect(store.saveTimeline(loaded)).rejects.toThrow('changed on disk');
  const current = (await store.loadTimeline(fixtures[2].id)).project;
  current.assets[0].hash = 'd'.repeat(64);
  await expect(store.saveTimeline(current)).rejects.toThrow('media import');
  expect((await store.loadTimeline(fixtures[2].id)).project.assets[0].hash).toBe('a'.repeat(64));
});
it('reads V2 without rewriting and preserves its exact bytes on the first V3 save and retry', async () => {
  const v2 = {...migrateTimeline(fixtures[2]), schemaVersion: 2};
  const bytes = JSON.stringify(v2, null, 4); await fs.writeFile(file, bytes);
  const read = await store.loadTimeline(v2.id); expect(read.project.schemaVersion).toBe(4);
  expect(await fs.readFile(file, 'utf8')).toBe(bytes);
  const write = vi.mocked(fs.writeFile), implementation = write.getMockImplementation()!;
  write.mockRejectedValueOnce(Object.assign(new Error('Disk full'), {code: 'ENOSPC'}));
  try {await expect(store.saveTimeline(read.project)).rejects.toThrow('Disk full');}
  finally {write.mockReset().mockImplementation(implementation);}
  expect(await fs.readFile(file, 'utf8')).toBe(bytes); expect(await fs.readFile(`${file}.v2.bak`, 'utf8')).toBe(bytes);
  const saved = await store.saveTimeline(read.project); await store.saveTimeline({...saved, name: 'V3 edit'});
  expect(await fs.readFile(`${file}.v2.bak`, 'utf8')).toBe(bytes);
  await fs.writeFile(file, '{broken'); expect((await store.loadTimeline(v2.id)).project.schemaVersion).toBe(4);
  await fs.writeFile(file, JSON.stringify({...saved, schemaVersion: 5}));
  await expect(store.loadTimeline(v2.id)).rejects.toThrow('newer');
});
it('recovers an ordinary V2 backup in memory without changing its bytes', async () => {
  const v2 = {...migrateTimeline(fixtures[2]), schemaVersion: 2}, bytes = JSON.stringify(v2);
  await fs.writeFile(`${file}.bak`, bytes); await fs.writeFile(file, '{broken');
  const recovered = await store.loadTimeline(v2.id); expect(recovered.recovered).toBe(true); expect(recovered.project.schemaVersion).toBe(4);
  expect(await fs.readFile(`${file}.bak`, 'utf8')).toBe(bytes); expect(await fs.readFile(file, 'utf8')).toBe('{broken');
});

it('preserves exact V3 bytes before saving canvas transforms in V4', async () => {
  const v3 = {...migrateTimeline(fixtures[2]), schemaVersion: 3}, bytes = JSON.stringify(v3, null, 2);
  await fs.writeFile(file, bytes);
  const loaded = (await store.loadTimeline(v3.id)).project;
  const clip = loaded.clips.find(c => c.kind === 'visual')!;
  clip.transform = {x: 40, y: 70, width: 400, height: 200, rotation: 25, scaleX: 1, scaleY: 1,
    anchorX: .5, anchorY: .5, opacity: .6, flipX: false, flipY: true, fit: 'contain'};
  await store.saveTimeline(loaded);
  expect(await fs.readFile(`${file}.v3.bak`, 'utf8')).toBe(bytes);
  const reopened = (await store.loadTimeline(v3.id)).project;
  expect(reopened.schemaVersion).toBe(4); expect(reopened.clips.find(c => c.id === clip.id)?.transform).toEqual(clip.transform);
});
