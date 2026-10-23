import {expect, it} from 'vitest';
import {mkdtemp, rm, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Jobs} from '../apps/api/jobs';
it('persists a failed worker/render job and runs the next queued job', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'lyrics-failure-'));
  const jobs = new Jobs(directory); await jobs.init();
  try {
    const first = await jobs.start('project', 0, 'export', async () => {throw new Error('Codec failed');});
    const next = await jobs.start('project', 0, 'alignment', async () => ({lines: []}));
    await expect.poll(() => jobs.get(next.id).state).toBe('succeeded');
    await jobs.close();
    expect(jobs.get(first.id).state).toBe('failed');
    expect(jobs.get(next.id).state).toBe('succeeded');
    const restarted = new Jobs(directory); await restarted.init();
    expect(restarted.get(first.id).error).toBe('Codec failed'); await restarted.close();
  } finally {await jobs.close(); await rm(directory, {recursive: true, force: true});}
});
it('serializes heavy jobs, cancels queued work, and persists completion', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'lyrics-jobs-'));
  const jobs = new Jobs(directory); await jobs.init();
  let release!: () => void; const gate = new Promise<void>(resolve => {release = resolve;});
  let secondRan = false;
  const first = await jobs.start('project', 0, 'alignment', async () => {await gate; return {lines: []};});
  const second = await jobs.start('project', 0, 'export', async () => {secondRan = true;});
  await jobs.cancel(second.id); release();
  for (let i = 0; i < 100 && jobs.get(first.id).state !== 'succeeded'; i++) await new Promise(resolve => setTimeout(resolve, 10));
  expect(jobs.get(first.id).state).toBe('succeeded'); expect(secondRan).toBe(false);
  expect(JSON.parse(await readFile(path.join(directory, `${second.id}.json`), 'utf8')).state).toBe('cancelled');
  await jobs.close(); await rm(directory, {recursive: true, force: true});
});
it('marks unfinished persisted jobs interrupted after restart', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'lyrics-restart-'));
  const job = {id: 'previous', projectId: 'project', revision: 0, kind: 'alignment', state: 'running', stage: 'Transcribing', progress: null, createdAt: new Date().toISOString()};
  await writeFile(path.join(directory, 'previous.json'), JSON.stringify(job));
  const jobs = new Jobs(directory);
  try {await jobs.init(); expect(jobs.get('previous').state).toBe('interrupted'); expect(jobs.list('project')).toHaveLength(1);}
  finally {await jobs.close(); await rm(directory, {recursive: true, force: true});}
});
