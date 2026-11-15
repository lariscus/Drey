import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Browser, BrowserContext, Page as BrowserPage } from '@playwright/test';
import { test, expect } from './fixtures/drey';
import { SEEDS, demoChainWaits, demoFleetRuns, dkIdOf, fieldOf, seedStore, seedVaultOf, type Seed } from './fixtures/persona-board-seed';

/**
 * req-298: Mission Control's own project filter, over the REAL engine; req-308:
 * one project is always active — no *All projects*, no *Unassigned*, a device
 * without a stored choice shows the board's first project, and a ticket
 * without one shows under none. Drey starts Drey Service in a temp home; the
 * gateway serves the built Mission Control on a loopback port with one device
 * paired up front; a stock Chromium opens it at iPad (1194×834) and phone
 * (390×844) sizes. The store is the persona board's demo with each ticket in
 * a project (Drey, Lariscus, Home lab or none — the desktop filter's e2e
 * seeding), the meta vault has the three project records and one Mission
 * Control chat whose last card is Pia's createTicket naming Home lab.
 * Checked: the filter in the iPad header and on the phone's cost strip, the
 * rows it shows, the first project as the default choice, the holder's load
 * counting every project, the choice kept on the device, the active project
 * riding Pia's turn, and her card creating the ticket in its project. Only
 * the fleet's live runs are patched into `/api/fleet`. Screenshots:
 * test-results/fidelity/MPadWorkV2.project-filter*.png and
 * MPhoneWorkV2.project-filter*.png. The owner's `~/.drey-engine` and stores
 * are never touched. Skipped when `dk` is missing. Prerequisite:
 * `npm run build`.
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

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dmcp-'));
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
const PORT = 47_990 + Math.floor(Math.random() * 9);
const TOKEN = 'e2eMissionControlReq298Projects';
const ORIGIN = `http://127.0.0.1:${PORT}`;
const now = new Date();

/** Which project each seed belongs to; '' = Unassigned (the desktop filter's e2e seeding, milestone 267). */
const PROJECT_OF = ['drey', 'drey', 'drey', 'lariscus', 'home-lab', '', 'drey', 'drey', 'lariscus', 'drey', 'lariscus', 'drey', 'drey', 'drey', 'lariscus', 'drey', 'drey', '', 'home-lab', 'drey', 'drey', 'drey', 'lariscus', '', ''];
const SEEDS_WITH_PROJECTS: readonly Seed[] = SEEDS.map((seed, i) => (PROJECT_OF[i] ? { ...seed, extra: { ...(seed.extra ?? {}), 'x-project': PROJECT_OF[i]! } } : seed));
const project = (name: string, color: string): string => ['---', `name: ${name}`, `color: "${color}"`, 'repos: [drey]', '---', `${name}.`, ''].join('\n');

const REMOTE = {
  'remote.enabled': true,
  'remote.mode': 'loopback',
  'remote.port': PORT,
  'remote.devices': [{ id: 'e2e-device', name: 'E2E device', readOnly: false, tokenHash: createHash('sha256').update(TOKEN, 'utf8').digest('hex'), pairedAt: now.toISOString(), lastSeen: null }],
};

/** Pia's chat: she proposed a ticket in Home lab; the owner confirms it on the phone. */
const CHAT_FILE = 'tickets/_meta/chat/20261114-090000-capture-an-idea.md';
const CREATE = { kind: 'createTicket', title: 'Back up the router config', description: '', priority: 'normal', phase: 'inbox', project: 'home-lab' };
const CHAT = [
  '---',
  'title: "Capture an idea"',
  `created: '${now.toISOString()}'`,
  '---',
  '',
  `- '${now.toISOString()}' owner — Capture: back up the router config, it is for the home lab.`,
  `- '${now.toISOString()}' mission — Here is the ticket, in Home lab.`,
  `- '${now.toISOString()}' proposal p-1 pending — Create ticket "Back up the router config" in inbox`,
  '  ```json',
  `  ${JSON.stringify(CREATE)}`,
  '  ```',
  '',
].join('\n');

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
    seedStore(dirs, SEEDS_WITH_PROJECTS);
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

test.use({
  seedVault: {
    ...seedVaultOf(now),
    [CHAT_FILE]: CHAT,
    'tickets/_meta/projects/drey.md': project('Drey', '#8ecbef'),
    'tickets/_meta/projects/lariscus.md': project('Lariscus', '#f2cfae'),
    'tickets/_meta/projects/home-lab.md': project('Home lab', '#bfe3cd'),
  },
  appConfig: { plugins: { disabled: ['sample', 'templates', 'browser', 'drawio', 'ocr', 'meeting'] }, spellcheck: { enabled: false } },
});

