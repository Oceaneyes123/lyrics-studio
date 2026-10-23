import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {bundle} from '@remotion/bundler';
import {renderMedia, selectComposition} from '@remotion/renderer';
import {parseProofProject} from '../packages/project-model/proof.ts';

const fixture = process.argv[2] ?? 'marker';
if (!['marker', 'alignment', 'local'].includes(fixture)) throw new Error('Choose marker, alignment, or local');
const project = parseProofProject(JSON.parse(await readFile(`.cache/proof/${fixture}.project.json`, 'utf8')));
await mkdir('artifacts', {recursive: true});
const started = performance.now();
const serveUrl = await bundle({entryPoint: path.resolve('proof/remotion.tsx'),
  publicDir: path.resolve('.cache/proof'), outDir: path.resolve('artifacts/bundle')});
const inputProps = {project};
const composition = await selectComposition({serveUrl, id: 'LyricsProof', inputProps});
// shortcut: M0 song export covers the first 20 seconds, render full songs in M5.
const endFrame = Math.min(composition.durationInFrames, project.fps * (fixture === 'marker' ? 10 : 20)) - 1;
await renderMedia({serveUrl, composition, inputProps, codec: 'h264', audioCodec: 'aac',
  pixelFormat: 'yuv420p', outputLocation: `artifacts/${fixture}.mp4`,
  frameRange: [0, endFrame], concurrency: 2, overwrite: true});
const report = {fixture, fps: project.fps, width: project.width, height: project.height,
  renderedFrames: endFrame + 1, projectFrames: composition.durationInFrames,
  elapsedSeconds: Number(((performance.now() - started) / 1000).toFixed(3))};
await writeFile(`artifacts/${fixture}.render.json`, JSON.stringify(report, null, 2));
console.log(report);
