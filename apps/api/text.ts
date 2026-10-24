import type {FastifyInstance} from 'fastify';
import {createHash, randomUUID} from 'node:crypto';
import {createWriteStream} from 'node:fs';
import {readFile, realpath, rename, unlink} from 'node:fs/promises';
import {pipeline} from 'node:stream/promises';
import path from 'node:path';
import {z} from 'zod';
import {fontSchema, presetSchema, type StylePreset} from '../../packages/project-model/text';
import {atomicJson, HttpError, type Storage} from './storage';
import {chromium} from '@playwright/test';
import {ensureBrowser} from '@remotion/renderer';

export const MAX_FONT_BYTES = 20 * 1024 * 1024;
export function validateFont(bytes: Buffer, extension: string) {
  if (bytes.length < 12 || bytes.length > MAX_FONT_BYTES) throw new HttpError(400, 'Use a valid font smaller than 20 MiB');
  const tag = bytes.toString('ascii', 0, 4);
  if (extension === '.woff' || extension === '.woff2') {
    if (tag !== (extension === '.woff' ? 'wOFF' : 'wOF2') || bytes.length < (extension === '.woff' ? 44 : 48) || bytes.readUInt32BE(8) !== bytes.length)
      throw new HttpError(400, 'Font contents do not match its format');
  } else {
    if (extension === '.otf' ? tag !== 'OTTO' : bytes.readUInt32BE(0) !== 0x00010000 && tag !== 'true') throw new HttpError(400, 'Font contents do not match its format');
    const count = bytes.readUInt16BE(4);
    if (!count || 12 + count * 16 > bytes.length) throw new HttpError(400, 'Invalid font table directory');
    for (let i = 0; i < count; i++) {
      const offset = 12 + i * 16;
      if (bytes.readUInt32BE(offset + 8) + bytes.readUInt32BE(offset + 12) > bytes.length) throw new HttpError(400, 'Invalid font table bounds');
    }
  }
}
async function validateFontFace(bytes: Buffer) {
  const installed = await ensureBrowser();
  if (!('path' in installed)) throw new Error('Install the Remotion browser before importing fonts');
  const browser = await chromium.launch({executablePath: installed.path});
  try {
    const page = await browser.newPage();
    try {await page.evaluate(async encoded => {
      const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
      await Promise.race([new FontFace('import-validation', bytes.buffer).load(), new Promise((_, reject) => setTimeout(() => reject(new Error('Font decode timed out')), 10000))]);
    }, bytes.toString('base64'));}
    catch {throw new HttpError(400, 'Browser could not decode this font. Choose a valid original font file.');}
  } finally {await browser.close();}
}
export function registerTextRoutes(app: FastifyInstance, store: Storage) {
  const identity = z.string().uuid(), presetFile = path.join(store.root, '.presets.json');
  async function presets() {
    try {store.assertInside(await realpath(presetFile)); return z.array(presetSchema).max(200).parse(JSON.parse(await readFile(presetFile, 'utf8')));}
    catch (error) {if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error;}
  }
  app.get('/api/presets', presets);
  app.post<{Params: {id: string}}>('/api/projects/:id/presets', async request => {
    const project = (await store.loadTimeline(identity.parse(request.params.id))).project;
    const preset = presetSchema.omit({id: true, schemaVersion: true, fontHash: true}).parse(request.body);
    const font = project.fonts.find(f => preset.style.font === `font:${f.id}`);
    if (preset.style.font.startsWith('font:') && !font) throw new HttpError(400, 'Import the preset font into this project first');
    const created: StylePreset = {...preset, id: randomUUID(), schemaVersion: 1, fontHash: font?.hash};
    return store.locked('presets', async () => {const current = await presets();
      if (current.length >= 200) throw new HttpError(400, 'Delete an unused preset before adding more');
      await atomicJson(presetFile, [...current, created]); return created;
    });
  });
  app.put<{Params: {id: string}}>('/api/presets/:id', async request => store.locked('presets', async () => {
    const id = identity.parse(request.params.id), {name} = presetSchema.pick({name: true}).parse(request.body), current = await presets();
    const preset = current.find(p => p.id === id); if (!preset) throw new HttpError(404, 'Preset not found');
    preset.name = name; await atomicJson(presetFile, current); return preset;
  }));
  app.delete<{Params: {id: string}}>('/api/presets/:id', async request => store.locked('presets', async () => {
    const id = identity.parse(request.params.id), current = await presets();
    if (!current.some(p => p.id === id)) throw new HttpError(404, 'Preset not found');
    await atomicJson(presetFile, current.filter(p => p.id !== id)); return {deleted: id};
  }));
  app.post<{Params: {id: string}}>('/api/projects/:id/fonts', async request => {
    const id = identity.parse(request.params.id), file = await request.file({limits: {fileSize: MAX_FONT_BYTES}});
    if (!file) throw new HttpError(400, 'Choose a local font');
    const extension = path.extname(file.filename).toLowerCase();
    if (!['.ttf', '.otf', '.woff', '.woff2'].includes(extension)) {file.file.resume(); throw new HttpError(400, 'Use TTF, OTF, WOFF, or WOFF2');}
    const replacement = (request.query as {replace?: string}).replace;
    const previous = replacement ? (await store.loadTimeline(id)).project.fonts.find(f => f.id === identity.parse(replacement)) : undefined;
    if (replacement && !previous) {file.file.resume(); throw new HttpError(404, 'Font to repair is missing');}
    const folder = await store.existingFile(id, 'assets'), fontId = previous?.id ?? randomUUID();
    const temporary = path.join(folder, `${fontId}.${randomUUID()}.upload`), target = path.join(folder, previous?.file ?? `${fontId}${extension}`);
    try {
      await pipeline(file.file, createWriteStream(temporary, {flags: 'wx'}));
      if (file.file.truncated) throw new HttpError(413, 'Font exceeds 20 MiB');
      const bytes = await readFile(temporary); validateFont(bytes, extension);
      const hash = createHash('sha256').update(bytes).digest('hex');
      if (previous && previous.hash !== hash) throw new HttpError(400, 'Font repair requires the identical original');
      await validateFontFace(bytes);
      const attribution = z.string().max(2000).optional().parse((request.query as {attribution?: string}).attribution);
      const font = previous ?? fontSchema.parse({id: fontId, name: path.basename(file.filename), file: path.basename(target), hash, attribution});
      await rename(temporary, target);
      const {project} = await store.loadTimeline(id); if (!previous) project.fonts.push(font);
      return {font, project: await store.saveTimeline(project, true)};
    } catch (error) {
      await unlink(temporary).catch(() => {}); if (!previous) await unlink(target).catch(() => {});
      throw error;
    }
  });
}