test.beforeEach(({ userDataDir }) => {
  const dir = path.join(userDataDir, 'plugins', 'tickets');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ backend: 'dricket', 'dk.store': storeDir, 'dk.dataDir': dataDir, 'dk.syncSeconds': 0, ...REMOTE }, null, 2));
});

/** Waits until the gateway answers the paired device with the board's projects. */
async function gatewayUp(): Promise<void> {
  await expect
    .poll(
      async () => {
        try {
          const reply = await fetch(`${ORIGIN}/api/board`, { headers: { authorization: `Bearer ${TOKEN}` } });
          return reply.ok ? (((await reply.json()) as { projects?: unknown[] }).projects ?? []).length : 0;
        } catch {
          return 0;
        }
      },
      { timeout: 90_000, intervals: [1000] },
    )
    .toBe(3);
}

type Device = 'phone' | 'pad' | 'desk';

/** The chat turns' bodies the device posted (Pia's turn carries the filter's project). */
interface Device$ {
  readonly context: BrowserContext;
  readonly page: BrowserPage;
  readonly chatBodies: Record<string, unknown>[];
}

async function openDevice(browser: Browser, device: Device): Promise<Device$> {
  const size = device === 'phone' ? { width: 390, height: 844 } : device === 'pad' ? { width: 1194, height: 834 } : { width: 1440, height: 900 };
  const context = await browser.newContext({ viewport: size, deviceScaleFactor: 1, hasTouch: device !== 'desk', isMobile: device === 'phone', locale: 'en-GB' });
  const page = await context.newPage();
  const chatBodies: Record<string, unknown>[] = [];
  await page.route('**/api/fleet', async (route) => {
    const reply = await route.fetch();
    const fleet = (await reply.json()) as { runs?: unknown[]; chain?: Record<string, unknown> | null };
    await route.fulfill({ response: reply, json: { ...fleet, runs: [...(fleet.runs ?? []), ...demoFleetRuns()], chain: { ...(fleet.chain ?? { configured: true, master: 'run' }), ...demoChainWaits(now) } } });
  });
  await page.route(/\/api\/chat\/sessions(\/[^/]+\/messages)?$/, async (route) => {
    if (route.request().method() === 'POST') {
      chatBodies.push(route.request().postDataJSON() as Record<string, unknown>);
      // No model runs here: the turn's reply is canned; what matters is what the device sent.
      await route.fulfill({ json: { ok: true, file: CHAT_FILE, say: 'Which project?', proposals: [] } });
      return;
    }
    await route.continue();
  });
  if (device !== 'desk') {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: device === 'phone' ? { top: 47, left: 0, bottom: 34, right: 0 } : { top: 24, left: 0, bottom: 20, right: 0 } });
  }
  await page.goto(`${ORIGIN}/#token=${TOKEN}`);
  await expect(page.locator('mc-root .shell')).toBeVisible({ timeout: 30_000 });
  return { context, page, chatBodies };
}

