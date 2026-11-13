import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test, expect, type ElectronApplication, type Page } from './fixtures/drey';

/**
 * Settings → Projects (req-284, board 7m `DeskProjects`) on the real engine
 * in a home of its own: the projects listed with their tickets, the detail
 * of the first, a vault access changed (one commit in the tickets vault's
 * git), a name changed (one more), and the inline repository picker open.
 * The screenshot `test-results/fidelity/DeskProjects.png` (1440×960) is the
 * board comparison the changelog names.
 */

const engineHome = fs.mkdtempSync(path.join(os.tmpdir(), 'drey-e2e-home-'));
process.env['USERPROFILE'] = engineHome;
process.env['HOME'] = engineHome;

function stopEngine(): void {
  try {
    const lock = JSON.parse(fs.readFileSync(path.join(engineHome, '.drey-engine', 'service.lock'), 'utf8')) as { pid?: number };
    if (typeof lock.pid === 'number') {
      process.kill(lock.pid);
    }
  } catch {
    // no engine was started, or it is already gone
  }
}

test.afterAll(() => {
  stopEngine();
  fs.rmSync(engineHome, { recursive: true, force: true });
});

const OUT = path.resolve(__dirname, '..', 'test-results', 'fidelity');

const PIPELINE = ['---', 'phases:', '  - { id: inbox, title: Inbox, handover: manual }', '  - { id: build, title: Building, handover: manual }', '  - { id: done, title: Done, handover: none }', '---', 'The phases.', ''].join('\n');

const REPOS = ['---', 'repos:', ...['drey', 'lariscus', 'homelab', 'smoke'].flatMap((name) => [`  ${name}:`, `    url: https://example.invalid/${name}.git`]), '---', 'Repositories.', ''].join('\n');

const project = (name: string, color: string, repos: string[], extra: string[], purpose: string): string => ['---', `name: ${name}`, `color: "${color}"`, `repos: [${repos.join(', ')}]`, ...extra, '---', purpose, ''].join('\n');

const DREY = project(
  'Drey',
  '#8ecbef',
  ['drey'],
  ['folders:', '  - E:\\specs\\drey-shared', 'vaults:', '  Drey notes: write', '  Private: none', '  Lariscus notes: read'],
  'A local, topic-based note app for Windows with a **crew of agents** that works tickets. Notes are plain Markdown; agents change a vault only where this project allows it. Product decisions live in [[Drey notes]].',
);

function ticket(id: number, projectId: string): string {
  const tid = `T-${String(id).padStart(4, '0')}`;
  return ['---', `id: ${tid}`, `title: "Ticket ${id}"`, `project: ${projectId}`, 'priority: normal', "entered-inbox: '2026-11-01T09:00:00Z'", '---', '', '## Description', '', 'Something to do.', ''].join('\n');
}

const seed: Record<string, string> = {
  'tickets/_meta/pipeline.md': PIPELINE,
  'tickets/_meta/repos.md': REPOS,
  'tickets/_meta/projects/drey.md': DREY,
  'tickets/_meta/projects/lariscus.md': project('Lariscus', '#f2cfae', ['lariscus'], [], 'An app.'),
  'tickets/_meta/projects/home-lab.md': project('Home lab', '#bfe3cd', ['homelab'], [], 'The servers.'),
  'Notes.md': '# Notes\n',
};
let n = 100;
seed['tickets/20-build/T-0017.md'] = ticket(17, 'drey').replace('title: "Ticket 17"', 'title: "A8 large modules"');
for (const [id, count] of [['drey', 13], ['lariscus', 9], ['home-lab', 3]] as const) {
  for (let i = 0; i < count; i++, n++) {
    seed[`tickets/10-inbox/T-0${n}.md`] = ticket(n, id);
  }
}

test.use({
  seedVault: seed,
  extraVaults: { 'Drey notes': { 'a.md': '# a\n' }, 'Work notes': { 'b.md': '# b\n' }, Private: { 'c.md': '# c\n' }, Recipes: { 'd.md': '# d\n' } },
  launchArgs: ['--force-device-scale-factor=1'],
  appConfig: { plugins: { disabled: ['sample', 'templates', 'browser', 'drawio', 'ocr', 'meeting'] }, spellcheck: { enabled: false } },
});

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

