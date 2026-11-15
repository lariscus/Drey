import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Browser, BrowserContext, Page as BrowserPage } from '@playwright/test';
import { test, expect } from './fixtures/drey';
import { SEEDS, byTitle, demoChainWaits, demoFleetRuns, dkIdOf, fieldOf, seedStore, seedVaultOf } from './fixtures/persona-board-seed';

/**
 * req-273: Mission Control on the persona board, over the REAL engine. Drey
 * starts Drey Service in a temp home; the service's gateway serves the built
 * Mission Control (`dist/mission-control/browser`) on a loopback port with one
 * device paired up front; a stock Chromium opens it at phone (390×844) and
 * iPad (1194×834) sizes. The store and the meta vault are the persona board's
 * demo (boards 10c v2, 10e v2, 10o v2, 10u v2). Only the fleet's live runs are
 * patched into `/api/fleet` (no workers run here); the board, the holds, the
 * needs and every write are the engine's. Screenshots go to
 * test-results/fidelity/<Board>.png. The owner's `~/.drey-engine` and stores
 * are never touched. Skipped when `dk` is missing. Prerequisite: `npm run build`.
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
const haveClient = fs.existsSync(path.resolve(__dirname, '..', 'dist', 'mission-control', 'browser', 'index.html'));

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dmc-'));
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
const OUT = path.resolve(__dirname, '..', 'test-results', 'fidelity');
const PORT = 47_900 + Math.floor(Math.random() * 90);
const TOKEN = 'e2eMissionControlReq273Persona';
const ORIGIN = `http://127.0.0.1:${PORT}`;
const now = new Date();

/** The gateway's settings with one device paired (its token's hash) — Drey syncs them into the engine. */
const REMOTE = {
  'remote.enabled': true,
  'remote.mode': 'loopback',
  'remote.port': PORT,
  'remote.devices': [{ id: 'e2e-phone', name: 'E2E phone', readOnly: false, tokenHash: createHash('sha256').update(TOKEN, 'utf8').digest('hex'), pairedAt: now.toISOString(), lastSeen: null }],
};

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
test.skip(!haveClient, 'dist/mission-control is not built');

test.beforeAll(() => {
  if (haveDk) {
    seedStore(dirs);
    fs.mkdirSync(path.join(home, '.drey-engine'), { recursive: true });
    fs.writeFileSync(path.join(home, '.drey-engine', 'config.json'), JSON.stringify(REMOTE, null, 2));
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

/** One Mission Control chat in the meta vault: the cards stand at the end of an open conversation. */
const CHAT_FILE = 'tickets/_meta/chat/20261113-140000-the-board-today.md';
const CHAT = ['---', 'title: "The board today"', `created: '${now.toISOString()}'`, '---', '', `- '${now.toISOString()}' owner — What waits for me?`, `- '${now.toISOString()}' mission — Four tickets wait for you; the cards are below.`, ''].join('\n');

/** Board 10c v2 shows Ben merging main; the conflict of 10u v2 part 4 comes after — the cards step switches it on. */
const conflict = { on: false };

/** The sync-main conflict of board 10u v2 part 4, as the runner leaves it: a red gate on the builder's settled run. */
const CONFLICT_NEED = {
  kind: 'red-gate',
  ticketId: byTitle('Palette: recent commands'),
  title: 'Palette: recent commands',
  phase: 'active',
  runId: 'r-conflict',
  text: 'sync-main: merging main conflicts in order.ts, order.spec.ts, board.css — the merge was aborted',
  since: now.toISOString(),
};

test.use({
  seedVault: { ...seedVaultOf(now), [CHAT_FILE]: CHAT },
  appConfig: { plugins: { disabled: ['sample', 'templates', 'browser', 'drawio', 'ocr', 'meeting'] }, spellcheck: { enabled: false } },
});

test.beforeEach(({ userDataDir }) => {
  const dir = path.join(userDataDir, 'plugins', 'tickets');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ 'dk.store': storeDir, 'dk.dataDir': dataDir, 'dk.syncSeconds': 0, ...REMOTE }, null, 2));
});

/** Waits until the gateway answers the paired device (the service started and synced its settings). */
async function gatewayUp(): Promise<void> {
  await expect
    .poll(
      async () => {
        try {
          const reply = await fetch(`${ORIGIN}/api/board`, { headers: { authorization: `Bearer ${TOKEN}` } });
          return reply.ok ? ((await reply.json()) as { lanes?: unknown }).lanes !== undefined : false;
        } catch {
          return false;
        }
      },
      { timeout: 90_000, intervals: [1000] },
    )
    .toBe(true);
}

type Device = 'phone' | 'pad';

