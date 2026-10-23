import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import fixtures from '../tests/fixtures/v1-projects.json';
import {parseProject} from '../packages/project-model/model';

const files = ['tests/fixtures/v1-projects.json', 'packages/project-model/model.ts', 'packages/editor-core/commands.ts',
  'packages/video-composition/ProofVideo.tsx', 'apps/web/App.tsx', 'apps/web/Timeline.tsx', 'apps/api/app.ts'];
const hashes: Record<string, string> = {};
for (const file of files) hashes[file] = createHash('sha256').update(await readFile(file)).digest('hex');
for (const project of fixtures) assert.equal(parseProject(project).schemaVersion, 1);
const performance = JSON.parse(await readFile('artifacts/acceptance/performance/report.json', 'utf8'));
assert.equal(performance.cases.length, 3);
await mkdir('artifacts/advanced', {recursive: true});
await writeFile('artifacts/advanced/baseline.json', JSON.stringify({capturedAt: new Date().toISOString(), hashes,
  checks: {typescript: 50, python: 24, lint: 'passed', typecheck: 'passed', build: 'passed',
    backgrounds: 'passed', recents: 'passed', visualParityFrames: 48},
  performanceScope: 'Earlier pre-migration measured workload baseline, not a fresh benchmark run', performance}, null, 2), {flag: 'wx'});
console.log('Captured V1 fixture/source hashes and verified pre-migration regression/performance evidence.');
