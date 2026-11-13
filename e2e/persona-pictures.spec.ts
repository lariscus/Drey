import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect, type Page } from './fixtures/drey';

/**
 * The persona pictures (req-292, milestone 253) in the running app: a board
 * whose Ben predates the pictures gets the shipped one when the engine
 * starts (one commit `personas: crew pictures`), the seeded crew brings its
 * own, the human persona gets one when it is created — and the Crew list,
 * the Capacity band and the Persona page draw them in the circles. A home of
 * its own, so the plugin spawns an engine for the seeded vault and never
 * adopts the owner's (and never reads the owner's board).
 */
const engineHome = fs.mkdtempSync(path.join(os.tmpdir(), 'drey-e2e-home-'));
process.env['USERPROFILE'] = engineHome;
process.env['HOME'] = engineHome;

test.afterAll(() => {
  try {
    const lock = JSON.parse(fs.readFileSync(path.join(engineHome, '.drey-engine', 'service.lock'), 'utf8')) as { pid?: number };
    if (typeof lock.pid === 'number') {
      process.kill(lock.pid);
    }
  } catch {
    // no engine was started, or it is already gone
  }
  fs.rmSync(engineHome, { recursive: true, force: true });
});

const SHIPPED = path.join(__dirname, '..', 'packages', 'tickets-engine', 'personas');

test.use({
  seedVault: {
    'tickets/_meta/pipeline.md': ['---', 'phases:', '  - { id: inbox, title: Inbox, handover: manual }', '  - { id: build, title: Build, handover: agent build-default }', '  - { id: done, title: Done, handover: none }', '---', 'The phases.', ''].join('\n'),
    'tickets/_meta/repos.md': ['---', 'repos:', '  drey:', '    url: https://example.invalid/drey.git', '    branch: main', '---', ''].join('\n'),
    'tickets/_meta/personas/ben/persona.md': ['---', 'title: Ben', 'role: builder', 'worker: opencode', 'models:', '  default: qwen3-coder', '  pool: [qwen3-coder]', '  router: off', "color: '#bfdbf7'", 'skills: []', 'budget: 5', '---', ''].join('\n'),
    'tickets/_meta/personas/ben/prompt.md': '## Who Ben is\n\nBen builds.\n',
    'tickets/10-inbox/T-0001.md': ['---', 'id: T-0001', 'title: "A seeded ticket"', 'repo: drey', 'priority: normal', 'branch: t/T-0001', "entered-inbox: '2026-10-20T09:00:00Z'", '---', '', '## Description', '', 'Text.', '', '## Log', ''].join('\n'),
  },
  appConfig: { plugins: { disabled: ['sample', 'templates', 'browser', 'drawio', 'ocr', 'meeting'] }, spellcheck: { enabled: false } },
});

test.beforeEach(({ vaultDir }) => {
  execFileSync('git', ['init', '-q'], { cwd: vaultDir, windowsHide: true });
});

const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim();

const subjects = (vaultDir: string): readonly string[] => {
  try {
    return git(vaultDir, 'log', '--format=%s').split('\n');
  } catch {
    return []; // a repository without a commit yet
  }
};

async function openCrew(page: Page): Promise<void> {
  await expect(page.locator('app-titlebar [role="tab"]', { hasText: 'Work' })).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press('Control+2');
  await page.locator('app-panel-frame', { has: page.locator('.tickets-panel') }).filter({ visible: true }).locator('.head').hover();
  await page.locator('button[aria-label="More actions"]:visible').click({ force: true });
  await page.getByRole('menuitem', { name: 'Crew', exact: true }).click();
}

const sameBytes = (file: string, shipped: string): boolean => fs.existsSync(file) && fs.readFileSync(file).equals(fs.readFileSync(shipped));

test('the crew pictures land in the board and every persona circle draws them', async ({ page, vaultDir }, testInfo) => {
  test.setTimeout(150_000);
  const personas = path.join(vaultDir, 'tickets', '_meta', 'personas');
  // The engine's start: the seeding brings Pia, Paul, Ralf and Tessa with their pictures, the backfill gives Ben his.
  await expect
    .poll(() => subjects(vaultDir).filter((subject) => subject === 'personas: the default crew (req-256)' || subject === 'personas: crew pictures').sort(), {
      message: 'the engine has seeded the crew and backfilled the pictures',
      timeout: 60_000,
    })
    .toEqual(['personas: crew pictures', 'personas: the default crew (req-256)']);
  expect(sameBytes(path.join(personas, 'ben', 'avatar.png'), path.join(SHIPPED, 'ben', 'avatar.png'))).toBe(true);
  expect(sameBytes(path.join(personas, 'tessa', 'avatar.png'), path.join(SHIPPED, 'tessa', 'avatar.png'))).toBe(true);
  expect(fs.readFileSync(path.join(vaultDir, 'tickets', '_meta', 'crew.md'), 'utf8')).toMatch(/seeded-pictures:.*ben/);

  await openCrew(page);
  const crew = page.locator('.desk-team').filter({ visible: true });
  const benCard = crew.locator('[data-persona="ben"]').first();
  await expect(benCard.locator('img.persona-picture')).toBeVisible({ timeout: 20_000 });
  await expect(crew.locator('[data-persona="tessa"] img.persona-picture').first()).toBeVisible();
  const src = await benCard.locator('img.persona-picture').getAttribute('src');
  expect(src?.startsWith('data:image/png;base64,')).toBe(true);
  // The human persona is created when the Crew list is first read, with its picture in the same commit.
  await expect.poll(() => subjects(vaultDir).includes('tickets: you persona'), { timeout: 30_000 }).toBe(true);
  expect(sameBytes(path.join(personas, 'you', 'avatar.png'), path.join(SHIPPED, 'you', 'avatar.png'))).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('persona-pictures-crew.png') });
  await testInfo.attach('persona-pictures-crew', { path: testInfo.outputPath('persona-pictures-crew.png'), contentType: 'image/png' });

  // The Persona page a card opens (req-295): the head and the profile draw Ben's picture.
  await benCard.click();
  const body = page.locator('.persona-page').filter({ visible: true });
  await expect(body.locator('.persona-avatar-head img.persona-picture')).toBeVisible({ timeout: 15_000 });
  await expect(body.locator('.persona-avatar-profile img.persona-picture')).toBeVisible();
  const box = await body.locator('.persona-avatar-profile img.persona-picture').boundingBox();
  expect(Math.round(box?.width ?? 0)).toBe(72);
  expect(await body.locator('.persona-avatar-profile img.persona-picture').evaluate((img) => getComputedStyle(img).objectFit)).toBe('cover');
  await page.screenshot({ path: testInfo.outputPath('persona-pictures-page.png') });
  await testInfo.attach('persona-pictures-page', { path: testInfo.outputPath('persona-pictures-page.png'), contentType: 'image/png' });
});
