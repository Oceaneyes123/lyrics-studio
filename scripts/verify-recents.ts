import assert from 'node:assert/strict';
import {chromium, expect} from '@playwright/test';
import {ensureBrowser} from '@remotion/renderer';
import {createServer} from 'vite';
import {newProject} from '../packages/project-model/model';

const web = await createServer({server: {port: 5174}});
const installed = await ensureBrowser(); assert('path' in installed);
const browser = await chromium.launch({executablePath: installed.path});
try {
  await web.listen();
  const page = await browser.newPage({viewport: {width: 1280, height: 900}});
  const first = {...newProject('11111111-1111-4111-8111-111111111111'), name: 'First song'};
  const second = {...newProject('22222222-2222-4222-8222-222222222222'), name: 'Second song'};
  const requests: string[] = [], errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', async route => {
    const request = route.request(); requests.push(request.method());
    assert.equal(request.method(), 'GET');
    const pathname = new URL(request.url()).pathname;
    const json = pathname === '/api/session' ? {token: 'test-token'} : pathname === '/api/projects' ? [first, second] :
      pathname.endsWith('/jobs') ? [] : {project: first, recovered: false, missing: []};
    await route.fulfill({json});
  });
  await page.goto('http://127.0.0.1:5174/');
  const removeFirst = page.getByRole('button', {name: 'Remove First song from recents', exact: true});
  const removeSecond = page.getByRole('button', {name: 'Remove Second song from recents', exact: true});
  await removeFirst.focus(); await page.keyboard.press('Enter');
  await expect(removeFirst).toHaveCount(0); await expect(removeSecond).toHaveCount(1);
  await expect(page.getByLabel('Open project').locator(`option[value="${first.id}"]`)).toHaveCount(1);
  await page.reload(); await expect(removeSecond).toHaveCount(1); await expect(removeFirst).toHaveCount(0);
  // A failed persistence write must keep the row visible and report the error.
  await page.evaluate(() => {Storage.prototype.setItem = () => {throw new Error('Storage write blocked');};});
  await removeSecond.click();
  await expect(page.getByRole('alert')).toContainText('Storage write blocked');
  await expect(removeSecond).toHaveCount(1);
  await page.reload(); await removeSecond.click();
  await expect(page.getByRole('heading', {name: 'Recent projects'})).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel('Open project').locator('option')).toHaveCount(3);
  await expect(page.getByRole('heading', {name: 'Recent projects'})).toHaveCount(0);
  // Hidden projects remain readable through Open project.
  await page.getByLabel('Open project').selectOption(first.id);
  await expect(page.getByLabel('Project name')).toHaveValue('First song');
  for (const invalid of ['invalid JSON', '{}', '[null]']) {
    await page.evaluate(value => localStorage.setItem('lyrics-studio-hidden-recents', value), invalid);
    await page.reload(); await expect(removeFirst).toHaveCount(1); await expect(removeSecond).toHaveCount(1);
  }
  assert.deepEqual(errors, []); assert(requests.length > 0);
  console.log('Recents checks passed: remove, reload persistence, keyboard access, empty list, retained projects, storage errors.');
} finally {await browser.close(); await web.close();}
