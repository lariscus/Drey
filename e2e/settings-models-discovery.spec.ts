import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect, type ElectronApplication, type Page } from './fixtures/drey';
import { fakeHarnessDir, pathWithFakes } from './fixtures/fake-harness';

/**
 * Settings → Tickets → Models v3 on the real engine (req-286, req-287, board
 * 7l v3): the engine in a home of its own, fake coding-agent CLIs first on
 * `PATH` (Claude Code, opencode and Kimi answer model discovery only; no
 * Copilot CLI — not installed), so no real harness ever runs and every write
 * lands in that home's `service.json`. The page's first look asks the
 * harnesses; the one model the table does not hold comes back as a card;
 * Add, a class move, the router switch, an account's cost, Add class and an
 * account's removal with its model are each checked in the file. The
 * screenshot of the board's state: `test-results/fidelity/DeskModelsV3-built.png`.
 */
const engineHome = fs.mkdtempSync(path.join(os.tmpdir(), 'drey-e2e-home-'));
process.env['USERPROFILE'] = engineHome;
process.env['HOME'] = engineHome;
const harnesses = fakeHarnessDir();
process.env['PATH'] = pathWithFakes(harnesses);
process.env['Path'] = process.env['PATH'];
// Find models again also asks the model registry: a closed local port keeps the e2e off the network (the failure is said, the harnesses' answer stands).
process.env['DREY_MODELS_REGISTRY_URL'] = 'http://127.0.0.1:9/api.json';

const SERVICE = path.join(engineHome, '.drey-engine', 'service.json');
const OUT = path.resolve(__dirname, '..', 'test-results', 'fidelity');

const sub = (pricePerMonth: number): unknown => ({ kind: 'subscription', pricePerMonth, currency: 'EUR' });
const slot = (id: string, label: string, provider: string, billing: unknown, sessions: number, login: Record<string, string> = {}): unknown => ({ id, label, provider, billing, sessions, login, quota: 'counting' });
const row = (model: string, where: Record<string, string>, cls: string, cost: number, context: number, image: boolean): unknown => ({ model, ...where, category: '', class: cls, cost, tools: true, context, ...(image ? { input: ['text', 'image'] } : {}) });

/** Board 7l v3's accounts and models — all but zai-coding-plan/glm-5.3-air, which discovery finds; Claude B serves haiku alone. */
const SEED = {
  slots: [
    slot('claude-a', 'Claude A', 'claude-code', sub(90), 2),
    slot('claude-b', 'Claude B', 'claude-code', sub(90), 1),
    slot('zai', 'z.ai', 'opencode', sub(15), 3, { opencodeAuthEntry: 'zai-coding-plan' }),
    slot('kimi', 'Kimi', 'kimi', sub(19), 2),
    slot('copilot', 'Copilot', 'opencode', { kind: 'credits', pricePerCredit: 0.04, currency: 'EUR' }, 2, { opencodeAuthEntry: 'github-copilot' }),
  ],
  classes: [
    { name: 'super heavy', sessions: 1 },
    { name: 'heavy', sessions: 2 },
    { name: 'standard', sessions: 4 },
    { name: 'light', sessions: 6 },
  ],
  models: [
    row('claude-fable-5-2', { slot: 'claude-a' }, 'super heavy', 12, 1_000_000, true),
    row('claude-opus-5-5', { slot: 'claude-a' }, 'heavy', 5, 1_000_000, true),
    row('kimi-k3.1-pro', { provider: 'kimi' }, 'heavy', 2, 256_000, false),
    row('claude-sonnet-5-5', { slot: 'claude-a' }, 'standard', 1, 1_000_000, true),
    row('zai-coding-plan/glm-5.3', { slot: 'zai' }, 'standard', 0.4, 128_000, false),
    row('github-copilot/gpt-5.4', { slot: 'copilot' }, 'standard', 1, 128_000, true),
    row('claude-haiku-5-5', { slot: 'claude-b' }, 'light', 0.3, 200_000, true),
    row('kimi-k2.5', { provider: 'kimi' }, 'light', 0.3, 128_000, false),
  ],
  capacity: { global: 6, perSlot: {} },
  routing: { upgradeAboveQ: 1.3, reservePerWindow: 0.1, burnRate: 0.8 },
  ledgers: { ticketAllowance: 2.5, personaPerDay: 5, providerPerDay: 15 },
  // No account of the copilot harness: its stand-in is switched off, as on the board.
  impliedOff: ['copilot'],
  migrations: ['classes.v3'],
};
fs.mkdirSync(path.dirname(SERVICE), { recursive: true });
fs.writeFileSync(SERVICE, `${JSON.stringify(SEED, null, 2)}\n`);

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
  fs.rmSync(harnesses, { recursive: true, force: true });
});

