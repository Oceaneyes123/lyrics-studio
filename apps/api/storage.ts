import {randomUUID} from 'node:crypto';
import {copyFile, mkdir, readFile, realpath, rename, readdir, writeFile, unlink, stat} from 'node:fs/promises';
import path from 'node:path';
import {newProject} from '../../packages/project-model/model';
import {migrateTimeline, parseTimeline} from '../../packages/project-model/timeline';

export class HttpError extends Error {
  constructor(public statusCode: number, message: string) {super(message);}
}
export async function atomicJson(file: string, value: unknown) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2), 'utf8');
    await rename(temporary, file);
  } finally {await unlink(temporary).catch(() => {});}
}
export class Storage {
  private locks = new Map<string, Promise<unknown>>();
  constructor(public root: string) {}
  async init() {await mkdir(this.root, {recursive: true}); this.root = await realpath(this.root);}
  async location(id: string, ...parts: string[]) {
    if (!/^[a-f\d-]{36}$/.test(id)) throw new HttpError(400, 'Invalid project ID');
    const folder = await realpath(path.join(this.root, id)).catch(() => {throw new HttpError(404, 'Project not found');});
    this.assertInside(folder);
    return path.join(folder, ...parts);
  }
  assertInside(file: string) {
    const relative = path.relative(this.root, file);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new HttpError(403, 'Path outside project storage');
  }
  async existingFile(id: string, ...parts: string[]) {
    const file = await realpath(await this.location(id, ...parts)).catch(() => {throw new HttpError(404, 'Media file is missing; reimport it');});
    this.assertInside(file); return file;
  }
  async createTimeline() {
    const project = migrateTimeline(newProject(randomUUID()));
    const folder = path.join(this.root, project.id);
    await mkdir(path.join(folder, 'assets'), {recursive: true});
    await atomicJson(path.join(folder, 'project.json'), project);
    return project;
  }
  async listTimeline() {
    const entries = await readdir(this.root, {withFileTypes: true});
    const result = [];
    for (const entry of entries.filter(entry => entry.isDirectory() && !entry.isSymbolicLink())) {
      try {const {project} = await this.loadTimeline(entry.name); result.push({id: project.id, name: project.name, revision: project.revision});}
      catch { /* Keep corrupt projects on disk for recovery. */ }
    }
    return result;
  }
  async loadTimeline(id: string) {
    const file = await this.location(id, 'project.json');
    const raw = await readFile(file, 'utf8').catch(() => '');
    let value: unknown;
    try {value = JSON.parse(raw);} catch { /* Try the last-good backup below. */ }
    if (typeof (value as {schemaVersion?: unknown})?.schemaVersion === 'number' && (value as {schemaVersion: number}).schemaVersion > 2)
      throw new HttpError(409, 'Project needs a newer Lyrics Studio version');
    try {return {project: migrateTimeline(value), recovered: false};}
    catch {
      try {return {project: migrateTimeline(JSON.parse(await readFile(`${file}.bak`, 'utf8'))), recovered: true};}
      catch {throw new HttpError(422, 'Project and backup could not be read. Keep the files and restore a backup.');}
    }
  }
  async saveTimeline(input: unknown, importingAssets = false) {
    const next = parseTimeline(input);
    return this.locked(next.id, async () => {
      const {project: current, recovered} = await this.loadTimeline(next.id);
      if (next.revision !== current.revision) throw new HttpError(409, 'Project changed on disk. Reopen it before saving; your edits remain in this tab.');
      if (!importingAssets && JSON.stringify(next.assets) !== JSON.stringify(current.assets)) throw new HttpError(400, 'Assets can only be changed by media import');
      const file = await this.location(next.id, 'project.json');
      const source = recovered ? `${file}.bak` : file;
      const original = JSON.parse(await readFile(source, 'utf8'));
      if (original.schemaVersion === 1) {
        const preserved = `${file}.v1.bak`;
        const existing = await stat(preserved).catch(error => {if (error.code !== 'ENOENT') throw error; return null;});
        if (!existing) await this.copyDocument(source, preserved);
      }
      if (!recovered) await this.copyDocument(file, `${file}.bak`);
      next.revision++;
      await atomicJson(file, next);
      return next;
    });
  }
  private async copyDocument(source: string, target: string) {
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {await copyFile(source, temporary); await rename(temporary, target);}
    finally {await unlink(temporary).catch(() => {});}
  }
  async locked<T>(id: string, action: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(id) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(action);
    this.locks.set(id, current);
    try {return await current;} finally {if (this.locks.get(id) === current) this.locks.delete(id);}
  }
}
