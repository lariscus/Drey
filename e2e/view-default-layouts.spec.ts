import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect, type ElectronApplication, type Locator, type Page } from './fixtures/drey';
import { demoChainWaits, demoFleetRuns, seedStore, seedVaultOf } from './fixtures/persona-board-seed';

/**
 * req-297: what each view opens with on a FRESH profile, and that `View →
 * Reset layout` brings the active view back to exactly that -- boards 7p
 * `DeskViewNotes`, 7q `DeskViewWorkMC` and 7r `DeskViewCrew`. Each view is
 * first checked as it opens, then disturbed (panels toggled, docks resized
 * and folded) and reset; the screenshot after the reset goes to
 * `test-results/fidelity/<Board>-built.png` for boards/compare.html, at
 * 1440×900 and scale factor 1. The Board and Crew tabs run over the real
 * engine on a SCRATCH dricket store seeded like board 7e v2; everything
 * lives under a temp dir with a home of its own, so the owner's
 * `~/.drey-engine` and boards are never touched. Skipped when `dk` is missing.
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

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dvl-'));
const home = path.join(root, 'home');
const storeDir = path.join(root, 's');
const dataDir = path.join(root, 'd');
fs.mkdirSync(home, { recursive: true });
process.env['USERPROFILE'] = home;
process.env['HOME'] = home;
process.env['DK_OWNER'] = 'henrik';
process.env['GIT_AUTHOR_NAME'] = 'Layout Test';
process.env['GIT_AUTHOR_EMAIL'] = 'layout@test.invalid';
process.env['GIT_COMMITTER_NAME'] = 'Layout Test';
process.env['GIT_COMMITTER_EMAIL'] = 'layout@test.invalid';

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
const pad = (n: number): string => String(n).padStart(2, '0');
const TODAY = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const day = (offset: number): string => {
  const d = new Date(now);
  d.setDate(d.getDate() - offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** Board 7p's vault: today's daily note and the files the Files panel lists, English throughout. */
const NOTES_VAULT: Record<string, string> = {
  [`daily/${TODAY}.md`]: ['# Today', '', '## 09:30 · Standup', '', 'Release notes go out Monday.', '', '## Ideas', '', 'A reading list per season instead of one long list.', '', '## To do', '', '- [ ] Order seeds for the raised bed', '- [ ] Reply to Dana about the venue', ''].join('\n'),
  [`daily/${day(1)}.md`]: '# Yesterday\n\nA quiet day.\n',
  [`daily/${day(2)}.md`]: '# The day before\n\nPlanning.\n',
  'meetings/Kick-off.md': '# Kick-off\n\nNotes.\n',
  'projects/Garden plan.md': '# Garden plan\n\nBeds and seeds.\n',
  'projects/Reading list.md': '# Reading list\n\nBooks.\n',
  'Inbox.md': '# Inbox\n\nLoose ends.\n',
};

test.beforeAll(() => {
  if (haveDk) {
    seedStore({ bin, root, storeDir, dataDir });
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
  seedVault: { ...seedVaultOf(now), ...NOTES_VAULT },
  launchArgs: ['--force-device-scale-factor=1'],
  // Board 7p's strip shows Templates: only the plugins no board draws are off.
  appConfig: { plugins: { disabled: ['sample', 'browser', 'drawio', 'ocr', 'meeting'] }, spellcheck: { enabled: false } },
});

test.beforeEach(({ userDataDir }) => {
  if (!haveDk) {
    return;
  }
  const dir = path.join(userDataDir, 'plugins', 'tickets');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ backend: 'dricket', 'dk.store': storeDir, 'dk.dataDir': dataDir, 'dk.syncSeconds': 0 }, null, 2));
});

async function sizeWindow(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.webContents.getURL().startsWith('app://')) {
        win.setContentSize(1440, 900);
      }
    }
  });
}

/** The live half of board 7e v2 (four runs, a wait, the queue's head), pushed as the engine would. */
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
        runs: demoFleetRuns(),
        chain: { configured: true, master: 'run', columns: {}, redStreak: {}, cooldownUntil: {}, poolSize: { opencode: 2, 'claude-code': 3 }, ...demoChainWaits(now) },
      },
    },
  );
}

const dock = (page: Page, side: 'left' | 'right' | 'bottom'): Locator => page.locator(`app-dock[side="${side}"]`);

/** The strip's panel ids, in order, and which of them are open. */
async function strip(page: Page, side: 'left' | 'right'): Promise<{ ids: string[]; open: string[] }> {
  const buttons = dock(page, side).locator('app-dock-strip button[data-widget]');
  const ids = await buttons.evaluateAll((nodes) => nodes.map((n) => (n as HTMLElement).dataset['widget'] ?? ''));
  const open = await buttons.evaluateAll((nodes) => nodes.filter((n) => n.getAttribute('aria-pressed') === 'true').map((n) => (n as HTMLElement).dataset['widget'] ?? ''));
  return { ids, open };
}

const width = async (locator: Locator): Promise<number> => Math.round((await locator.boundingBox())?.width ?? 0);

async function tabs(page: Page): Promise<string[]> {
  return (await page.locator('.main-pane app-tab-bar .tab .name:visible').allTextContents()).map((t) => t.trim());
}

async function resetLayout(page: Page): Promise<void> {
  await page.locator('app-titlebar .menu-label', { hasText: 'View' }).click();
  await page.locator('app-titlebar .popover .row', { hasText: 'Reset layout' }).click();
}

/** Disturbs the active view's layout: what Reset layout must undo. */
async function disturb(page: Page): Promise<void> {
  await page.keyboard.press('Control+B');
  await page.keyboard.press('Control+Alt+B');
  await page.keyboard.press('Control+B');
}

