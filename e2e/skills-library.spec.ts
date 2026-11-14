import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test, expect, type ElectronApplication, type Page } from './fixtures/drey';
import { startFakeGithub, type FakeGithubServer } from './fixtures/fake-github';

/**
 * Settings → Skills library on the real engine (req-289, board 7o
 * `DeskSkillsLibrary`): Drey Service in a home of its own, GitHub a local
 * fake (`DREY_GITHUB_API_URL` / `DREY_GITHUB_RAW_URL`), so nothing reaches
 * the network. Two sources are fetched from the page (one commit each, the
 * folders in `_meta/skills/`, the record in `_meta/skill-sources.md`), the
 * newer tag shows as *Update to v1.5*, the Add from GitHub row is left open
 * as the board draws it for the screenshot
 * `test-results/fidelity/DeskSkillsLibrary-built.png` (1440×900); then the
 * update (one more commit) and a source's removal, asked in its row.
 */

const engineHome = fs.mkdtempSync(path.join(os.tmpdir(), 'drey-e2e-home-'));
process.env['USERPROFILE'] = engineHome;
process.env['HOME'] = engineHome;
const OUT = path.resolve(__dirname, '..', 'test-results', 'fidelity');

const C14 = '1'.repeat(40);
const C15 = '2'.repeat(40);
const CMAIN = '3'.repeat(40);
const CPW = '4'.repeat(40);

