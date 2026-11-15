import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect, type ElectronApplication, type Page } from './fixtures/drey';
import { arrangeDocks } from './fixtures/fidelity-desk';
import { SEEDS, byTitle, dkIdOf, fieldOf, liveRun, seedStore, seedVaultOf, type Seed } from './fixtures/persona-board-seed';

/**
 * req-285: the title bar's project filter (board 7n `DeskProjectFilter`) in
 * the running app over the real engine, on a scratch dricket store whose
 * tickets carry `x-project` and a meta vault with three projects; req-308:
 * one project is always active — no *All projects*, no *Unassigned*, a view
 * without a stored choice shows the board's first project. Drey is active in
 * the Work view: the board shows only Drey's cards, every persona column
 * stays with its load (`Counts every project`), the Files panel lists Drey's
 * vaults and folder, a capture lands in Drey, and Notes starts on the first
 * project of its own. Screenshot `test-results/fidelity/DeskProjectFilter.png`
 * (1440×900, the menu open). Everything lives under a temp dir with a home of
 * its own. Skipped when `dk` is missing.
 */
const bin = process.env['DREY_DK_BIN'] ?? 'dk';

function dkVersionOk(): boolean {
  try {
    const out = execFileSync(bin, ['--version'], { encoding: 'utf8', windowsHide: true });
    const m = /version:\s*v?(\d+)\.(\d+)\.(\d+)/.exec(out);
    return m !== null && (Number(m[1]) > 0 || Number(m[2]) > 6 || (Number(m[2]) === 6 && Number(m[3]) >= 2));
  } catch {
    return false;
  }
}
const haveDk = dkVersionOk();

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dpf-'));
const home = path.join(root, 'home');
const storeDir = path.join(root, 's');
const dataDir = path.join(root, 'd');
const shared = path.join(root, 'drey-shared');
fs.mkdirSync(home, { recursive: true });
fs.mkdirSync(shared, { recursive: true });
fs.writeFileSync(path.join(shared, 'schema.md'), '# Schema\n');
fs.writeFileSync(path.join(shared, 'glossary.md'), '# Glossary\n');
process.env['USERPROFILE'] = home;
process.env['HOME'] = home;
process.env['DK_OWNER'] = 'henrik';
process.env['GIT_AUTHOR_NAME'] = 'Board Test';
process.env['GIT_AUTHOR_EMAIL'] = 'board@test.invalid';
process.env['GIT_COMMITTER_NAME'] = 'Board Test';
process.env['GIT_COMMITTER_EMAIL'] = 'board@test.invalid';

const dirs = { bin, root, storeDir, dataDir };
const field = fieldOf(dirs);

/** Which project each seed of the persona board belongs to; '' = Unassigned. */
const PROJECT_OF = ['drey', 'drey', 'drey', 'lariscus', 'home-lab', '', 'drey', 'drey', 'lariscus', 'drey', 'lariscus', 'drey', 'drey', 'drey', 'lariscus', 'drey', 'drey', '', 'home-lab', 'drey', 'drey', 'drey', 'lariscus', '', ''];
const SEEDS_WITH_PROJECTS: readonly Seed[] = SEEDS.map((seed, i) => (PROJECT_OF[i] ? { ...seed, extra: { ...(seed.extra ?? {}), 'x-project': PROJECT_OF[i]! } } : seed));
const DREY_IDS = SEEDS.map((_, i) => i).filter((i) => PROJECT_OF[i] === 'drey');

function stopEngine(): void {
  try {
    const lock = JSON.parse(fs.readFileSync(path.join(home, '.drey-engine', 'service.lock'), 'utf8')) as { pid?: number };
    if (typeof lock.pid === 'number') {
      process.kill(lock.pid);
    }
  } catch {
    // no engine was started, or it is already gone
  }
}

test.skip(!haveDk, 'dk >= 0.6.2 not found');

const OUT = path.resolve(__dirname, '..', 'test-results', 'fidelity');
const now = new Date();
const project = (name: string, color: string, extra: string[]): string => ['---', `name: ${name}`, `color: "${color}"`, 'repos: [drey]', ...extra, '---', `${name}.`, ''].join('\n');

test.beforeAll(() => {
  if (haveDk) {
    seedStore(dirs, SEEDS_WITH_PROJECTS);
  }
});

test.afterAll(() => {
  stopEngine();
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {
    // The engine holds files open for a moment after the kill; a leftover temp dir is harmless.
  }
});