async function shot(page: Page, board: string): Promise<void> {
  await page.mouse.move(700, 880);
  await page.waitForTimeout(500);
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${board}-built.png`) });
}

const target = (page: Page): Locator => page.locator('app-panel-frame', { has: page.locator('.assistant-panel') }).filter({ visible: true }).locator('.assistant-target.on');

async function expectNotes(page: Page): Promise<void> {
  // 7p: left 300 with Calendar and Files open, the rest as icons; right 380 with the Assistant on Model, Outline and Backlinks as icons.
  await expect.poll(() => strip(page, 'left')).toEqual({
    ids: ['calendar', 'files', 'find', 'templates', 'windows', 'git', 'tickets'],
    open: ['calendar', 'files'],
  });
  await expect.poll(() => strip(page, 'right')).toEqual({ ids: ['assistant', 'outline', 'backlinks'], open: ['assistant'] });
  await expect.poll(() => width(dock(page, 'left'))).toBe(300);
  await expect.poll(() => width(dock(page, 'right'))).toBe(380);
  await expect(target(page)).toHaveAttribute('aria-label', 'Model');
  await expect(dock(page, 'bottom').locator('app-panel-frame')).toHaveCount(0);
  // A first showing and a reset to it are no change: no unsaved-layout dot on the switcher.
  await expect(page.locator('app-titlebar .vs-dot-layout')).toHaveCount(0);
}

async function expectWork(page: Page): Promise<void> {
  // 7q: the Board, the left dock folded (Tickets inside), Mission Control open in the right dock (380).
  await expect(dock(page, 'left')).toBeHidden();
  await expect(dock(page, 'right')).toBeVisible();
  await expect.poll(() => strip(page, 'right')).toEqual({ ids: ['assistant'], open: ['assistant'] });
  await expect.poll(() => width(dock(page, 'right'))).toBe(380);
  await expect(target(page)).toHaveAttribute('aria-label', 'Mission Control', { timeout: 30_000 });
  await expect.poll(() => tabs(page)).toEqual(['Board']);
  await expect(dock(page, 'bottom').locator('app-panel-frame')).toHaveCount(0);
  // A first showing and a reset to it are no change: no unsaved-layout dot on the switcher.
  await expect(page.locator('app-titlebar .vs-dot-layout')).toHaveCount(0);
}

async function expectCrew(page: Page): Promise<void> {
  // 7r: the Crew tab alone, both side docks folded.
  await expect(dock(page, 'left')).toBeHidden();
  await expect(dock(page, 'right')).toBeHidden();
  await expect.poll(() => tabs(page)).toEqual(['Crew']);
  await expect(page.locator('.desk-team').filter({ visible: true })).toBeVisible({ timeout: 20_000 });
  await expect(dock(page, 'bottom').locator('app-panel-frame')).toHaveCount(0);
  // A first showing and a reset to it are no change: no unsaved-layout dot on the switcher.
  await expect(page.locator('app-titlebar .vs-dot-layout')).toHaveCount(0);
}

test('each view opens with its board on a fresh profile, and Reset layout brings it back (req-297)', async ({ page, electronApp }) => {
  test.setTimeout(300_000);
  await sizeWindow(electronApp);
  const views = page.locator('[role="tablist"][aria-label="Views"] [role="tab"]');
  await expect(views).toHaveText(['Notes', 'Work', 'Crew'], { timeout: 30_000 });

  // --- Notes (7p): today's daily note, the base defaults.
  await expect.poll(() => tabs(page), { timeout: 30_000 }).toEqual([`${TODAY}.md`]);
  await expectNotes(page);
  await disturb(page);
  await page.locator('app-dock-strip button[data-widget="windows"]').first().click();
  await resetLayout(page);
  await expectNotes(page);
  await expect.poll(() => tabs(page)).toEqual([`${TODAY}.md`]);
  await shot(page, 'DeskViewNotes');

  // --- Work (7q): the Board beside Mission Control; the columns keep their width and scroll sideways.
  await views.filter({ hasText: 'Work' }).click();
  const board = page.locator('.desk-board.desk-pboard').filter({ visible: true });
  await expect(board.locator('.pb-col').first()).toBeVisible({ timeout: 60_000 });
  await pushFleet(electronApp);
  await expectWork(page);
  const cols = board.locator('.pb-cols');
  const lanes = board.locator('.pb-col-lane');
  await expect.poll(() => cols.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  await expect.poll(() => lanes.evaluateAll((nodes) => nodes.map((n) => Math.round(n.getBoundingClientRect().width)))).toEqual(
    expect.arrayContaining([158]),
  );
  for (const w of await lanes.evaluateAll((nodes) => nodes.map((n) => Math.round(n.getBoundingClientRect().width)))) {
    expect(w).toBe(158);
  }
  await disturb(page);
  await page.locator('.main-pane app-tab-bar .tab', { hasText: 'Board' }).locator('.close').first().click({ force: true });
  await expect.poll(() => tabs(page)).toEqual([]);
  await resetLayout(page);
  await expect(board.locator('.pb-col').first()).toBeVisible({ timeout: 30_000 });
  await pushFleet(electronApp);
  await expectWork(page);
  await shot(page, 'DeskViewWorkMC');

  // --- Crew (7r): the Crew tab alone at full width.
  await views.filter({ hasText: 'Crew' }).click();
  await expectCrew(page);
  await disturb(page);
  await resetLayout(page);
  await expectCrew(page);
  await shot(page, 'DeskViewCrew');

  // Back in Notes, its own layout -- the resets of Work and Crew touched nothing here.
  await views.filter({ hasText: 'Notes' }).click();
  await expectNotes(page);
});
