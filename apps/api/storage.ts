import {randomUUID} from 'node:crypto';
import {copyFile, mkdir, readFile, realpath, rename, readdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {newProject, parseProject} from '../../packages/project-model/model';

export class HttpError extends Error {
  constructor(public statusCode: number, message: string) {super(message);}
}
export async function atomicJson(file: string, value: unknown) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), 'utf8');
  await rename(temporary, file);
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
  async create() {
    const project = newProject(randomUUID());
    const folder = path.join(this.root, project.id);
    await mkdir(path.join(folder, 'assets'), {recursive: true});
    await atomicJson(path.join(folder, 'project.json'), project);
    return project;
  }
  async load(id: string) {
    const file = await this.location(id, 'project.json');
    try {return {project: parseProject(JSON.parse(await readFile(file, 'utf8'))), recovered: false};}
    catch (error) {
      // Never replace an unsupported future document with an older backup.
      const raw = await readFile(file, 'utf8').catch(() => '');
      try {if (JSON.parse(raw).schemaVersion > 1) throw new HttpError(409, 'Project needs a newer Lyrics Studio version');}
      catch (versionError) {if (versionError instanceof HttpError) throw versionError;}
      try {return {project: parseProject(JSON.parse(await readFile(`${file}.bak`, 'utf8'))), recovered: true};}
      catch {throw new HttpError(422, 'Project and backup could not be read. Keep the files and restore a backup.');}
    }
  }
  async list() {
    const entries = await readdir(this.root, {withFileTypes: true});
    const projects = await Promise.all(entries.filter(e => e.isDirectory() && !e.isSymbolicLink()).map(async e => {
      try {const {project} = await this.load(e.name); return {id: project.id, name: project.name, revision: project.revision};}
      catch {return null;}
    }));
    return projects.filter(p => p !== null);
  }
  async locked<T>(id: string, action: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(id) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(action);
    this.locks.set(id, current);
    try {return await current;} finally {if (this.locks.get(id) === current) this.locks.delete(id);}
  }
  async save(input: unknown) {
    const next = parseProject(input);
    return this.locked(next.id, async () => {
      const {project: current, recovered} = await this.load(next.id);
      if (next.revision !== current.revision) throw new HttpError(409, 'Project changed on disk. Reopen it before saving; your edits remain in this tab.');
      if (JSON.stringify(next.assets) !== JSON.stringify(current.assets)) throw new HttpError(400, 'Assets can only be changed by media import');
      const file = await this.location(next.id, 'project.json');
      if (!recovered) {
        const temporary = `${file}.bak.${randomUUID()}.tmp`;
        await copyFile(file, temporary); await rename(temporary, `${file}.bak`);
      }
      next.revision++;
      await atomicJson(file, next);
      return next;
    });
  }
}
