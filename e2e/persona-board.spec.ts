import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect, type ElectronApplication, type Page } from './fixtures/drey';
import { showTicketsPanel } from './fixtures/crew-run';
import { SEEDS, byTitle, dkIdOf, fieldOf, idOf, liveRun, seedStore, seedVaultOf } from './fixtures/persona-board-seed';

/**
 * req-270/271: the persona board in the RUNNING app over the real engine, on a
 * SCRATCH dricket store on the lifecycle stages with a meta vault already on
 * the persona board (pipeline Inbox · Prioritized · Done with `flow:`, the
 * crew's `order:`). Seeded like board 7e v2 (DeskBoardV2): the cards' chains,
 * cursors, a send-back once and twice, a question, no persona for position 4,
 * You's Accept; the live runs, the pool, the tranche and the queue are pushed
 * as the fleet's status. Screenshots: the board, the pool chip's popover, the
 * Tickets panel (board 7a v2). Then one drag between persona columns and an
 * Accept land in the store. Everything lives under a temp dir with a home of
 * its own; the owner's `~/.drey-engine` and boards are never touched.
 * Skipped when `dk` is missing.
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

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dpb-'));
const home = path.join(root, 'home');
const storeDir = path.join(root, 's');
const dataDir = path.join(root, 'd');
fs.mkdirSync(home, { recursive: true });
process.env['USERPROFILE'] = home;
process.env['HOME'] = home;
process.env['DK_OWNER'] = 'henrik';
process.env['GIT_AUTHOR_NAME'] = 'Board Test';
process.env['GIT_AUTHOR_EMAIL'] = 'board@test.invalid';
process.env['GIT_COMMITTER_NAME'] = 'Board Test';
process.env['GIT_COMMITTER_EMAIL'] = 'board@test.invalid';

const dirs = { bin, root, storeDir, dataDir };
const field = fieldOf(dirs);

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
const SEED_VAULT = seedVaultOf(now);

test.beforeAll(() => {
  if (haveDk) {
    seedStore(dirs);
  }
});

test.afterEach(() => stopEngine());

test.afterAll(() => {
  stopEngine();
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {
    // The engine holds files open for a moment after the kill; a leftover temp dir is harmless.
  }
});

test.use({
  seedVault: SEED_VAULT,
  launchArgs: ['--force-device-scale-factor=1'],
  appConfig: { plugins: { disabled: ['sample', 'templates', 'browser', 'drawio', 'ocr', 'meeting'] }, spellcheck: { enabled: false } },
});

test.beforeEach(({ userDataDir }) => {
  if (!haveDk) {
    return;
  }
  const dir = path.join(userDataDir, 'plugins', 'tickets');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ 'dk.store': storeDir, 'dk.dataDir': dataDir, 'dk.syncSeconds': 0 }, null, 2));
});

function nextMonday(): string {
  const reset = new Date();
  reset.setHours(9, 0, 0, 0);
  do {
    reset.setDate(reset.getDate() + 1);
  } while (reset.getDay() !== 1);
  return reset.toISOString();
}

/** The fleet's status as the engine would push it: four live runs, the pool, the slots, the tranche, the queue, a persona wait. */
async function pushFleet(app: ElectronApplication): Promise<void> {
  const resetsAt = nextMonday();
  const slot = (id: string, label: string, busy: number, total: number, extra: Record<string, unknown>): Record<string, unknown> => ({ id, label, profile: 'private', state: busy > 0 ? 'busy' : 'ready', busy, total, remaining: null, reliability: 'unknown', q: null, resetsAt: null, ...extra });
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
          liveRun(byTitle('Palette: recent commands'), 'ben', 11, { activity: 'merging main' }),
          liveRun(byTitle('PDF export keeps callout colors'), 'tessa', 4),
        ],
        chain: {
          configured: true,
          master: 'run',
          columns: {},
          redStreak: {},
          cooldownUntil: {},
          poolSize: { opencode: 2, 'claude-code': 3 },
          personaWaits: { [byTitle('Win+H dictation hand-off')]: 'ben' },
          queue: [{ ticket: byTitle('Settings search across plugins'), persona: 'ralf', class: 'B', reason: 'capacity', line: 'waits for a B slot', detail: '', position: 1, since: now.toISOString() }],
          tranche: { index: 1, of: null, done: 4, total: 10, spent: 6.4, budget: 15, startedAt: now.toISOString(), endsAt: new Date(Date.now() + (2 * 60 + 10) * 60_000 + 30_000).toISOString(), checkpoint: null, report: null },
          slots: [
            slot('claude-a', 'Claude A', 2, 2, { remaining: 0.62, reliability: 'measured', q: 1.4, resetsAt }),
            slot('claude-b', 'Claude B', 1, 1, { remaining: 0.31, reliability: 'measured', q: 0.8, resetsAt }),
            slot('zai', 'z.ai', 1, 3, { remaining: 0.7, reliability: 'estimated', q: 1.2, resetsAt }),
            slot('kimi', 'Kimi', 0, 2, {}),
          ],
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

async function shoot(page: Page, name: string): Promise<void> {
  await page.mouse.move(700, 880);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

test('the persona board: columns by holder, the pool chip, drag and Accept (req-270/271)', async ({ page, electronApp }, testInfo) => {
  test.setTimeout(300_000);
  fs.mkdirSync(OUT, { recursive: true });
  await sizeWindow(electronApp);
  const tabs = page.locator('[role="tablist"][aria-label="Views"] [role="tab"]');
  await expect(tabs).toHaveText(['Notes', 'Work', 'Crew'], { timeout: 30_000 });
  await tabs.filter({ hasText: 'Work' }).click();
  // Since milestone 270 the Work view opens on the Board with the left dock folded: show the panel first.
  const panel = await showTicketsPanel(page);
  await expect(panel.locator(`.work-row[data-id="${byTitle('Palette opens twice on slow CI')}"]`)).toBeVisible({ timeout: 60_000 });
  await pushFleet(electronApp);

  // Board 7a v2: Needs you is what stands at You; a row names its holder and position.
  const needs = panel.locator('.work-group-needs');
  await expect(needs.locator(`.work-row[data-id="${byTitle('Outline: drag headings to reorder')}"] .work-row-meta`)).toContainText('Ben asks');
  await expect(needs.locator(`.work-row[data-id="${byTitle('Theme picker in the status bar')}"] .work-row-meta`)).toContainText('no persona');
  await expect(needs.locator(`.work-row[data-id="${byTitle('Palette opens twice on slow CI')}"] .work-row-meta`)).toContainText('Accept');
  await expect(panel.locator(`.work-group-running .work-row[data-id="${byTitle('Export the vault as a zip')}"] .work-row-meta`)).toContainText('Ben');
  await page.screenshot({ path: testInfo.outputPath('tickets-panel.png') });
  await page.screenshot({ path: path.join(OUT, 'DeskWorkV2.panel.png'), clip: { x: 0, y: 40, width: 360, height: 860 } });

  // Open the Board, fold both docks: board 7e v2 is the tab alone.
  await page.locator('app-panel-frame', { has: page.locator('.tickets-panel') }).filter({ visible: true }).locator('.head').hover();
  await page.locator('button[aria-label="More actions"]:visible').click({ force: true });
  await page.getByRole('menuitem', { name: 'Board', exact: true }).click();
  const board = page.locator('.desk-board.desk-pboard').filter({ visible: true });
  await expect(board).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press('Control+B');
  await page.keyboard.press('Control+Alt+B');
  await pushFleet(electronApp);
  await expect(board.locator('.pb-col').first()).toBeVisible();

  await expect(board.locator('.pb-col')).toHaveCount(8); // Inbox, Prioritized, Paul, Ben, Ralf, Tessa, You, Done
  await expect(board.locator('.pb-fold-chip')).toHaveText('+ 1 persona');
  await expect(board.locator('[data-column="ben"] .pb-load')).toHaveText('2/2 · 1 waiting');
  await expect(board.locator('[data-column="ralf"] .pb-load')).toHaveText('0/1 · 1 waiting');
  await expect(board.locator('.pb-pool-chip')).toHaveText('4/5 · 1 queued');
  const sent = board.locator(`.pb-card[data-id="${byTitle('Export the vault as a zip')}"]`);
  await expect(sent.locator('.pb-badge')).toHaveText('Sent back once');
  await expect(sent.locator('.pb-status-text')).toHaveText('running · from Tessa');
  await expect(board.locator(`.pb-card[data-id="${byTitle('Palette: recent commands')}"] .pb-status-text`)).toHaveText('merging main');
  await expect(board.locator(`.pb-card[data-id="${byTitle('Win+H dictation hand-off')}"] .pb-status-text`)).toHaveText('waits for Ben');
  await expect(board.locator(`.pb-card[data-id="${byTitle('Settings search across plugins')}"] .pb-status-text`)).toHaveText('queued · waits for a B slot');
  await expect(board.locator(`.pb-card[data-id="${byTitle('Theme picker in the status bar')}"] .pb-status-text`)).toHaveText('no persona for position 4');
  await expect(board.locator(`.pb-card[data-id="${byTitle('Tag field: paste a list')}"] .pb-badge`)).toHaveText('Sent back twice');
  await expect(board.locator(`.pb-card[data-id="${byTitle('Voice capture for tickets')}"] .pb-status-text`)).toHaveText('shaping with you');
  await shoot(page, 'DeskBoardV2');
  await page.screenshot({ path: testInfo.outputPath('persona-board.png') });

  // The pool chip's popover: slots, tranche, the queue's head, the Service window.
  await board.locator('.pb-pool-chip').click();
  const pop = board.locator('.pb-pool-pop');
  await expect(pop).toBeVisible();
  await expect(pop.locator('.pb-pool-sub')).toHaveText('4 of 5 sessions · 1 queued');
  await expect(pop.locator('.desk-slot')).toHaveCount(4);
  await expect(pop.locator('.pb-pool-queue-text')).toHaveText(`${byTitle('Settings search across plugins')} queued · waits for a B slot · 1st`);
  await expect(pop.locator('.desk-tranche-text')).toContainText('Tranche 4 of 10 runs · $6.40 of $15');
  await shoot(page, 'DeskBoardV2.pool');
  await page.screenshot({ path: testInfo.outputPath('persona-board-pool.png') });
  await page.keyboard.press('Escape');
  await expect(pop).toBeHidden();

  // A drag from Ben to Ralf hands the entry at the cursor to Ralf: one put on the store.
  const waiting = SEEDS.findIndex((seed) => seed.title === 'Win+H dictation hand-off');
  await board.locator(`.pb-card[data-id="${idOf(waiting)}"]`).dragTo(board.locator('[data-column="ralf"] .pb-col-body'));
  await expect.poll(() => field(dkIdOf(waiting), 'x-chain'), { timeout: 20_000 }).toBe('paul:shape;paul;ralf;ralf;tessa;you');

  // You's Accept at the last position of a chainless-repository ticket ends the chain.
  const accept = SEEDS.findIndex((seed) => seed.title === 'Palette opens twice on slow CI');
  await board.locator(`.pb-card[data-id="${idOf(accept)}"] .pb-decide-accept`).click();
  await expect.poll(() => field(dkIdOf(accept), 'stage'), { timeout: 20_000 }).toBe('done');
});
