import {randomUUID} from 'node:crypto';
import {mkdir, readFile, readdir} from 'node:fs/promises';
import path from 'node:path';
import {atomicJson, HttpError} from './storage';

export type Job = {id: string; projectId: string; revision: number; kind: 'alignment' | 'export';
  state: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';
  stage: string; progress: number | null; error?: string; createdAt: string; result?: unknown};
export class Jobs {
  private values = new Map<string, Job>();
  private cancellations = new Map<string, AbortController>();
  private queue = Promise.resolve();
  private writes = new Map<string, Promise<void>>();
  constructor(public folder: string) {}
  async init() {
    await mkdir(this.folder, {recursive: true});
    for (const entry of await readdir(this.folder)) {
      if (!entry.endsWith('.json')) continue;
      try {
        const job: Job = JSON.parse(await readFile(path.join(this.folder, entry), 'utf8'));
        if (job.state === 'running' || job.state === 'queued') {job.state = 'interrupted'; job.stage = 'Interrupted. Start a new job to retry.';}
        this.values.set(job.id, job); await this.persist(job);
      } catch { /* Ignore incomplete job metadata; project documents remain independent. */ }
    }
  }
  async persist(job: Job) {
    const previous = this.writes.get(job.id) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(() => atomicJson(path.join(this.folder, `${job.id}.json`), job));
    this.writes.set(job.id, next);
    try {await next;} finally {if (this.writes.get(job.id) === next) this.writes.delete(job.id);}
  }
  list(projectId: string) {return [...this.values.values()].filter(j => j.projectId === projectId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));}
  get(id: string) {const job = this.values.get(id); if (!job) throw new HttpError(404, 'Job not found'); return job;}
  async start(projectId: string, revision: number, kind: Job['kind'],
    work: (job: Job, signal: AbortSignal, update: (stage: string, progress?: number) => Promise<void>) => Promise<unknown>) {
    const job: Job = {id: randomUUID(), projectId, revision, kind, state: 'queued', stage: 'Waiting', progress: null, createdAt: new Date().toISOString()};
    const controller = new AbortController(); this.cancellations.set(job.id, controller);
    this.values.set(job.id, job); await this.persist(job);
    this.queue = this.queue.then(async () => {
      if (controller.signal.aborted) return;
      job.state = 'running'; job.stage = 'Starting'; await this.persist(job);
      try {
        const result = await work(job, controller.signal, async (stage, progress) => {
          if (controller.signal.aborted) return;
          job.stage = stage; job.progress = progress ?? null; await this.persist(job);
        });
        if (!controller.signal.aborted) {job.result = result; job.state = 'succeeded'; job.stage = 'Ready'; job.progress = 1;}
      } catch (error) {
        if (!controller.signal.aborted) {job.state = 'failed'; job.stage = 'Failed'; job.error = error instanceof Error ? error.message : 'Job failed';}
      } finally {this.cancellations.delete(job.id); await this.persist(job);}
    }).catch(async () => {job.state = 'failed'; job.error = 'Could not persist job state';});
    return {...job};
  }
  async cancel(id: string) {
    const job = this.get(id);
    if (job.state !== 'running' && job.state !== 'queued') return job;
    this.cancellations.get(id)?.abort(); this.cancellations.delete(id); job.state = 'cancelled'; job.stage = 'Cancelled';
    await this.persist(job); return job;
  }
  async close() {for (const id of this.cancellations.keys()) await this.cancel(id); await this.queue;}
}
