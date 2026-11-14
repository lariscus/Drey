import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test, expect, type ElectronApplication, type Page } from './fixtures/drey';

/**
 * req-304: Settings → Projects' folders and repositories on the real engine in
 * a home of its own, the system folder picker answered by the spec (a native
 * dialog cannot be driven): a git folder — here a subfolder of a checkout — is
 * listed as a repository and registered in `repos.md` with no second choice, a
 * plain folder becomes a folder of the project, *From folder…* refuses a plain
 * one, and a Git URL (a local bare repository, so no network) is cloned into
 * the folder the owner picks. Every change is one commit in the tickets vault.
 */

const engineHome = fs.mkdtempSync(path.join(os.tmpdir(), 'drey-e2e-home-'));
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'drey-e2e-work-'));
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
  fs.rmSync(work, { recursive: true, force: true });
});

const IDENT = ['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.invalid', '-c', 'core.autocrlf=false'];
const git = (cwd: string, ...args: string[]): string => execFileSync('git', [...IDENT, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const commitCount = (dir: string): number => Number(git(dir, 'rev-list', '--count', 'HEAD').trim());
const slashes = (p: string): string => p.replace(/\\/g, '/');

const PIPELINE = ['---', 'phases:', '  - { id: inbox, title: Inbox, handover: manual }', '  - { id: done, title: Done, handover: none }', '---', 'The phases.', ''].join('\n');
const REPOS = ['---', 'repos:', '  drey:', '    url: https://example.invalid/drey.git', '---', 'Repositories.', ''].join('\n');
const PROJECT = ['---', 'name: Drey', 'color: "#8ecbef"', 'repos: [drey]', '---', 'A note app.', ''].join('\n');

test.use({
  seedVault: {
    'tickets/_meta/pipeline.md': PIPELINE,
    'tickets/_meta/repos.md': REPOS,
    'tickets/_meta/projects/drey.md': PROJECT,
    'Notes.md': '# Notes\n',
  },
  appConfig: { plugins: { disabled: ['sample', 'templates', 'browser', 'drawio', 'ocr', 'meeting'] }, spellcheck: { enabled: false } },
});

/** The next picker answers with `folder`. */
async function answerPicker(app: ElectronApplication, folder: string): Promise<void> {
  await app.evaluate(({ dialog }, answer) => {
    dialog.showOpenDialog = (() => Promise.resolve({ canceled: false, filePaths: [answer] })) as typeof dialog.showOpenDialog;
  }, folder);
}

/** A window wide enough for the page's two columns, both side docks folded away. */
async function roomForSettings(app: ElectronApplication, page: Page): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.webContents.getURL().startsWith('app://')) {
        win.setContentSize(1440, 960);
      }
    }
  });
  await page.keyboard.press('Control+b');
  await page.keyboard.press('Control+Alt+b');
}

async function openProjects(page: Page): Promise<void> {
  await page.locator('app-status-bar .settings').click();
  await page.locator('app-settings .category', { hasText: 'Projects' }).first().click();
  await expect(page.locator('.prj-item').first()).toBeVisible({ timeout: 30_000 });
}