test.use({
  seedVault: {
    'tickets/_meta/pipeline.md': ['---', 'phases:', '  - { id: inbox, title: Inbox, handover: manual }', '  - { id: done, title: Done, handover: none }', '---', 'The phases.', ''].join('\n'),
  },
  launchArgs: ['--force-device-scale-factor=1'],
  appConfig: { plugins: { disabled: ['sample', 'templates', 'browser', 'drawio', 'ocr', 'meeting'] }, spellcheck: { enabled: false } },
});

type Stored = { slots: { id: string; billing?: unknown }[]; classes: { name: string; sessions?: number }[]; models: { model: string; slot?: string; class: string; enabled?: boolean }[]; discovery?: { ignored?: string[] } };
const stored = (): Stored => JSON.parse(fs.readFileSync(SERVICE, 'utf8')) as Stored;
const modelOf = (name: string): Stored['models'][number] | undefined => stored().models.find((m) => m.model === name);

async function sizeWindow(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.webContents.getURL().startsWith('app://')) {
        win.setContentSize(1440, 1700);
      }
    }
  });
}

async function openModels(page: Page): Promise<void> {
  await page.locator('app-status-bar .settings').click();
  await page.locator('app-settings .category', { hasText: 'Tickets' }).first().click();
  await page.locator('app-settings .section-entry', { hasText: 'Models' }).click();
}

