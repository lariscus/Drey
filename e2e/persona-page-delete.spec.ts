import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect, type Page } from './fixtures/drey';

/**
 * Delete persona… (req-261, milestone 236) in the running app: the Persona
 * page's footer action, the modal ask that takes the exact title, the
 * engine's refusals (a pinned persona, the human persona) and the deletion
 * itself — one commit `personas: <id> removed`, the Crew list without it.
 * A home of its own, so the plugin spawns an engine for the seeded vault and
 * never adopts the owner's (and never reads the owner's board).
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

const persona = (title: string, role: string): string =>
  ['---', `title: ${title}`, `role: ${role}`, 'worker: opencode', 'models:', '  default: qwen3-coder', '  pool: [qwen3-coder]', '  router: off', "color: '#8ecbef'", 'skills: []', 'budget: 5', '---', ''].join('\n');

test.use({
  seedVault: {
    'tickets/_meta/pipeline.md': ['---', 'phases:', '  - { id: inbox, title: Inbox, handover: manual }', '  - { id: build, title: Build, handover: agent build-default, persona: ben }', '  - { id: done, title: Done, handover: none }', '---', 'The phases.', ''].join('\n'),
    'tickets/_meta/repos.md': ['---', 'repos:', '  drey:', '    url: https://example.invalid/drey.git', '    branch: main', '---', ''].join('\n'),
    'tickets/_meta/personas/ben/persona.md': persona('Ben', 'builder'),
    'tickets/_meta/personas/ben/prompt.md': 'You are Ben.\n',
    'tickets/_meta/personas/ralf/persona.md': persona('Ralf', 'reviewer'),
    'tickets/_meta/personas/ralf/prompt.md': 'You are Ralf.\n',
    'tickets/_meta/personas/ralf/memory.md': '- a lesson\n',
    'tickets/_meta/personas/ralf/skills/review/SKILL.md': '---\nname: review\ndescription: Reviews a diff\n---\n\nLook at the diff.\n',
    'tickets/_meta/chat/ralf-2026-11-09.md': 'The 1:1 with Ralf.\n',
    'tickets/10-inbox/T-0001.md': ['---', 'id: T-0001', 'title: "A seeded ticket"', 'repo: drey', 'priority: normal', 'branch: t/T-0001', "entered-inbox: '2026-10-20T09:00:00Z'", '---', '', '## Description', '', 'Text.', '', '## Log', ''].join('\n'),
  },
  appConfig: { plugins: { disabled: ['sample', 'templates', 'browser', 'drawio', 'ocr', 'meeting'] }, spellcheck: { enabled: false } },
});

test.beforeEach(({ vaultDir }) => {
  execFileSync('git', ['init', '-q'], { cwd: vaultDir, windowsHide: true });
});

const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim();

async function openCrew(page: Page): Promise<void> {
  await expect(page.locator('app-titlebar [role="tab"]', { hasText: 'Work' })).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press('Control+2');
  await page.locator('app-panel-frame', { has: page.locator('.tickets-panel') }).filter({ visible: true }).locator('.head').hover();
  await page.locator('button[aria-label="More actions"]:visible').click({ force: true });
  await page.getByRole('menuitem', { name: 'Crew', exact: true }).click();
}

/**
 * The commits the engine makes in a fresh board of its own accord: the default crew when it starts (req-256), then the
 * shipped pictures for the fixture's own Ben and Ralf (req-292), the human persona when the Crew list is first read (E10-6).
 */
const ENGINE_COMMITS = ['personas: the default crew (req-256)', 'personas: crew pictures', 'tickets: you persona'];

/**
 * A board's persona files are tracked: the seed is committed (the fixture writes it when the app starts), so a deletion is a commit of removals.
 * The engine makes its own commits in this vault, and two commits at once collide on `index.lock` (D-65), so the spec commits only after
 * both of the engine's are in the log -- its work observed where it lands, not a clock.
 */
async function trackSeed(vaultDir: string): Promise<void> {
  await expect
    .poll(
      () => {
        try {
          const subjects = git(vaultDir, 'log', '--format=%s').split('\n');
          return ENGINE_COMMITS.filter((subject) => subjects.includes(subject));
        } catch {
          return []; // a repository without a commit yet
        }
      },
      { message: 'the engine has made its own commits in the board', timeout: 60_000 },
    )
    .toEqual(ENGINE_COMMITS);
  git(vaultDir, 'add', '-A');
  git(vaultDir, '-c', 'user.name=Spec', '-c', 'user.email=spec@example.test', 'commit', '-q', '-m', 'seed');
}

async function openPersona(page: Page, id: string, vaultDir: string): Promise<void> {
  await openCrew(page);
  await trackSeed(vaultDir);
  await page.locator(`.desk-team [data-persona="${id}"]`).first().click();
  await page.locator('.desk-detail-head .persona-edit-btn').click();
  await expect(page.locator('.persona-page .persona-ed-view .cm-content').filter({ visible: true })).toBeVisible({ timeout: 15_000 });
}