test.use({
  seedVault: {
    ...seedVaultOf(now),
    'tickets/_meta/projects/drey.md': project('Drey', '#8ecbef', ['folders:', `  - ${shared.replaceAll('\\', '/')}`, 'vaults:', '  Drey notes: write', '  Work notes: read', '  Private: none']),
    'tickets/_meta/projects/lariscus.md': project('Lariscus', '#f2cfae', ['vaults:', '  Private: read']),
    'tickets/_meta/projects/home-lab.md': project('Home lab', '#bfe3cd', []),
  },
  extraVaults: {
    'Drey notes': { 'daily/2026-11-13.md': '# Today\n', 'specs/roadmap.md': '# Roadmap\n', 'specs/changelog.md': '# Changelog\n', 'specs/decisions.md': '# Decisions\n', 'ideas/a.md': '# a\n' },
    'Work notes': { 'meetings/m.md': '# m\n', 'reviews/r.md': '# r\n', 'Drey rollout plan.md': '# Plan\n' },
    Private: { 'diary.md': '# Diary\n' },
  },
  launchArgs: ['--force-device-scale-factor=1'],
  appConfig: { plugins: { disabled: ['sample', 'templates', 'browser', 'drawio', 'ocr', 'meeting', 'outline', 'backlinks'] }, spellcheck: { enabled: false }, widgets: { disabled: ['windows', 'calendar', 'tickets-capacity'] } },
});

test.beforeEach(({ userDataDir }) => {
  if (!haveDk) {
    return;
  }
  const dir = path.join(userDataDir, 'plugins', 'tickets');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ 'dk.store': storeDir, 'dk.dataDir': dataDir, 'dk.syncSeconds': 0 }, null, 2));
});

async function pushFleet(app: ElectronApplication): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow }, data) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('plugin:event', data);
      }
    },
    {
      pluginId: 'tickets',
      event: 'fleet-changed',
      data: {
        runs: [
          liveRun(byTitle('Weekly security audit run'), 'paul', 6),
          liveRun(byTitle('Export the vault as a zip'), 'ben', 3),
          liveRun(byTitle('Palette: recent commands'), 'ben', 11),
          liveRun(byTitle('PDF export keeps callout colors'), 'tessa', 4),
        ],
        chain: {
          configured: true,
          master: 'run',
          autopilot: { state: 'on' },
          columns: {},
          redStreak: {},
          cooldownUntil: {},
          poolSize: { opencode: 2, 'claude-code': 3 },
          personaWaits: { [byTitle('Win+H dictation hand-off')]: 'ben' },
          queue: [{ ticket: byTitle('Settings search across plugins'), persona: 'ralf', class: 'B', reason: 'capacity', line: 'waits for a B slot', detail: '', position: 1, since: now.toISOString() }],
        },
      },
    },
  );
}

async function sizeWindow(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.webContents.getURL().startsWith('app://')) {
        win.setContentSize(1440, 900);
      }
    }
  });
}

/** Board 7n's dock: the left dock with Files open and Tickets folded to its header; the right dock folded. */
async function arrange(page: Page): Promise<void> {
  await arrangeDocks(page, { left: ['Files', 'Find', 'Tickets', 'Source control'], shown: ['Files', 'Tickets'], collapsed: ['Tickets'], flexes: {} });
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('drey.dock') ?? '{}') as { active: string; views: Record<string, Record<string, unknown>> };
    saved.views[saved.active] = { ...saved.views[saved.active], foldedSides: ['right'] };
    localStorage.setItem('drey.dock', JSON.stringify(saved));
  });
}