const settle = (page: BrowserPage) => page.waitForTimeout(400);
async function shot(page: BrowserPage, name: string): Promise<void> {
  fs.mkdirSync(OUT, { recursive: true });
  await settle(page);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

const heads = (page: BrowserPage) => page.locator('mc-work .ph-ghead .ph-gtitle');
const row = (page: BrowserPage, title: string) => page.locator('mc-work .ph-trow', { hasText: title });

test('iPad: the filter beside the area switch, the rows it shows, the load counting every project', async ({ electronApp, browser }) => {
  test.setTimeout(240_000);
  void electronApp;
  await gatewayUp();
  const { context, page } = await openDevice(browser, 'pad');
  try {
    const filter = page.locator('mc-shell-header mc-project-filter');
    // No stored choice on a fresh device: the board's first project is in effect.
    await expect(filter.locator('.pf-label')).toHaveText('Drey', { timeout: 30_000 });
    await expect(heads(page)).toHaveText(['Needs you', 'Paul', 'Ben', 'Tessa', 'Prioritized', 'Inbox', 'Done this week']);
    // One project is always active: no chips, and a ticket without a project shows under none.
    await expect(row(page, 'Weekly security audit run')).toHaveCount(0);
    await expect(row(page, 'Voice capture for tickets')).toHaveCount(1);
    await expect(page.locator('mc-work .ph-tproj')).toHaveCount(0);

    await filter.locator('.pf-btn').click();
    const menu = filter.locator('.pf-menu');
    await expect(menu.locator('.pf-name')).toHaveText(['Drey', 'Home lab', 'Lariscus']);
    await shot(page, 'MPadWorkV2.project-filter-menu');

    await menu.locator('[data-project="lariscus"]').click();
    await expect(filter.locator('.pf-label')).toHaveText('Lariscus');
    await expect(row(page, 'Weekly security audit run')).toHaveCount(1);
    await expect(row(page, 'Voice capture for tickets')).toHaveCount(0);
    await expect(page.locator('mc-work .ph-ghead[data-holder="ben"]')).toHaveCount(0);
    await expect(page.locator('mc-work .ph-ghead[data-holder="ralf"]')).toHaveCount(1);
    // Paul's only running ticket is Lariscus's audit: his load still counts it.
    await expect(page.locator('mc-work .ph-ghead[data-holder="paul"]')).toHaveAttribute('title', 'Paul · 1/1\nCounts every project');
    await shot(page, 'MPadWorkV2.project-filter');
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await context.close();
  }
});

test("phone: the filter on the cost strip, kept on the device; Pia's turn carries its project, her card creates the ticket in Home lab", async ({ electronApp, browser }) => {
  test.setTimeout(240_000);
  void electronApp;
  await gatewayUp();
  const { context, page, chatBodies } = await openDevice(browser, 'phone');
  try {
    await page.locator('mc-menu .places .row', { hasText: 'Work' }).click();
    const filter = page.locator('mc-work .ph-today mc-project-filter');
    await expect(filter.locator('.pf-label')).toHaveText('Drey', { timeout: 30_000 });
    await shot(page, 'MPhoneWorkV2.project-filter-first');
    await filter.locator('.pf-btn').click();
    await shot(page, 'MPhoneWorkV2.project-filter-menu');
    await filter.locator('[data-project="lariscus"]').click();
    await expect(heads(page)).toHaveText(['Paul', 'Ralf', 'Prioritized', 'Inbox', 'Done this week']);
    await expect(row(page, 'Weekly security audit run')).toHaveCount(1);
    await expect(row(page, 'Settings search across plugins')).toHaveCount(1);
    await expect(row(page, 'Voice capture for tickets')).toHaveCount(0);
    await shot(page, 'MPhoneWorkV2.project-filter');

    // Device-local: a reload keeps Lariscus.
    await page.reload();
    await page.locator('mc-menu .places .row', { hasText: 'Work' }).click();
    await expect(page.locator('mc-work .ph-today .pf-label')).toHaveText('Lariscus', { timeout: 30_000 });
    await page.locator('mc-work mc-app-bar button.back').click();

    // Pia's chat: her Home lab card, and the owner's next line carries the filter's project.
    await page.locator('mc-menu .chats .sess').first().click();
    const card = page.locator('.ph-change', { hasText: 'Back up the router config' });
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card.locator('.ph-change-proj')).toHaveText('Home lab');
    await card.scrollIntoViewIfNeeded();
    await shot(page, 'MPhoneChat.project-card');
    await page.locator('mc-chat .composer-input').fill('And capture: rotate the lab certificates.');
    await page.locator('mc-chat button.send').click();
    await expect.poll(() => chatBodies.at(-1)).toMatchObject({ text: 'And capture: rotate the lab certificates.', project: 'lariscus' });

    // The confirm creates the ticket in Home lab (one more ticket on the store).
    await page.locator('mc-chat mc-app-bar button.back').click();
    await page.locator('mc-menu .chats .sess').first().click();
    await page.locator('.ph-change', { hasText: 'Back up the router config' }).locator('.ph-primary').click();
    const created = dkIdOf(SEEDS.length);
    await expect.poll(() => { try { return field(created, 'x-project'); } catch { return null; } }, { timeout: 30_000 }).toBe('home-lab');
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await context.close();
  }
});

test('desk: the filter beside the top nav\'s tabs narrows the wide list; one project is always active', async ({ electronApp, browser }) => {
  test.setTimeout(240_000);
  void electronApp;
  await gatewayUp();
  const { context, page } = await openDevice(browser, 'desk');
  try {
    const filter = page.locator('.topnav mc-project-filter');
    // No stored choice: the board's first project. A ticket without a project shows under none.
    await expect(filter.locator('.pf-label')).toHaveText('Drey', { timeout: 30_000 });
    const card = (title: string) => page.locator('mc-work button.ticket-card', { hasText: title });
    await expect(card('Weekly security audit run')).toHaveCount(0);
    await expect(card('Spell-check the commit message')).toHaveCount(0);
    await filter.locator('.pf-btn').click();
    await page.locator('.topnav mc-project-filter [data-project="home-lab"]').click();
    await expect(filter.locator('.pf-label')).toHaveText('Home lab');
    await expect(card('Weekly security audit run')).toHaveCount(0);
    await expect(card('Spell-check the commit message')).toHaveCount(1);
    await expect(page.locator('mc-work .projchip')).toHaveCount(0);
    await shot(page, 'MCDesk.project-filter');
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await context.close();
  }
});