test('req-304: a picked git folder becomes a repository, a plain folder a folder, a Git URL a clone', async ({ page, electronApp, vaultDir }) => {
  test.setTimeout(240_000);

  // The checkout (with a subfolder), a plain folder, and a bare repository to clone from.
  const alpha = path.join(work, 'alpha');
  fs.mkdirSync(path.join(alpha, 'src'), { recursive: true });
  fs.writeFileSync(path.join(alpha, 'src', 'a.txt'), 'a\n');
  git(alpha, 'init', '-q', '-b', 'main');
  git(alpha, 'add', '-A');
  git(alpha, 'commit', '-q', '-m', 'first');
  git(alpha, 'remote', 'add', 'origin', 'https://example.invalid/alpha.git');
  const plain = path.join(work, 'plain');
  fs.mkdirSync(plain);
  const seed = path.join(work, 'seed');
  fs.mkdirSync(seed);
  fs.writeFileSync(path.join(seed, 'b.txt'), 'b\n');
  git(seed, 'init', '-q', '-b', 'main');
  git(seed, 'add', '-A');
  git(seed, 'commit', '-q', '-m', 'first');
  const bare = path.join(work, 'tool.git');
  git(work, 'clone', '-q', '--bare', seed, bare);
  const clones = path.join(work, 'clones');
  fs.mkdirSync(clones);

  git(vaultDir, 'init', '-q');
  git(vaultDir, 'add', '-A');
  git(vaultDir, 'commit', '-q', '-m', 'seed');
  git(vaultDir, 'config', 'user.name', 'e2e');
  git(vaultDir, 'config', 'user.email', 'e2e@example.invalid');
  const projectFile = (): string => fs.readFileSync(path.join(vaultDir, 'tickets/_meta/projects/drey.md'), 'utf8');
  const reposFile = (): string => fs.readFileSync(path.join(vaultDir, 'tickets/_meta/repos.md'), 'utf8');

  await expect(page.locator('app-titlebar [role="tab"]', { hasText: 'Work' })).toBeVisible({ timeout: 30_000 });
  await roomForSettings(electronApp, page);
  await openProjects(page);
  const chips = page.locator('.prj-chip');
  await expect(chips).toHaveText(['dreyprimary']);

  // Add folder, a folder inside a git checkout: listed as the repository, registered, no second dialog.
  let before = commitCount(vaultDir);
  await answerPicker(electronApp, path.join(alpha, 'src'));
  await page.locator('.prj-add', { hasText: 'Add folder' }).click();
  await expect(chips).toHaveText(['dreyprimary', 'alpha']);
  await expect(page.locator('.prj-picker')).toBeHidden();
  await expect(page.locator('.prj-status')).toHaveText('Saved · committed just now');
  await expect.poll(() => commitCount(vaultDir)).toBe(before + 1);
  expect(reposFile()).toMatch(/alpha:\s+url: https:\/\/example\.invalid\/alpha\.git/);
  expect(reposFile()).toContain(slashes(alpha));
  expect(projectFile()).toMatch(/repos:[\s\S]*alpha/);
  expect(git(vaultDir, 'log', '-1', '--format=%s').trim()).toBe('projects: Drey — repository alpha added (req-304)');

  // Add folder, a plain folder: a read-only folder of the project.
  before = commitCount(vaultDir);
  await answerPicker(electronApp, plain);
  await page.locator('.prj-add', { hasText: 'Add folder' }).click();
  await expect(page.locator('.prj-folder-path')).toHaveText([plain]);
  await expect(page.locator('.prj-folder .prj-tag')).toHaveText(['Read']);
  await expect.poll(() => commitCount(vaultDir)).toBe(before + 1);
  expect(projectFile()).toContain('folders');

  // From folder…, a plain folder: refused in the picker, nothing written.
  before = commitCount(vaultDir);
  await page.locator('.prj-add', { hasText: 'Add repository' }).click();
  const list = page.locator('.prj-picker-list');
  await list.selectOption({ label: 'From folder…' });
  await page.locator('.prj-picker-actions button').first().click();
  await expect(page.locator('.prj-picker-error')).toHaveText('No git repository in that folder');
  expect(commitCount(vaultDir)).toBe(before);

  // A Git URL: asks where, clones the local bare repository, lists the checkout, one commit.
  await answerPicker(electronApp, clones);
  await page.locator('.prj-url').fill(`file:///${slashes(bare)}`);
  await page.locator('.prj-url').press('Enter');
  await expect(chips).toHaveText(['dreyprimary', 'alpha', 'tool'], { timeout: 60_000 });
  expect(fs.existsSync(path.join(clones, 'tool', '.git'))).toBe(true);
  expect(fs.readFileSync(path.join(clones, 'tool', 'b.txt'), 'utf8').trim()).toBe('b');
  await expect.poll(() => commitCount(vaultDir)).toBe(before + 1);
  expect(reposFile()).toMatch(/tool:\s+url: file:\/\/\/.*tool\.git/);
  expect(reposFile()).toContain(slashes(path.join(clones, 'tool')));
  expect(git(vaultDir, 'log', '-1', '--format=%s').trim()).toBe('projects: Drey — repository tool added (req-304)');

  // The same URL into the same folder: the existing checkout is named, not overwritten.
  await page.locator('.prj-add', { hasText: 'Add repository' }).click();
  await page.locator('.prj-url').fill(`file:///${slashes(bare)}`);
  await page.locator('.prj-url').press('Enter');
  await expect(page.locator('.prj-picker-error')).toContainText('already exists and is not empty');
  await expect(chips).toHaveText(['dreyprimary', 'alpha', 'tool']);
});