/** A SKILL.md about `tokens` long (the board's sizes, roughly). */
function skill(name: string, description: string, tokens: number): string {
  const line = `Follow the ${description.toLowerCase()} rules of this crew.`;
  const body = Array.from({ length: Math.max(1, Math.round((tokens * 4) / (line.length + 1))) }, () => line).join('\n');
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${description}\n\n${body}\n`;
}

let github: FakeGithubServer;

test.beforeAll(async () => {
  github = await startFakeGithub({
    'acme/skills': {
      refs: { 'v1.4': C14, 'v1.5': C15 },
      tags: ['v1.3', 'v1.4', 'v1.5'],
      commits: {
        [C14]: { 'README.md': '# acme skills', 'playwright-e2e/SKILL.md': skill('playwright-e2e', 'Playwright e2e', 1200), 'playwright-e2e/scripts/run.sh': 'npx playwright test\n', 'angular-standalone/SKILL.md': skill('angular-standalone', 'Angular standalone', 730) },
        [C15]: { 'playwright-e2e/SKILL.md': skill('playwright-e2e', 'Playwright e2e', 1250), 'angular-standalone/SKILL.md': skill('angular-standalone', 'Angular standalone', 730) },
      },
    },
    'anthropics/skills': { refs: { main: CMAIN }, tags: [], commits: { [CMAIN]: { 'security-review/SKILL.md': skill('security-review', 'Security review', 1500) } } },
    'microsoft/playwright-skills': { refs: { main: CPW }, tags: [], commits: { [CPW]: { 'skills/e2e/SKILL.md': skill('e2e', 'End to end', 300) } } },
  });
  process.env['DREY_GITHUB_API_URL'] = github.apiUrl;
  process.env['DREY_GITHUB_RAW_URL'] = github.rawUrl;
});

test.afterAll(async () => {
  try {
    const lock = JSON.parse(fs.readFileSync(path.join(engineHome, '.drey-engine', 'service.lock'), 'utf8')) as { pid?: number };
    if (typeof lock.pid === 'number') {
      process.kill(lock.pid);
    }
  } catch {
    // no engine was started, or it is already gone
  }
  await github?.close();
  fs.rmSync(engineHome, { recursive: true, force: true });
});

const PIPELINE = ['---', 'phases:', '  - { id: inbox, title: Inbox, handover: manual }', '  - { id: build, title: Building, handover: manual }', '  - { id: done, title: Done, handover: none }', '---', 'The phases.', ''].join('\n');
const TICKET = ['---', 'id: T-0017', 'title: "A8 large modules"', 'priority: normal', "entered-inbox: '2026-11-01T09:00:00Z'", '---', '', '## Description', '', 'Split the large modules.', ''].join('\n');

test.use({
  seedVault: {
    'tickets/_meta/pipeline.md': PIPELINE,
    'tickets/20-build/T-0017.md': TICKET,
    'tickets/_meta/skills/test-first/SKILL.md': skill('test-first', 'Test first', 420),
    'tickets/_meta/skills/go-conventions/SKILL.md': skill('go-conventions', 'Go conventions', 880),
    'tickets/_meta/skills/adr-writing/SKILL.md': skill('adr-writing', 'ADR writing', 610),
    'tickets/_meta/skills/commit-messages/SKILL.md': skill('commit-messages', 'Commit messages', 260),
    'Notes.md': '# Notes\n',
  },
  launchArgs: ['--force-device-scale-factor=1'],
  appConfig: { plugins: { disabled: ['sample', 'templates', 'browser', 'drawio', 'ocr', 'meeting'] }, spellcheck: { enabled: false } },
});

/** Board 7o's Used by: who selects which skill. */
const SELECTIONS: Record<string, readonly string[]> = {
  ben: ['test-first', 'playwright-e2e', 'security-review', 'commit-messages', 'angular-standalone'],
  ralf: ['test-first', 'go-conventions', 'security-review', 'commit-messages'],
  paul: ['test-first', 'adr-writing', 'commit-messages'],
  tessa: ['playwright-e2e', 'commit-messages'],
};

const git = (cwd: string, ...args: string[]): string => execFileSync('git', ['-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const commitCount = (dir: string): number => Number(git(dir, 'rev-list', '--count', 'HEAD').trim());

async function sizeWindow(app: ElectronApplication, width: number, height: number): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow }, size) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (win.webContents.getURL().startsWith('app://')) {
          win.setContentSize(size.width, size.height);
        }
      }
    },
    { width, height },
  );
}

/** The seeded crew's selections and Paul's own skill, written once the engine has seeded the crew; then the vault becomes a git repository. */
async function seedCrew(vaultDir: string): Promise<void> {
  const personas = path.join(vaultDir, 'tickets', '_meta', 'personas');
  await expect.poll(() => Object.keys(SELECTIONS).every((id) => fs.existsSync(path.join(personas, id, 'persona.md'))), { timeout: 60_000 }).toBe(true);
  for (const [id, skills] of Object.entries(SELECTIONS)) {
    const file = path.join(personas, id, 'persona.md');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^skills: \[\]$/m, `skills: [${skills.join(', ')}]`));
  }
  fs.mkdirSync(path.join(personas, 'paul', 'skills', 'release-notes'), { recursive: true });
  fs.writeFileSync(path.join(personas, 'paul', 'skills', 'release-notes', 'SKILL.md'), skill('release-notes', 'Release notes', 340));
  git(vaultDir, 'init', '-q');
  git(vaultDir, '-c', 'user.name=e2e', '-c', 'user.email=e2e@example.invalid', 'add', '-A');
  git(vaultDir, '-c', 'user.name=e2e', '-c', 'user.email=e2e@example.invalid', 'commit', '-q', '-m', 'seed');
  git(vaultDir, 'config', 'user.name', 'e2e');
  git(vaultDir, 'config', 'user.email', 'e2e@example.invalid');
}

/** Board 7o's frame: both side docks folded, the ticket T-0017 open beside the Settings tab. */
async function boardFrame(page: Page, app: ElectronApplication): Promise<void> {
  await page.evaluate(() => {
    const ids = [...document.querySelectorAll<HTMLElement>('app-dock-strip button[data-widget]')].map((b) => b.dataset['widget'] ?? '');
    const saved = JSON.parse(localStorage.getItem('drey.dock') ?? '{}') as { active: string; views: Record<string, Record<string, unknown>> };
    const view = saved.views[saved.active];
    saved.views[saved.active] = { ...view, dock: { left: ids, right: [], bottom: [] }, open: Object.fromEntries(ids.map((id) => [id, false])), foldedSides: ['left', 'right'] };
    localStorage.setItem('drey.dock', JSON.stringify(saved));
  });
  await page.reload();
  await sizeWindow(app, 1440, 900);
  await expect(page.locator('app-titlebar [role="tab"]', { hasText: 'Work' })).toBeVisible({ timeout: 30_000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.keyboard.press('Control+p');
  await page.locator('.palette input').fill('T-0017');
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
}

async function fetchSource(page: Page, repo: string, sourcePath: string, ref: string): Promise<void> {
  const box = page.locator('.skl-addbox');
  if (await box.isHidden()) {
    await page.locator('.skl-titlerow button', { hasText: 'Add from GitHub' }).click();
  }
  await box.locator('input[aria-label="Repository"]').fill(repo);
  await box.locator('input[aria-label="Path"]').fill(sourcePath);
  await box.locator('input[aria-label="Ref"]').fill(ref);
  await box.locator('button', { hasText: 'Fetch' }).click();
  await expect(box).toBeHidden({ timeout: 30_000 });
}

test('req-289: Settings → Skills library fetches, updates and removes GitHub sources on the real engine (board 7o)', async ({ page, electronApp, vaultDir }) => {
  test.setTimeout(300_000);
  fs.mkdirSync(OUT, { recursive: true });
  await sizeWindow(electronApp, 1440, 900);
  await expect(page.locator('app-titlebar [role="tab"]', { hasText: 'Work' })).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press('Control+2');
  await seedCrew(vaultDir);
  await boardFrame(page, electronApp);
  await page.locator('app-status-bar .settings').click();
  await page.locator('app-settings .category', { hasText: 'Tickets' }).first().click();
  await page.locator('app-settings .section-entry', { hasText: 'Skills library' }).click();
  const lib = page.locator('.skl');
  await expect(lib.locator('.skl-skill')).toHaveCount(5, { timeout: 60_000 });
  // The page's first look asked GitHub nothing: there was no source yet.
  expect(github.requests).toEqual([]);

  // Fetch: the folders, the record, one commit.
  const before = commitCount(vaultDir);
  await fetchSource(page, 'github.com/acme/skills', '', 'v1.4');
  await expect(lib.locator('.skl-source')).toHaveCount(1);
  await expect.poll(() => commitCount(vaultDir)).toBe(before + 1);
  expect(git(vaultDir, 'log', '-1', '--format=%s').trim()).toBe('skills: github.com/acme/skills fetched at v1.4 (2 skills)');
  expect(fs.readFileSync(path.join(vaultDir, 'tickets/_meta/skills/playwright-e2e/scripts/run.sh'), 'utf8')).toBe('npx playwright test\n');
  const record = fs.readFileSync(path.join(vaultDir, 'tickets/_meta/skill-sources.md'), 'utf8');
  expect(record).toContain('repo: github.com/acme/skills');
  expect(record).toMatch(new RegExp(`commit: "?${C14}"?`));
  await expect(lib.locator('.skl-source').first()).toContainText('Update to v1.5');
  await fetchSource(page, 'anthropics/skills', '', 'main');
  await expect.poll(() => commitCount(vaultDir)).toBe(before + 2);

  // Board 7o's state: the two sources, the eight skills, the Add from GitHub row open with what the owner typed.
  await expect(lib.locator('.skl-source')).toHaveCount(2);
  await expect(lib.locator('.skl-skill-name')).toHaveText(['Adr writing', 'Angular standalone', 'Commit messages', 'Go conventions', 'Playwright e2e', 'Release notes', 'Security review', 'Test first']);
  await expect(lib.locator('[data-skill="playwright-e2e"] .skl-user')).toHaveCount(2);
  await expect(lib.locator('[data-skill="playwright-e2e"] .skl-skill-source')).toHaveText('github.com/acme/skills');
  await expect(lib.locator('[data-skill="paul/release-notes"]')).toContainText('own—');
  await lib.locator('.skl-titlerow button', { hasText: 'Add from GitHub' }).click();
  const box = page.locator('.skl-addbox');
  await box.locator('input[aria-label="Repository"]').fill('github.com/microsoft/playwright-skills');
  await box.locator('input[aria-label="Path"]').fill('skills/e2e');
  await page.locator('app-settings .section-entry', { hasText: 'Skills library' }).click();
  await page.mouse.move(0, 0);
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, 'DeskSkillsLibrary-built.png') });

  // The path: only the folder under it.
  await box.locator('button', { hasText: 'Fetch' }).click();
  await expect(box).toBeHidden({ timeout: 30_000 });
  await expect(lib.locator('.skl-source')).toHaveCount(3);
  await expect(lib.locator('[data-skill="e2e"] .skl-skill-source')).toHaveText('github.com/microsoft/playwright-skills/skills/e2e');

  // Update to v1.5: one more commit, the record at the new ref, the button gone.
  const acme = lib.locator('.skl-source[data-source="github.com/acme/skills"]');
  await acme.locator('button', { hasText: 'Update to v1.5' }).click();
  await expect(acme).toContainText('ref v1.5');
  await expect(acme.locator('button', { hasText: 'Update to' })).toHaveCount(0);
  expect(git(vaultDir, 'log', '-1', '--format=%s').trim()).toBe('skills: github.com/acme/skills updated at v1.5 (2 skills)');
  // v1.5 dropped the script: the update removed it in the same commit.
  expect(fs.existsSync(path.join(vaultDir, 'tickets/_meta/skills/playwright-e2e/scripts/run.sh'))).toBe(false);
  expect(git(vaultDir, 'show', '--name-status', '--format=', 'HEAD')).toContain('D	tickets/_meta/skills/playwright-e2e/scripts/run.sh');

  // Remove asks in the row; Remove takes the folders and the record entry.
  const count = commitCount(vaultDir);
  await lib.locator('.skl-source[data-source="github.com/anthropics/skills"] button[aria-label="Remove source"]').click();
  await expect(lib.locator('.skl-confirm')).toContainText('Remove github.com/anthropics/skills and its 1 skill?');
  await lib.locator('.skl-confirm button', { hasText: 'Remove' }).click();
  await expect(lib.locator('.skl-source')).toHaveCount(2);
  await expect.poll(() => commitCount(vaultDir)).toBe(count + 1);
  expect(fs.existsSync(path.join(vaultDir, 'tickets/_meta/skills/security-review'))).toBe(false);
  expect(github.requests.every((request) => request.startsWith('/api/repos/') || request.startsWith('/raw/'))).toBe(true);
});