const git = (cwd: string, ...args: string[]): string => execFileSync('git', ['-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

function commitCount(dir: string): number {
  return Number(git(dir, 'rev-list', '--count', 'HEAD').trim());
}

async function openProjects(page: Page): Promise<void> {
  await page.locator('app-status-bar .settings').click();
  await page.locator('app-settings .category', { hasText: 'Projects' }).first().click();
  await expect(page.locator('.prj-item').first()).toBeVisible({ timeout: 30_000 });
}

test('req-284: Settings → Projects lists, edits and commits each change (board 7m)', async ({ page, electronApp, vaultDir }) => {
  test.setTimeout(240_000);
  fs.mkdirSync(OUT, { recursive: true });
  git(vaultDir, 'init', '-q');
  git(vaultDir, '-c', 'user.name=e2e', '-c', 'user.email=e2e@example.invalid', 'add', '-A');
  git(vaultDir, '-c', 'user.name=e2e', '-c', 'user.email=e2e@example.invalid', 'commit', '-q', '-m', 'seed');
  git(vaultDir, 'config', 'user.name', 'e2e');
  git(vaultDir, 'config', 'user.email', 'e2e@example.invalid');
  await sizeWindow(electronApp, 1440, 960);
  await expect(page.locator('app-titlebar [role="tab"]', { hasText: 'Work' })).toBeVisible({ timeout: 30_000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.keyboard.press('Control+2');
  await page.waitForTimeout(500);
  // Board 7m: both side docks folded, the ticket T-0017 open beside the Settings tab.
  await page.evaluate(() => {
    const ids = [...document.querySelectorAll<HTMLElement>('app-dock-strip button[data-widget]')].map((b) => b.dataset['widget'] ?? '');
    const saved = JSON.parse(localStorage.getItem('drey.dock') ?? '{}') as { active: string; views: Record<string, Record<string, unknown>> };
    const view = saved.views[saved.active];
    saved.views[saved.active] = { ...view, dock: { left: ids, right: [], bottom: [] }, open: Object.fromEntries(ids.map((id) => [id, false])), foldedSides: ['left', 'right'] };
    localStorage.setItem('drey.dock', JSON.stringify(saved));
  });
  await page.reload();
  await sizeWindow(electronApp, 1440, 960);
  await expect(page.locator('app-titlebar [role="tab"]', { hasText: 'Work' })).toBeVisible({ timeout: 30_000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.keyboard.press('Control+p');
  await page.locator('.palette input').fill('T-0017');
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  await openProjects(page);

  await expect(page.locator('.prj-item')).toHaveText(['Drey14 tickets', 'Home lab3 tickets', 'Lariscus9 tickets']);
  await expect(page.locator('.prj-title')).toHaveText('Drey');
  const vaults = page.locator('.prj-vault');
  await expect(vaults.locator('.prj-vault-name')).toHaveText(['Drey notes', 'Work notes', 'Private', 'Recipes', 'Lariscus notes']);
  await expect(vaults.nth(4)).toContainText('not on this device');
  await expect(vaults.nth(4).locator('button').first()).toBeDisabled();

  // A vault access: one commit.
  const before = commitCount(vaultDir);
  await vaults.nth(1).locator('.prj-seg-btn', { hasText: 'Read' }).click();
  await expect(page.locator('.prj-status')).toHaveText('Saved · committed just now');
  await expect.poll(() => commitCount(vaultDir)).toBe(before + 1);
  expect(fs.readFileSync(path.join(vaultDir, 'tickets/_meta/projects/drey.md'), 'utf8')).toContain('Work notes: read');
  await expect(vaults.nth(1).locator('[aria-checked="true"]')).toHaveText('Read');

  // A name: one more commit, the id (the file) stays.
  const name = page.locator('.prj-input');
  await name.fill('Drey app');
  await name.press('Enter');
  await expect(page.locator('.prj-title')).toHaveText('Drey app');
  await expect.poll(() => commitCount(vaultDir)).toBe(before + 2);
  expect(git(vaultDir, 'log', '-1', '--format=%s').trim()).toBe('projects: Drey app changed (req-284)');
  await name.fill('Drey');
  await name.press('Enter');
  await expect(page.locator('.prj-title')).toHaveText('Drey');

  // The inline picker: the other repositories of repos.md, then From folder….
  await page.locator('.prj-add', { hasText: 'Add repository' }).click();
  await expect(page.locator('.prj-picker-list option')).toHaveText(['lariscus', 'homelab', 'smoke', 'From folder…']);
  await page.locator('.prj-picker-list').selectOption('lariscus');
  await page.mouse.move(0, 0);
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, 'DeskProjects.png') });
});
