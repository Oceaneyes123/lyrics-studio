import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';
import {ensureBrowser, renderStill, selectComposition} from '@remotion/renderer';
import {lineAtFrame, parseProofProject} from '../packages/project-model/proof.ts';

const project = parseProofProject(JSON.parse(await readFile('.cache/proof/marker.project.json', 'utf8')));
const serveUrl = path.resolve('artifacts/bundle');
const inputProps = {project};
const composition = await selectComposition({serveUrl, id: 'LyricsProof', inputProps});
const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', 'artifacts/marker.mp4'], {encoding: 'utf8'}));
const video = probe.streams.find(s => s.codec_type === 'video');
const audio = probe.streams.find(s => s.codec_type === 'audio');
assert.equal(video.codec_name, 'h264');
assert.equal(audio.codec_name, 'aac');
assert.equal(video.width, project.width);
assert.equal(video.height, project.height);
assert.equal(video.r_frame_rate, `${project.fps}/1`);
assert(Math.abs(Number(probe.format.duration) - 10) <= 1 / project.fps);

const decoded = execFileSync('ffmpeg', ['-v', 'error', '-i', 'artifacts/marker.mp4', '-vn', '-ac', '1', '-ar', '48000', '-f', 's16le', '-'], {maxBuffer: 4e6});
const onsets = [];
let lastSignal = -48000;
for (let i = 0; i < decoded.length / 2; i++) {
  if (Math.abs(decoded.readInt16LE(i * 2)) > 4000) {
    if (i - lastSignal > 24000) onsets.push(i / 48000);
    lastSignal = i;
  }
}
assert.equal(onsets.length, 3, 'Expected three audio marker pulses');
const offsets = onsets.map((time, i) => time - [1, 5, 9][i]);
assert(offsets.every(offset => Math.abs(offset) <= 1 / project.fps), 'Audio marker offset exceeds one frame');
assert(Math.max(...offsets) - Math.min(...offsets) <= 1 / project.fps, 'Audio accumulates drift');

await mkdir('artifacts/parity', {recursive: true});
const server = await createServer({server: {host: '127.0.0.1', port: 5174, strictPort: true}});
let browser;
const errors = [];
const frames = [29, 30, 47, 59, 60, 89, 90, 149, 150, 269, 270, 299];
const results = [];
const rgb = (file, frame) => execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-vf',
  `${frame === undefined ? '' : `select=eq(n\\,${frame}),`}crop=1280:600:0:0`,
  '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], {maxBuffer: 4e6});
try {
  await server.listen();
  const installed = await ensureBrowser();
  assert('path' in installed, 'Remotion Chromium executable unavailable');
  browser = await chromium.launch({executablePath: installed.path});
  const page = await browser.newPage({viewport: {width: 1400, height: 1100}, deviceScaleFactor: 1});
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:5174/?fixture=marker');
  await page.locator('[data-proof-canvas]').waitFor();
  await page.evaluate(() => document.fonts.ready);
  for (const frame of frames) {
    await page.getByRole('spinbutton', {name: 'Frame', exact: true}).fill(String(frame));
    await page.locator(`[data-proof-frame="${frame}"]`).waitFor({state: 'attached'});
    assert.equal(await page.locator('[data-proof-frame]').getAttribute('data-line-id'), lineAtFrame(project, frame)?.id ?? '');
    const preview = `artifacts/parity/preview-${frame}.png`;
    const rendered = `artifacts/parity/render-${frame}.png`;
    await page.locator('[data-proof-canvas]').screenshot({path: preview, animations: 'disabled'});
    await renderStill({serveUrl, composition, inputProps, frame, output: rendered, imageFormat: 'png'});
    // Compare the canvas above Player transport controls, which are not video content.
    const a = rgb(preview), b = rgb(rendered);
    assert.equal(a.length, b.length);
    let total = 0;
    for (let i = 0; i < a.length; i++) total += Math.abs(a[i] - b[i]);
    const meanAbsoluteError = total / a.length;
    assert(meanAbsoluteError < 0.15, `Preview/render pixel error ${meanAbsoluteError} at frame ${frame}`);
    const encoded = rgb('artifacts/marker.mp4', frame);
    assert.equal(encoded.length, b.length);
    let foregroundError = 0, foregroundChannels = 0, encodedTextPixels = 0;
    for (let i = 0; i < b.length; i += 3) {
      if (Math.max(encoded[i], encoded[i + 1], encoded[i + 2]) > 150) encodedTextPixels++;
      if (Math.max(b[i], b[i + 1], b[i + 2]) > 150) {
        for (let c = 0; c < 3; c++) foregroundError += Math.abs(encoded[i + c] - b[i + c]);
        foregroundChannels += 3;
      }
    }
    assert.equal(encodedTextPixels > 50, Boolean(lineAtFrame(project, frame)), `Encoded lyric visibility at frame ${frame}`);
    const encodedForegroundError = foregroundChannels ? foregroundError / foregroundChannels : 0;
    assert(encodedForegroundError < 18, `Encoded lyric pixels differ at frame ${frame}: ${encodedForegroundError}`);
    results.push({frame, lineId: lineAtFrame(project, frame)?.id ?? null, meanAbsoluteError, encodedForegroundError});
  }
  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  await server.close();
}
const report = {video: {codec: video.codec_name, width: video.width, height: video.height, fps: video.r_frame_rate},
  audio: {codec: audio.codec_name, markerOnsetsSeconds: onsets, offsetsSeconds: offsets},
  parity: results, browserErrors: errors, listeningReview: 'Not performed'};
await writeFile('artifacts/verification.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
