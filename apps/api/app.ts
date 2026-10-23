import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import {createHash, randomBytes, randomUUID, timingSafeEqual} from 'node:crypto';
import {createReadStream, createWriteStream} from 'node:fs';
import {mkdir, readFile, rename, stat, unlink, writeFile} from 'node:fs/promises';
import {pipeline} from 'node:stream/promises';
import {execFile, spawn} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {z} from 'zod';
import {bundle} from '@remotion/bundler';
import {makeCancelSignal, renderMedia, selectComposition} from '@remotion/renderer';
import {parseProject, clipSchema, type Asset, type Project} from '../../packages/project-model/model';
import {parseProofProject} from '../../packages/project-model/proof';
import {durationFrames} from '../../packages/project-model/proof';
import {atomicJson, HttpError, Storage} from './storage';
import {Jobs} from './jobs';

const execute = promisify(execFile);
const identity = z.string().uuid();
const MAX_UPLOAD = 500 * 1024 * 1024;
const mime: Record<string, string> = {'.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif'};

export function runPython(args: string[], signal: AbortSignal, timeoutMs = 30 * 60 * 1000): Promise<void> {
  return new Promise((resolve, reject) => {
    const executable = path.resolve(process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');
    const child = spawn(executable, ['-X', 'utf8', ...args], {windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
    let diagnostic = '', timedOut = false;
    child.stdout.resume();
    child.stderr.on('data', data => {diagnostic = (diagnostic + data.toString()).slice(-2000);});
    const cancel = () => {
      if (process.platform === 'win32' && child.pid) execFile('taskkill', ['/pid', String(child.pid), '/t', '/f'], {windowsHide: true}, () => {});
      else child.kill('SIGTERM');
    };
    signal.addEventListener('abort', cancel, {once: true});
    const timeout = setTimeout(() => {timedOut = true; cancel();}, timeoutMs);
    if (signal.aborted) cancel();
    child.once('error', error => {clearTimeout(timeout); signal.removeEventListener('abort', cancel); reject(error);});
    child.once('close', code => {
      signal.removeEventListener('abort', cancel);
      clearTimeout(timeout);
      if (code === 0 && !signal.aborted) resolve();
      else reject(new Error(signal.aborted ? 'Cancelled' : timedOut ? 'Alignment exceeded its 30-minute time limit. Try shorter audio.' : `Alignment failed. ${diagnostic.trim() || 'Check the local Python environment.'}`));
    });
  });
}

export async function createApp(options: {root?: string; token?: string; mediaOrigin?: string} = {}) {
  const app = Fastify({bodyLimit: 5 * 1024 * 1024, logger: false});
  await app.register(multipart, {limits: {fileSize: MAX_UPLOAD, files: 1, fields: 0}});
  const token = options.token ?? randomBytes(32).toString('hex');
  const store = new Storage(path.resolve(options.root ?? 'storage/projects')); await store.init();
  const jobs = new Jobs(path.join(store.root, '.jobs')); await jobs.init();
  const mediaOrigin = options.mediaOrigin ?? 'http://127.0.0.1:3001';
  let bundlePromise: Promise<string> | undefined;
  app.setErrorHandler((error, _request, reply) => {
    const status = error instanceof HttpError ? error.statusCode : error instanceof z.ZodError ? 400 :
      typeof (error as {statusCode?: number}).statusCode === 'number' ? (error as {statusCode: number}).statusCode : 500;
    reply.code(status).send({error: status >= 500 ? 'Local operation failed. Check available disk space and runtime prerequisites.' : error instanceof Error ? error.message : 'Request failed'});
  });
  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    const assetRead = request.method === 'GET' && request.routeOptions.url === '/api/projects/:id/assets/:assetId';
    const rendererOrigin = assetRead && origin && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);
    if (origin && !rendererOrigin && !['http://127.0.0.1:5173', 'http://localhost:5173', mediaOrigin].includes(origin)) throw new HttpError(403, 'Origin not allowed');
    if (request.url.split('?')[0] === '/api/session') {reply.header('Cache-Control', 'no-store'); return;}
    const supplied = request.headers['x-local-token'] ?? (request.method === 'GET' ? (request.query as Record<string, string>).cap : '');
    if (typeof supplied !== 'string' || Buffer.byteLength(supplied) !== Buffer.byteLength(token) ||
      !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))) throw new HttpError(403, 'Local session expired. Reload the editor.');
    // GIF decoding fetches bytes across the renderer origin; capability checks still apply.
    if (assetRead && origin) reply.header('Access-Control-Allow-Origin', origin).header('Vary', 'Origin');
  });
  app.get('/api/session', async () => ({token, maxUploadBytes: MAX_UPLOAD}));
  app.get('/api/projects', async () => store.list());
  app.post('/api/projects', async () => store.create());
  app.get<{Params: {id: string}}>('/api/projects/:id', async request => {
    const id = identity.parse(request.params.id), loaded = await store.load(id);
    const missing = [];
    for (const asset of loaded.project.assets) {
      try {await store.existingFile(id, 'assets', asset.file);} catch {missing.push(asset.name);}
    }
    return {...loaded, missing};
  });
  app.put<{Params: {id: string}}>('/api/projects/:id', async request => {
    let project: Project;
    try {project = parseProject(request.body);} catch (error) {throw new HttpError(400, error instanceof Error ? error.message : 'Invalid project');}
    if (project.id !== identity.parse(request.params.id)) throw new HttpError(400, 'Project ID mismatch');
    return store.save(project);
  });
  app.post<{Params: {id: string}}>('/api/projects/:id/assets', async request => {
    const id = identity.parse(request.params.id), file = await request.file();
    if (!file) throw new HttpError(400, 'Choose an audio, video, or image file');
    const extension = path.extname(file.filename).toLowerCase().replace('.jpeg', '.jpg');
    if (!mime[extension]) {file.file.resume(); throw new HttpError(400, 'Use WAV, MP3, MP4, JPG, PNG, or GIF');}
    const replacementId = (request.query as {replace?: string}).replace;
    const previous = replacementId ? (await store.load(id)).project.assets.find(a => a.id === identity.parse(replacementId)) : undefined;
    if (replacementId && !previous) {file.file.resume(); throw new HttpError(404, 'Asset to repair was not found');}
    const assetId = previous?.id ?? randomUUID(), filename = previous?.file ?? `${assetId}${extension}`;
    const folder = await store.location(id, 'assets');
    // Canonicalize the directory too: a replaced assets symlink must not escape storage.
    await store.existingFile(id, 'assets');
    const temporary = path.join(folder, `${assetId}.${randomUUID()}.upload`), target = path.join(folder, filename);
    try {
      const hash = createHash('sha256'); file.file.on('data', chunk => hash.update(chunk));
      await pipeline(file.file, createWriteStream(temporary, {flags: 'wx'}));
      if (file.file.truncated) throw new HttpError(413, 'File exceeds the 500 MB upload limit');
      const {stdout} = await execute('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', temporary], {timeout: 30000, windowsHide: true});
      const probe = JSON.parse(stdout), stream = probe.streams.find((s: {codec_type: string}) => s.codec_type === 'video');
      const kind = extension === '.wav' || extension === '.mp3' ? 'audio' : extension === '.mp4' ? 'video' : 'image';
      const format = String(probe.format?.format_name ?? '');
      const valid = kind === 'audio' ? probe.streams.some((s: {codec_type: string}) => s.codec_type === 'audio') &&
        (extension === '.wav' ? format.includes('wav') : format.includes('mp3')) : kind === 'video' ? Boolean(stream) && format.includes('mp4') :
        stream?.codec_name === (extension === '.gif' ? 'gif' : extension === '.png' ? 'png' : 'mjpeg');
      if (!valid) throw new HttpError(400, 'File contents do not match the selected media format');
      const duration = kind === 'image' ? 0 : Math.round(Number(probe.format.duration) * 1000);
      if (kind !== 'image' && (!Number.isFinite(duration) || duration <= 0 || duration > 3600000)) throw new HttpError(400, 'Use a playable file shorter than one hour');
      if (stream && (stream.width * stream.height > 16777216 || stream.width <= 0 || stream.height <= 0)) throw new HttpError(400, 'Media dimensions exceed the 16 megapixel limit');
      const digest = hash.digest('hex');
      if (previous && digest !== previous.hash) throw new HttpError(400, 'Repair requires the identical original file. Import different media separately.');
      const asset: Asset = {id: assetId, name: path.basename(file.filename), file: filename, kind, durationMs: duration,
        width: stream?.width ?? 0, height: stream?.height ?? 0, hash: digest};
      await rename(temporary, target);
      if (previous) return {asset: previous, project: (await store.load(id)).project};
      return await store.locked(id, async () => {
        const {project} = await store.load(id); project.assets.push(asset);
        if (kind === 'audio' && !project.audioClips.length) {
          const occupied = Math.max(0, ...project.backgrounds.map(c => c.startMs + c.durationMs), ...project.lines.map(l => l.startMs === null ? 0 : l.startMs + l.durationMs!));
          project.durationMs = Math.max(duration, occupied); project.audioFile = filename;
          project.audioClips.push(clipSchema.parse({id: randomUUID(), assetId, startMs: 0, durationMs: duration, sourceInMs: 0}));
        }
        project.revision++; parseProject(project);
        await atomicJson(await store.location(id, 'project.json'), project);
        return {asset, project};
      });
    } catch (error) {
      await unlink(temporary).catch(() => {}); if (!previous) await unlink(target).catch(() => {});
      if (error instanceof HttpError) throw error;
      throw new HttpError(400, 'Media could not be imported. Check the file and available disk space.');
    }
  });
  app.get<{Params: {id: string; assetId: string}}>('/api/projects/:id/assets/:assetId', async (request, reply) => {
    const {project} = await store.load(identity.parse(request.params.id));
    const asset = project.assets.find(a => a.id === request.params.assetId);
    if (!asset) throw new HttpError(404, 'Asset not found');
    const file = await store.existingFile(project.id, 'assets', asset.file), info = await stat(file);
    reply.header('Accept-Ranges', 'bytes').type(mime[path.extname(asset.file)]);
    if (request.headers.range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
      if (!match || (!match[1] && !match[2])) return reply.code(416).header('Content-Range', `bytes */${info.size}`).send();
      const start = match[1] ? Number(match[1]) : Math.max(0, info.size - Number(match[2]));
      const end = match[1] && match[2] ? Math.min(Number(match[2]), info.size - 1) : info.size - 1;
      if (start > end || start >= info.size) return reply.code(416).header('Content-Range', `bytes */${info.size}`).send();
      reply.code(206).header('Content-Range', `bytes ${start}-${end}/${info.size}`).header('Content-Length', end - start + 1);
      return reply.send(createReadStream(file, {start, end}));
    }
    reply.header('Content-Length', info.size); return reply.send(createReadStream(file));
  });
  app.post<{Params: {id: string}}>('/api/projects/:id/alignment-jobs', async request => {
    const {language} = z.object({language: z.enum(['en', 'tl', 'es', 'ja']).default('en')}).parse(request.body ?? {});
    const {project} = await store.load(identity.parse(request.params.id));
    const clip = project.audioClips[0], asset = project.assets.find(a => a.id === clip?.assetId);
    // shortcut: full original song alignment, map edited audio clips before allowing post-trim realignment.
    if (!asset || project.audioClips.length !== 1 || clip.sourceInMs || clip.startMs || clip.durationMs !== asset.durationMs)
      throw new HttpError(400, 'Align the original song before trimming or splitting its audio');
    if (!project.sourceLyrics.trim()) throw new HttpError(400, 'Paste lyrics before aligning');
    const audio = await store.existingFile(project.id, 'assets', asset.file);
    return jobs.start(project.id, project.revision, 'alignment', async (job, signal, update) => {
      const directory = path.join(jobs.folder, job.id); await mkdir(directory, {recursive: true});
      const lyrics = path.join(directory, 'lyrics.txt'), output = path.join(directory, 'result.json');
      await writeFile(lyrics, project.sourceLyrics, 'utf8');
      await update('Listening and matching lyrics (first use may download model weights)');
      await runPython(['services/lyric-alignment/align.py', audio, lyrics, output, '--language', language,
        '--model', 'small', '--cache-dir', path.resolve('.cache/transcription')], signal);
      const aligned = parseProofProject(JSON.parse(await readFile(output, 'utf8')));
      return {lines: aligned.lines, sourceLyrics: project.sourceLyrics, audioHash: asset.hash};
    });
  });
  app.post<{Params: {id: string}}>('/api/projects/:id/export-jobs', async request => {
    const {allowUntimed} = z.object({allowUntimed: z.boolean().default(false)}).parse(request.body ?? {});
    const {project} = await store.load(identity.parse(request.params.id));
    if (!project.audioClips.length) throw new HttpError(400, 'Import song audio before exporting');
    if (!allowUntimed && project.lines.some(l => l.status !== 'manual')) throw new HttpError(400, 'Review automatic and untimed lyrics, or explicitly export with them');
    for (const asset of project.assets) await store.existingFile(project.id, 'assets', asset.file);
    return jobs.start(project.id, project.revision, 'export', async (job, signal, update) => {
      const directory = path.join(jobs.folder, job.id); await mkdir(directory, {recursive: true});
      await atomicJson(path.join(directory, 'snapshot.json'), project);
      const assets = Object.fromEntries(project.assets.map(a => [a.file, `${mediaOrigin}/api/projects/${project.id}/assets/${a.id}?cap=${token}`]));
      await update('Preparing video');
      bundlePromise ??= bundle({entryPoint: path.resolve('apps/api/remotion.tsx'), publicDir: null,
        outDir: path.resolve('.cache/editor-bundle')}).catch(error => {bundlePromise = undefined; throw error;});
      const serveUrl = await bundlePromise;
      if (signal.aborted) throw new Error('Cancelled');
      const inputProps = {project, assets};
      const composition = await selectComposition({serveUrl, id: 'LyricsEditor', inputProps});
      if (signal.aborted) throw new Error('Cancelled');
      const cancellation = makeCancelSignal();
      signal.addEventListener('abort', cancellation.cancel, {once: true});
      const partial = path.join(directory, 'video.partial.mp4');
      try {
        await renderMedia({serveUrl, composition, inputProps, codec: 'h264', audioCodec: 'aac', pixelFormat: 'yuv420p',
          outputLocation: partial, concurrency: 2, cancelSignal: cancellation.cancelSignal,
          onProgress: ({progress}) => {void update('Rendering MP4', progress).catch(() => {});}});
        if (signal.aborted) throw new Error('Cancelled');
        await rename(partial, path.join(directory, 'video.mp4'));
        return {frames: durationFrames(project)};
      } finally {signal.removeEventListener('abort', cancellation.cancel); await unlink(partial).catch(() => {});}
    });
  });
  app.get<{Params: {id: string}}>('/api/jobs/:id', async request => jobs.get(identity.parse(request.params.id)));
  app.get<{Params: {id: string}}>('/api/projects/:id/jobs', async request => jobs.list(identity.parse(request.params.id)));
  app.post<{Params: {id: string}}>('/api/jobs/:id/cancel', async request => jobs.cancel(identity.parse(request.params.id)));
  app.get<{Params: {id: string}}>('/api/jobs/:id/result', async (request, reply) => {
    const job = jobs.get(identity.parse(request.params.id));
    if (job.state !== 'succeeded') throw new HttpError(409, 'Result is not ready');
    if (job.kind === 'alignment') return job.result;
    reply.header('Content-Disposition', 'attachment; filename="lyrics-video.mp4"').type('video/mp4');
    return reply.send(createReadStream(path.join(jobs.folder, job.id, 'video.mp4')));
  });
  app.addHook('onClose', async () => jobs.close());
  return {app, store, jobs, token};
}