/** A device context on the gateway: its size, touch, its safe areas, the fleet's live runs patched in. */
async function openDevice(browser: Browser, device: Device): Promise<{ context: BrowserContext; page: BrowserPage }> {
  const size = device === 'phone' ? { width: 390, height: 844 } : { width: 1194, height: 834 };
  const context = await browser.newContext({ viewport: size, deviceScaleFactor: 1, hasTouch: true, isMobile: device === 'phone', locale: 'en-GB' });
  const page = await context.newPage();
  await page.route('**/api/needs', async (route) => {
    const reply = await route.fetch();
    await route.fulfill({ response: reply, json: [...((await reply.json()) as unknown[]), ...(conflict.on ? [CONFLICT_NEED] : [])] });
  });
  await page.route('**/api/fleet', async (route) => {
    const reply = await route.fetch();
    const fleet = (await reply.json()) as { runs?: unknown[]; chain?: Record<string, unknown> | null };
    await route.fulfill({ response: reply, json: { ...fleet, runs: [...(fleet.runs ?? []), ...demoFleetRuns()], chain: { ...(fleet.chain ?? { configured: true, master: 'run' }), ...demoChainWaits(now) } } });
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: device === 'phone' ? { top: 47, left: 0, bottom: 34, right: 0 } : { top: 24, left: 0, bottom: 20, right: 0 } });
  await page.goto(`${ORIGIN}/#token=${TOKEN}`);
  await expect(page.locator('mc-root .shell')).toBeVisible({ timeout: 30_000 });
  return { context, page };
}

const settle = (page: BrowserPage) => page.waitForTimeout(400);
async function shot(page: BrowserPage, name: string): Promise<void> {
  fs.mkdirSync(OUT, { recursive: true });
  await settle(page);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

const rowMeta = (page: BrowserPage, title: string) => page.locator('mc-work .ph-trow', { hasText: title }).locator('.ph-tline');

test('iPad: Work by holder, the ticket at You and the Mission Control card with its targets (board 10e v2)', async ({ electronApp, browser }) => {
  test.setTimeout(240_000);
  void electronApp;
  await gatewayUp();
  const { context, page } = await openDevice(browser, 'pad');
  try {
    await expect(page.locator('mc-root .shell.ipad')).toBeVisible();
    const heads = page.locator('mc-work .ph-ghead .ph-gtitle');
    await expect(heads.first()).toHaveText('Needs you', { timeout: 30_000 });
    await expect(heads).toHaveText(['Needs you', 'Paul', 'Ben', 'Ralf', 'Tessa', 'Prioritized', 'Inbox', 'Done this week']);
    await expect(rowMeta(page, 'Palette opens twice on slow CI')).toHaveText(`${byTitle('Palette opens twice on slow CI')} · 6/6 · Accept`);
    await page.locator('mc-work .ph-trow', { hasText: 'Palette opens twice on slow CI' }).click();
    await expect(page.locator('.ticket-layer.open')).toBeVisible();
    await expect(page.locator('.ph-hold-chip').first()).toContainText('You · 6 of 6');
    await expect(page.locator('.pd-poscost')).toContainText('3 of 6 · Ben');
    const card = page.locator('.pd-hold');
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card.locator('.pd-hold-target')).toHaveCount(5);
    await expect(card.locator('.pd-hold-target.sel')).toContainText('Ben · 3 of 6');
    await card.locator('.pd-hold-note').fill('Callout colors are still wrong in dark mode.');
    await expect(card.locator('.pd-hold-sendback')).toHaveText('Send back to Ben');
    await shot(page, 'MPadWorkV2');
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await context.close();
  }
});