test('req-285/req-308: the project filter always has one active project, narrows Files and the board, captures into it (board 7n)', async ({ page, electronApp }) => {
  test.setTimeout(300_000);
  fs.mkdirSync(OUT, { recursive: true });
  await sizeWindow(electronApp);
  const tabs = page.locator('[role="tablist"][aria-label="Views"] [role="tab"]');
  await expect(tabs).toHaveText(['Notes', 'Work', 'Crew'], { timeout: 30_000 });
  await tabs.filter({ hasText: 'Work' }).click();
  await page.waitForTimeout(800);
  await arrange(page);
  await page.reload();
  await sizeWindow(electronApp);
  await expect(tabs).toHaveText(['Notes', 'Work', 'Crew'], { timeout: 30_000 });
  await expect(tabs.filter({ hasText: 'Work' })).toHaveAttribute('aria-selected', 'true');
  await pushFleet(electronApp);

  // The filter sits right of the view switcher: one project is always active —
  // a fresh view shows the board's first, and the menu lists the projects and Manage.
  const filter = page.locator('app-scope-filter .sf-btn');
  await expect(filter).toHaveText('Drey', { timeout: 60_000 });
  await filter.click();
  await expect(page.locator('app-scope-filter .sf-item')).toHaveText(['Drey', 'Home lab', 'Lariscus', 'Manage projects…']);
  await page.locator('app-scope-filter .sf-item', { hasText: 'Drey' }).click();
  await expect(filter).toHaveText('Drey');

  // The Board: only Drey's cards; every persona column stays; the loads count every project.
  await page.keyboard.press('Control+p');
  await page.locator('.palette input').fill('>Open the Board');
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  const board = page.locator('.desk-board.desk-pboard').filter({ visible: true });
  await expect(board).toBeVisible({ timeout: 20_000 });
  await pushFleet(electronApp);
  const cards = board.locator('.pb-card');
  await expect(cards.first()).toBeVisible();
  const shown = await cards.evaluateAll((nodes) => nodes.map((n) => (n as HTMLElement).dataset['id'] ?? ''));
  const dreyIds = new Set(DREY_IDS.map((i) => `T-${String(i + 1).padStart(4, '0')}`));
  expect(shown.length).toBeGreaterThan(0);
  expect(shown.filter((id) => !dreyIds.has(id))).toEqual([]);
  await expect(board.locator('.pb-project')).toHaveCount(0);
  await expect(board.locator('[data-column="ben"] .pb-load')).toHaveAttribute('title', 'Counts every project');
  await expect(board.locator('[data-column="ralf"]')).toBeVisible();
  await expect(board.locator('.pb-pool-chip')).toHaveText('4/5 · 1 queued');

  // Files: Drey's two vaults (Work notes read-only) and its folder, the summary line under the header.
  const files = page.locator('app-dock[side="left"]');
  await expect(files.getByText('Drey · 2 vaults, 1 folder')).toBeVisible();
  await expect(files.getByText('Drey notes', { exact: true })).toBeVisible();
  await expect(files.getByText('Work notes', { exact: true })).toBeVisible();
  await expect(files.getByText('drey-shared', { exact: true })).toBeVisible();
  await expect(files.getByText('Private', { exact: true })).toHaveCount(0);

  await filter.click();
  await page.mouse.move(800, 600);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, 'DeskProjectFilter.png') });
  await page.keyboard.press('Escape');
  await page.locator('app-scope-filter .sf-backdrop').click({ force: true });

  // A capture under Drey lands in Drey.
  await board.locator('.pb-btn-primary').click();
  await page.locator('.tickets-form-title').fill('Captured under Drey');
  await page.locator('.tickets-form-create').click();
  // The capture is the store's next ticket: `dk add` writes the stub, the put that follows its fields.
  const fieldOfNext = (key: string): string | null => {
    try {
      return field(dkIdOf(SEEDS.length), key);
    } catch {
      return null;
    }
  };
  await expect.poll(() => fieldOfNext('x-project'), { timeout: 20_000 }).toBe('drey');
  expect(fieldOfNext('title')).toBe('Captured under Drey');

  // The choice is the view's: Notes starts on the first project of its own, Work comes back on Drey.
  await tabs.filter({ hasText: 'Notes' }).click();
  await expect(filter).toHaveText('Drey');
  await tabs.filter({ hasText: 'Work' }).click();
  await expect(filter).toHaveText('Drey');
  // Home lab narrows the board to its one card.
  await page.keyboard.press('Control+p');
  await page.locator('.palette input').fill('>Open the Board');
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  const boardAgain = page.locator('.desk-board.desk-pboard').filter({ visible: true });
  await expect(boardAgain).toBeVisible({ timeout: 20_000 });
  await filter.click();
  await page.locator('app-scope-filter .sf-item', { hasText: 'Home lab' }).click();
  await expect(filter).toHaveText('Home lab');
  const homeLabCard = boardAgain.locator(`.pb-card[data-id="${byTitle('Spell-check the commit message')}"]`);
  await expect(homeLabCard).toBeVisible({ timeout: 20_000 });
  const shownAgain = await boardAgain.locator('.pb-card').evaluateAll((nodes) => nodes.map((n) => (n as HTMLElement).dataset['id'] ?? ''));
  const homeLabIds = SEEDS.map((_, i) => i).filter((i) => PROJECT_OF[i] === 'home-lab').map((i) => `T-${String(i + 1).padStart(4, '0')}`);
  expect(shownAgain.filter((id) => id !== '' && !homeLabIds.includes(id))).toEqual([]);
  // A capture under Home lab lands in Home lab — the active project, whatever it is.
  await boardAgain.locator('.pb-btn-primary').click();
  await page.locator('.tickets-form-title').fill('Captured under Home lab');
  await page.locator('.tickets-form-create').click();
  const fieldOfNext2 = (key: string): string | null => {
    try {
      return field(dkIdOf(SEEDS.length + 1), key);
    } catch {
      return null;
    }
  };
  await expect.poll(() => fieldOfNext2('x-project'), { timeout: 20_000 }).toBe('home-lab');
  expect(fieldOfNext2('title')).toBe('Captured under Home lab');
});
