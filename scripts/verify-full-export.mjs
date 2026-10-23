import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile, writeFile} from 'node:fs/promises';
const base = 'http://127.0.0.1:5173';
const {token} = await fetch(`${base}/api/session`).then(r => r.json());
const {projectId} = JSON.parse(await readFile('artifacts/editor/verification.json', 'utf8'));
const headers = {'x-local-token': token, 'Content-Type': 'application/json'};
const loaded = await fetch(`${base}/api/projects/${projectId}`, {headers}).then(r => r.json());
assert(loaded.project.durationMs > 90000);
const response = await fetch(`${base}/api/projects/${projectId}/export-jobs`, {method: 'POST', headers, body: JSON.stringify({allowUntimed: true})});
if (!response.ok) throw new Error(await response.text());
const job = await response.json().catch(() => null);
if (!job) throw new Error('Could not read export job');
let completed = false, previous = -1;
for (let i = 0; i < 600; i++) {
  const current = await fetch(`${base}/api/jobs/${job.id}`, {headers}).then(r => r.json());
  const progress = Math.floor((current.progress ?? 0) * 10);
  if (progress !== previous) {console.log(`Full-song export: ${progress * 10}%`); previous = progress;}
  if (current.state === 'succeeded') {completed = true; break;}
  if (['failed', 'cancelled', 'interrupted'].includes(current.state)) throw new Error(current.error ?? current.state);
  await new Promise(resolve => setTimeout(resolve, 1000));
}
assert(completed, 'Full-song render timed out');
const video = await fetch(`${base}/api/jobs/${job.id}/result?cap=${token}`); assert(video.ok);
await writeFile('artifacts/editor/full-song.mp4', Buffer.from(await video.arrayBuffer()));
const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', 'artifacts/editor/full-song.mp4'], {encoding: 'utf8'}));
const stream = probe.streams.find(s => s.codec_type === 'video');
assert.equal(Number(stream.nb_frames), Math.round(loaded.project.durationMs * loaded.project.fps / 1000));
assert(Math.abs(Number(probe.format.duration) - loaded.project.durationMs / 1000) < 1 / loaded.project.fps);
await writeFile('artifacts/editor/full-export.json', JSON.stringify({projectId, jobId: job.id,
  durationSeconds: Number(probe.format.duration), frames: Number(stream.nb_frames), fps: stream.r_frame_rate}, null, 2));
console.log(`Verified full-song export: ${probe.format.duration}s, ${stream.nb_frames} frames`);