test('phone: Work by holder, Ready to try, the cards, the crew order (boards 10c v2, 10o v2, 10u v2)', async ({ electronApp, browser, vaultDir }) => {
  test.setTimeout(240_000);
  void electronApp;
  await gatewayUp();
  const { context, page } = await openDevice(browser, 'phone');
  try {
    await page.locator('mc-menu .places .row', { hasText: 'Work' }).click();
    const heads = page.locator('mc-work .ph-ghead .ph-gtitle');
    await expect(heads.first()).toHaveText('Needs you', { timeout: 30_000 });
    await expect(heads).toHaveText(['Needs you', 'Paul', 'Ben', 'Ralf', 'Tessa', 'Prioritized', 'Inbox', 'Done this week']);
    await expect(rowMeta(page, 'Outline: drag headings to reorder')).toHaveText(`${byTitle('Outline: drag headings to reorder')} · 3/6 · Ben asks`);
    await expect(rowMeta(page, 'Theme picker in the status bar')).toHaveText(`${byTitle('Theme picker in the status bar')} · 4/6 · no persona`);
    await expect(rowMeta(page, 'Tag field: paste a list')).toHaveText(`${byTitle('Tag field: paste a list')} · 4/6 · sent back twice`);
    await expect(rowMeta(page, 'Palette opens twice on slow CI')).toHaveText(`${byTitle('Palette opens twice on slow CI')} · 6/6 · Accept`);
    await expect(rowMeta(page, 'Voice capture for tickets')).toHaveText(`${byTitle('Voice capture for tickets')} · 1/6 · shaping with you`);
    await expect(rowMeta(page, 'Weekly security audit run')).toHaveText(`${byTitle('Weekly security audit run')} · 1/2 · running`);
    await expect(rowMeta(page, 'Export the vault as a zip')).toHaveText(`${byTitle('Export the vault as a zip')} · 3/6 · sent back`);
    await expect(rowMeta(page, 'Palette: recent commands')).toHaveText(`${byTitle('Palette: recent commands')} · 3/6 · merging main`);
    await expect(rowMeta(page, 'Win+H dictation hand-off')).toHaveText(`${byTitle('Win+H dictation hand-off')} · 3/6 · waits for Ben`);
    await expect(page.locator('mc-work .ph-ghead[data-holder="ben"]')).toHaveAttribute('title', 'Ben · 2/2 · 1 waiting');
    await shot(page, 'MPhoneWorkV2');

    // 10o v2: the ticket at You, the decision bar with the target.
    await page.locator('mc-work .ph-trow', { hasText: 'Palette opens twice on slow CI' }).click();
    await expect(page.locator('.ticket-layer.open')).toBeVisible();
    await expect(page.locator('.ph-hold-bar .ph-hold-select-value')).toHaveText('Ben · 3 of 6');
    await expect(page.locator('.ph-poscost')).toContainText('3 of 6 · Ben');
    await shot(page, 'MPhoneReadyV2');
    await page.locator('mc-ticket mc-app-bar button.back').click();
    await page.locator('mc-work mc-app-bar button.back').click();

    // 10u v2: the persona board's cards at the end of the conversation (the merge has failed by now).
    conflict.on = true;
    await page.goto(`${ORIGIN}/#token=${TOKEN}`);
    await page.reload();
    await expect(page.locator('mc-menu')).toBeVisible({ timeout: 30_000 });
    await page.locator('mc-menu .chats .sess').first().click();
    const cards = page.locator('mc-persona-cards section.pcard');
    await expect(cards.first()).toBeVisible({ timeout: 30_000 });
    for (const kind of ['no-persona', 'question', 'second-send-back', 'merge-conflict']) {
      const one = page.locator(`mc-persona-cards section.pcard[data-kind="${kind}"]`);
      await expect(one).toHaveCount(1);
      await one.scrollIntoViewIfNeeded();
      await settle(page);
      await one.screenshot({ path: path.join(OUT, `MCCardsV2-phone-${kind}.png`) });
    }
    await shot(page, 'MCCardsV2-phone');
    // Do it myself on the no-persona card: the entry at the cursor becomes You's, one put on the store.
    const theme = SEEDS.findIndex((seed) => seed.title === 'Theme picker in the status bar');
    await page.locator('mc-persona-cards section.pcard[data-kind="no-persona"] button[data-action="do_myself"]').click();
    await expect.poll(() => field(dkIdOf(theme), 'x-chain'), { timeout: 20_000 }).toBe('paul:shape;paul;ben;you;tessa;you');
    await page.locator('mc-chat mc-app-bar button.back').click();

    // The crew in its order: Paul moves down, crew.md's order follows.
    await page.locator('mc-menu .places .row', { hasText: 'Crew' }).click();
    await expect(page.locator('mc-team .crew-row').first()).toBeVisible({ timeout: 20_000 });
    await shot(page, 'MPhoneTeam.persona-board');
    await page.locator('mc-team .crew-row[data-persona="paul"] .ph-head').click();
    await page.locator('mc-team .crew-move-down').click();
    await expect.poll(() => /order:\s*\[([^\]]*)\]/.exec(fs.readFileSync(path.join(vaultDir, 'tickets', '_meta', 'crew.md'), 'utf8'))?.[1]?.replace(/\s/g, ''), { timeout: 20_000 }).toBe('pia,ben,paul,ralf,tessa,you');
    await page.locator('mc-team .crew-row[data-persona="paul"] .ph-head').click();
    await page.locator('mc-team .crew-move-up').click();
    await expect.poll(() => /order:\s*\[([^\]]*)\]/.exec(fs.readFileSync(path.join(vaultDir, 'tickets', '_meta', 'crew.md'), 'utf8'))?.[1]?.replace(/\s/g, ''), { timeout: 20_000 }).toBe('pia,paul,ben,ralf,tessa,you');
    await page.locator('mc-team mc-app-bar button.back').click();

    // 10o v2's decision: Send back to Ben with a note — the cursor goes back to position 3.
    await page.locator('mc-menu .places .row', { hasText: 'Work' }).click();
    await page.locator('mc-work .ph-trow', { hasText: 'Palette opens twice on slow CI' }).click();
    await page.locator('.ph-hold-bar .ph-hold-sendback').click();
    await page.locator('.ph-hold-bar .ph-hold-note').fill('Callout colors are still wrong in dark mode.');
    await page.locator('.ph-hold-bar .ph-hold-send').click();
    const palette = SEEDS.findIndex((seed) => seed.title === 'Palette opens twice on slow CI');
    await expect.poll(() => field(dkIdOf(palette), 'x-at'), { timeout: 20_000 }).toBe('3');
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await context.close();
  }
});

