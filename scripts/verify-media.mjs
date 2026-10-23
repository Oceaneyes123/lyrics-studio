import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
const base = 'http://127.0.0.1:5173';
const {token} = await fetch(`${base}/api/session`).then(r => r.json());
async function request(route, body, method = 'POST') {
  const response = await fetch(`${base}/api${route}`, {method, headers: {'x-local-token': token,
    ...(body instanceof FormData || !body ? {} : {'Content-Type': 'application/json'})}, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined});
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}
await mkdir('.cache/editor-media', {recursive: true}); await mkdir('artifacts/editor/media', {recursive: true});
const ffmpeg = args => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], {windowsHide: true});
ffmpeg(['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', '2', '.cache/editor-media/sound.wav']);
ffmpeg(['-i', '.cache/editor-media/sound.wav', '.cache/editor-media/sound.mp3']);
ffmpeg(['-f', 'lavfi', '-i', 'color=red:s=64x64', '-frames:v', '1', '.cache/editor-media/red.png']);
ffmpeg(['-f', 'lavfi', '-i', 'color=blue:s=64x64', '-frames:v', '1', '.cache/editor-media/blue.jpg']);
ffmpeg(['-f', 'lavfi', '-i', 'color=green:s=64x64:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '.cache/editor-media/green.mp4']);
let project = await request('/projects');
const imported = [];
for (const filename of ['sound.wav', 'sound.mp3', 'red.png', 'blue.jpg', 'green.mp4']) {
  const data = new FormData(); data.set('file', new Blob([await readFile(`.cache/editor-media/${filename}`)]), filename);
  const result = await request(`/projects/${project.id}/assets`, data); project = result.project; imported.push(result.asset);
}
assert.equal(project.assets.length, 5);
const image = imported.find(a => a.name === 'red.png'), video = imported.find(a => a.name === 'green.mp4');
const clip = (assetId, startMs, durationMs, fadeInMs = 0) => ({id: crypto.randomUUID(), assetId, startMs, durationMs, sourceInMs: 0,
  fit: 'cover', scale: 1, x: 0, y: 0, fadeInMs, fadeOutMs: 0});
project.backgrounds = [clip(image.id, 0, 2000), clip(video.id, 500, 1000, 500)];
project.name = 'Media preset verification';
project.lines = [{id: 'line', text: 'Color test', status: 'manual', startMs: 0, durationMs: 2000, words: []}];
const presets = [[1280, 720, 24], [1920, 1080, 25], [720, 1280, 30], [1080, 1920, 30]];
async function waitJob(id) {
  for (let i = 0; i < 240; i++) {
    const job = await request(`/jobs/${id}`, undefined, 'GET');
    if (job.state === 'succeeded') return job;
    if (['failed', 'cancelled', 'interrupted'].includes(job.state)) throw new Error(job.error ?? job.state);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('Export timed out');
}
const results = [];
for (const [width, height, fps] of presets) {
  Object.assign(project, {width, height, fps}); project = await request(`/projects/${project.id}`, project, 'PUT');
  const job = await request(`/projects/${project.id}/export-jobs`, {allowUntimed: false}); await waitJob(job.id);
  const response = await fetch(`${base}/api/jobs/${job.id}/result?cap=${token}`); assert(response.ok);
  const file = `artifacts/editor/media/${width}x${height}-${fps}.mp4`;
  await writeFile(file, Buffer.from(await response.arrayBuffer()));
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], {encoding: 'utf8'}));
  const stream = probe.streams.find(s => s.codec_type === 'video');
  assert.equal(stream.width, width); assert.equal(stream.height, height); assert.equal(stream.r_frame_rate, `${fps}/1`);
  assert.equal(stream.codec_name, 'h264'); assert.equal(probe.streams.find(s => s.codec_type === 'audio').codec_name, 'aac');
  const pixel = frame => execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', `select=eq(n\\,${frame}),crop=2:2:0:0`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  const red = pixel(0), green = pixel(fps);
  const blend = pixel(Math.round(fps * .75));
  assert(red[0] > red[1] + 80, 'Imported image must render red');
  assert(green[1] > green[0] + 50, 'Imported video must become green after crossfade');
  assert(blend[0] > 50 && blend[0] < 220 && blend[1] > 20, 'Crossfade midpoint must blend both backgrounds');
  results.push({width, height, fps, duration: Number(probe.format.duration), imageVisible: true, videoCrossfadeVisible: true});
  console.log(`Verified ${width}x${height} at ${fps} FPS`);
}
const cancellation = await request(`/projects/${project.id}/export-jobs`, {allowUntimed: false});
await new Promise(resolve => setTimeout(resolve, 1000));
const cancelled = await request(`/jobs/${cancellation.id}/cancel`); assert.equal(cancelled.state, 'cancelled');
const unavailable = await fetch(`${base}/api/jobs/${cancellation.id}/result?cap=${token}`); assert.equal(unavailable.status, 409);
await writeFile('artifacts/editor/media/verification.json', JSON.stringify({projectId: project.id,
  formats: imported.map(a => a.name), presets: results, cancelledJob: true}, null, 2));