test('Settings → Models v3 on the real engine: discovered models, classes, accounts (req-286, req-287)', async ({ page, electronApp }) => {
  test.setTimeout(300_000);
  fs.mkdirSync(OUT, { recursive: true });
  await sizeWindow(electronApp);
  await expect(page.locator('app-titlebar [role="tab"]', { hasText: 'Work' })).toBeVisible({ timeout: 30_000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // The board draws no side dock: both folded.
  await page.keyboard.press('Control+b');
  await page.keyboard.press('Control+Alt+b');
  await openModels(page);
  const models = page.locator('.mdl');

  // The runner sleeps until a write: Find models again wakes it and asks the harnesses — their rows and the one card.
  await models.locator('button[aria-label="Find models again"]').click();
  const rows = models.locator('.mdl-harnesses .mdl-row');
  await expect(rows).toHaveCount(4, { timeout: 90_000 });
  await expect(rows.nth(0)).toContainText('Claude Code');
  await expect(rows.nth(0)).toContainText('2.1.319');
  await expect(rows.nth(0)).toContainText('4 models');
  await expect(rows.nth(1)).toContainText('zai-coding-plan, github-copilot');
  await expect(rows.nth(2)).toContainText('Kimi CLI');
  await expect(rows.nth(3)).toContainText('not installed');
  const card = models.locator('.mdl-found');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('zai-coding-plan/glm-5.3-air');
  await expect(card.locator('select[aria-label="Class of zai-coding-plan/glm-5.3-air"]')).toHaveValue('light');
  await expect(models.locator('.mdl-note')).toContainText('answered nothing');
  // A write clears the note: the global cap up and back to 6. (Each write is checked on the page first and the file read once
  // after it — a reader holding service.json open while the engine renames its temp file over it fails that write on Windows.)
  const cap = models.locator('.mdl-caprow .mdl-step');
  await cap.locator('button').last().click();
  await expect(cap.locator('b')).toHaveText('7', { timeout: 30_000 });
  await cap.locator('button').first().click();
  await expect(cap.locator('b')).toHaveText('6', { timeout: 30_000 });
  await expect(models.locator('.mdl-note')).toHaveText('');
  expect((stored() as unknown as { capacity: { global: number } }).capacity.global).toBe(6);
  expect(fs.existsSync(path.join(engineHome, '.drey-engine', 'discovery.json'))).toBe(true);

  // The board's state: Claude B asking, Add account open, the class menu on kimi-k3.1-pro.
  await models.locator('.mdl-account', { hasText: 'Claude B' }).locator('button[aria-label="Remove account"]').click();
  await expect(models.locator('.mdl-confirm')).toContainText('Remove Claude B? 1 model uses only this account.');
  await models.locator('.mdl-grouphead button', { hasText: 'Add account' }).click();
  await models.locator('.mdl-addbox-account input').first().fill('Claude C');
  await models.locator('.mdl-addbox-account .mdl-amountfield').fill('90');
  await models.locator('button[aria-label="Class of kimi-k3.1-pro"]').click();
  await page.evaluate(() => document.querySelector('.mdl-titlerow')?.scrollIntoView({ block: 'start', inline: 'nearest' }));
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, 'DeskModelsV3-built.png') });
  await models.locator('.mdl-addbox-account button', { hasText: 'Cancel' }).click();

  const classOf = (name: string) => models.locator('.mdl-class', { has: page.locator('.mdl-classname', { hasText: new RegExp(`^${name}$`) }) });
  // The row's class menu moves kimi-k3.1-pro to standard.
  if ((await page.locator('.mdl-menu').count()) === 0) {
    await models.locator('button[aria-label="Class of kimi-k3.1-pro"]').click();
  }
  await page.locator('.mdl-menu [role="menuitemradio"]', { hasText: 'standard' }).click();
  await expect(classOf('standard').locator('.mdl-modelrow', { hasText: 'kimi-k3.1-pro' })).toHaveCount(1, { timeout: 30_000 });
  expect(modelOf('kimi-k3.1-pro')?.class).toBe('standard');

  // Remove takes Claude B and the model only it serves.
  await models.locator('.mdl-confirm button', { hasText: 'Remove' }).click();
  await expect(models.locator('.mdl-account', { hasText: 'Claude B' })).toHaveCount(0, { timeout: 30_000 });
  await expect(models.locator('.mdl-modelrow', { hasText: 'claude-haiku-5-5' })).toHaveCount(0);
  expect(stored().slots.map((s) => s.id)).toEqual(['claude-a', 'zai', 'kimi', 'copilot']);
  expect(modelOf('claude-haiku-5-5')).toBeUndefined();
  // Claude Code still offers haiku: it is a new card again, now on every Claude account.
  await expect(models.locator('.mdl-found', { hasText: 'claude-haiku-5-5' })).toHaveCount(1);

  // Add: the found model enters the table under the class the card says, on its account.
  const air = models.locator('.mdl-found', { hasText: 'zai-coding-plan/glm-5.3-air' });
  await air.locator('button', { hasText: 'Add' }).click();
  await expect(air).toHaveCount(0, { timeout: 30_000 });
  await expect(classOf('light').locator('.mdl-modelrow', { hasText: 'zai-coding-plan/glm-5.3-air' })).toHaveCount(1);
  expect(modelOf('zai-coding-plan/glm-5.3-air')).toMatchObject({ slot: 'zai', class: 'light' });

  // The router switch.
  const sw = models.locator('input.mdl-sw[aria-label="Router may use kimi-k2.5"]');
  await sw.click();
  await expect(sw).not.toBeChecked({ timeout: 30_000 });
  await expect.poll(() => modelOf('kimi-k2.5')?.enabled, { timeout: 30_000, intervals: [2_000] }).toBe(false);

  // An account's cost, edited in place.
  const zai = models.locator('.mdl-account', { hasText: 'z.ai' });
  await zai.locator('.mdl-amountfield').fill('20');
  await zai.locator('.mdl-amountfield').press('Enter');
  await expect.poll(() => stored().slots.find((s) => s.id === 'zai')?.billing, { timeout: 30_000, intervals: [2_000] }).toMatchObject({ kind: 'subscription', pricePerMonth: 20 });

  // Add class: a class of the owner's own, last in the list.
  await models.locator('.mdl-grouphead button', { hasText: 'Add class' }).click();
  await models.locator('.mdl-addbox input[aria-label="Name"]').fill('bulk');
  await models.locator('.mdl-addbox button', { hasText: 'Add' }).click();
  await expect(classOf('bulk')).toHaveCount(1, { timeout: 30_000 });
  expect(stored().classes.map((c) => c.name)).toEqual(['super heavy', 'heavy', 'standard', 'light', 'bulk']);
});
