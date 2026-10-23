import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium, expect} from '@playwright/test';
import {bundle} from '@remotion/bundler';
import {ensureBrowser, renderStill, selectComposition} from '@remotion/renderer';
import {createServer} from 'vite';
import {newProject, parseProject, type LyricStyle} from '../packages/project-model/model';

const output = 'artifacts/acceptance/visual';
await mkdir(output, {recursive: true});
const web = await createServer({plugins: [{name: 'acceptance-page', configureServer(server) {
  server.middlewares.use('/__acceptance', (_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end('<html><body style="margin:0"><div id="root"></div><script type="module" src="/tests/visual.tsx"></script></body></html>');
  });
}}], server: {port: 5174, strictPort: true}});
const installed = await ensureBrowser(); assert('path' in installed);
const browser = await chromium.launch({executablePath: installed.path});
const errors: string[] = [];
const results = [];
const rgb = (file: string) => execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], {maxBuffer: 8e6, windowsHide: true});
try {
  const serveUrl = await bundle({entryPoint: path.resolve('apps/api/remotion.tsx'), publicDir: null, outDir: path.resolve('.cache/acceptance-bundle')});
  await web.listen();
  const page = await browser.newPage({viewport: {width: 1300, height: 1300}, deviceScaleFactor: 1});
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:5174/__acceptance');
  await page.locator('[data-proof-canvas]').waitFor();
  const cases: {name: string; text: string; font: LyricStyle['font']; karaoke: LyricStyle['karaoke']; words: boolean}[] = [
    {name: 'multiline', text: 'First line\nSecond line', font: 'Inter', karaoke: 'none', words: false},
    {name: 'latin', text: '¡Corazón! “Awit”—café, naïve…', font: 'Inter', karaoke: 'progressive', words: true},
    {name: 'wrap', text: 'A longer lyric wraps across several lines with clear punctuation!', font: 'Georgia', karaoke: 'word', words: true},
    {name: 'unicode', text: '歌を歌おう 🌟\nمرحبا بالعالم', font: 'Arial', karaoke: 'none', words: false},
  ];
  for (const [width, height] of [[1280, 720], [720, 1280]]) {
    for (const test of cases) {
      const project = newProject(crypto.randomUUID());
      Object.assign(project, {width, height, durationMs: 3000});
      Object.assign(project.style, {font: test.font, karaoke: test.karaoke, fontSize: 60, y: 50, fadeMs: 200});
      const tokens = test.text.match(/\S+\s*/g)!;
      project.lines = [{id: 'sample', text: test.text, status: 'manual', startMs: 500, durationMs: 2000,
        words: test.words ? tokens.map((text, i) => ({text, startMs: Math.round(i * 1800 / tokens.length), endMs: Math.round((i + 1) * 1800 / tokens.length)})) : []}];
      const props = {project: parseProject(project)};
      await page.evaluate(p => window.acceptance.load(p), project);
      await page.waitForFunction(w => document.querySelector('[data-proof-canvas]')?.getBoundingClientRect().width === w, width);
      await page.evaluate(() => document.fonts.ready);
      const composition = await selectComposition({serveUrl, id: 'LyricsEditor', inputProps: props});
      for (const frame of [14, 15, 21, 45, 74, 75]) {
        await page.evaluate(f => window.acceptance.seek(f), frame);
        await page.locator(`[data-proof-frame="${frame}"]`).waitFor({state: 'attached'});
        const stem = `${output}/${test.name}-${width}-${frame}`;
        await page.locator('[data-proof-canvas]').screenshot({path: `${stem}-preview.png`, animations: 'disabled'});
        await renderStill({serveUrl, composition, inputProps: props, frame, output: `${stem}-render.png`, imageFormat: 'png'});
        const a = rgb(`${stem}-preview.png`), b = rgb(`${stem}-render.png`);
        assert.equal(a.length, b.length);
        let total = 0; for (let i = 0; i < a.length; i++) total += Math.abs(a[i] - b[i]);
        const error = total / a.length;
        assert(error < .15, `${test.name} ${width} frame ${frame}: preview/render pixel error ${error}`);
        if (test.name === 'multiline' && frame === 45) {
          const rows = await page.locator('[data-proof-frame]').evaluate(element => {
            const node = element.firstChild!;
            return [0, 11].map(start => {const range = document.createRange(); range.setStart(node, start); range.setEnd(node, start + 5); return range.getBoundingClientRect().top;});
          });
          assert(rows[1] > rows[0] + 30, 'Explicit newline must create a second rendered line');
        }
        results.push({case: test.name, width, height, frame, meanAbsolutePixelError: error});
      }
    }
  }
  // Missing bundled fonts must fail explicitly instead of silently exporting fallback glyphs.
  assert.deepEqual(errors, []);
  const failedFontPage = await browser.newPage();
  const fontErrors: string[] = [];
  failedFontPage.on('pageerror', error => fontErrors.push(error.message));
  await failedFontPage.route('**/*.{woff,woff2}', route => route.abort());
  await failedFontPage.goto('http://127.0.0.1:5174/__acceptance');
  await expect.poll(() => fontErrors.some(error => /font/i.test(error))).toBe(true);
  await writeFile(`${output}/report.json`, JSON.stringify({results, missingBundledFontRejected: true,
    browserErrorsBeforeFontFailure: errors,
    scope: 'Same Windows host; OS fallback fonts are not portable font guarantees. Unicode glyphs require visual review.'}, null, 2));
  console.log(`Verified ${results.length} preview/render frames, multiline layout, and missing bundled font failure.`);
} finally {await browser.close(); await web.close();}