test('a persona is deleted from its page by typing its name, in one commit, and leaves the Crew list', async ({ page, vaultDir }, testInfo) => {
  test.setTimeout(150_000);
  await openPersona(page, 'ralf', vaultDir);
  const personas = path.join(vaultDir, 'tickets', '_meta', 'personas');
  const body = page.locator('.persona-page').filter({ visible: true });
  await body.getByRole('button', { name: 'Delete persona…', exact: true }).click();

  const ask = page.getByRole('alertdialog');
  await expect(ask).toBeVisible();
  await expect(ask.getByRole('heading')).toHaveText('Delete Ralf?');
  const field = ask.locator('[data-field="delete-confirm"]');
  const confirm = ask.getByRole('button', { name: 'Delete', exact: true });
  await expect(confirm).toBeDisabled();
  await field.fill('ralf');
  await expect(confirm).toBeDisabled();
  await field.fill('Ralf ');
  await expect(confirm).toBeDisabled();
  await field.fill('Ralf');
  await expect(confirm).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('persona-delete-ask.png') });
  await testInfo.attach('persona-delete-ask', { path: testInfo.outputPath('persona-delete-ask.png'), contentType: 'image/png' });

  await confirm.click();
  await expect(ask).toHaveCount(0, { timeout: 15_000 });

  // The folder is gone in one commit; the chat file and the ticket stay.
  await expect.poll(() => fs.existsSync(path.join(personas, 'ralf'))).toBe(false);
  // (found by its subject: the board may hold further commits)
  const removal = git(vaultDir, 'log', '--format=%H', '--fixed-strings', '--grep', 'personas: ralf removed').split('\n');
  expect(removal).toHaveLength(1);
  const shown = git(vaultDir, 'show', '--name-status', '--format=', removal[0]!).split('\n');
  expect(shown.every((line) => line.startsWith('D\t'))).toBe(true);
  expect(shown.map((line) => line.split('\t')[1]).sort()).toEqual([
    'tickets/_meta/personas/ralf/avatar.png',
    'tickets/_meta/personas/ralf/memory.md',
    'tickets/_meta/personas/ralf/persona.md',
    'tickets/_meta/personas/ralf/prompt.md',
    'tickets/_meta/personas/ralf/skills/review/SKILL.md',
  ]);
  expect(fs.existsSync(path.join(vaultDir, 'tickets', '_meta', 'chat', 'ralf-2026-11-09.md'))).toBe(true);
  expect(fs.existsSync(path.join(vaultDir, 'tickets', '10-inbox', 'T-0001.md'))).toBe(true);
  expect(fs.existsSync(path.join(personas, 'ben', 'persona.md'))).toBe(true);

  // The page hands over to the Crew tab, whose list no longer shows the persona.
  await expect(page.locator('.desk-team').filter({ visible: true })).toBeVisible();
  await expect(page.locator('.desk-team [data-persona="ralf"]')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator('.desk-team [data-persona="ben"]').first()).toBeVisible();
});

test('a persona a pipeline column pins is refused with the column named, and stays', async ({ page, vaultDir }) => {
  test.setTimeout(150_000);
  await openPersona(page, 'ben', vaultDir);
  const body = page.locator('.persona-page').filter({ visible: true });
  await body.getByRole('button', { name: 'Delete persona…', exact: true }).click();
  const ask = page.getByRole('alertdialog');
  await ask.locator('[data-field="delete-confirm"]').fill('Ben');
  await ask.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(ask.getByRole('alert')).toHaveText('The column Build pins Ben. Unpin it first.', { timeout: 15_000 });
  expect(fs.existsSync(path.join(vaultDir, 'tickets', '_meta', 'personas', 'ben', 'persona.md'))).toBe(true);
  await ask.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(ask).toHaveCount(0);
  await expect(body.locator('.persona-head-name')).toHaveText('Ben');
});

test('a seeded crew persona is deleted the same way and the marker keeps it deleted', async ({ page, vaultDir }) => {
  test.setTimeout(150_000);
  // The engine seeds Paul and Tessa into this board when it starts (req-256); Ben and Ralf are the fixture's own.
  await openPersona(page, 'paul', vaultDir);
  const body = page.locator('.persona-page').filter({ visible: true });
  await body.getByRole('button', { name: 'Delete persona…', exact: true }).click();
  const ask = page.getByRole('alertdialog');
  await ask.locator('[data-field="delete-confirm"]').fill('Paul');
  await ask.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(ask).toHaveCount(0, { timeout: 15_000 });
  await expect.poll(() => fs.existsSync(path.join(vaultDir, 'tickets', '_meta', 'personas', 'paul'))).toBe(false);
  expect(git(vaultDir, 'log', '--format=%s', '--fixed-strings', '--grep', 'personas: paul removed')).toBe('personas: paul removed');
  expect(fs.readFileSync(path.join(vaultDir, 'tickets', '_meta', 'crew.md'), 'utf8')).toMatch(/seeded-crew:.*paul/);
  await expect(page.locator('.desk-team [data-persona="paul"]')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator('.desk-team [data-persona="tessa"]').first()).toBeVisible();
});
