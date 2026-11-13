import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test, expect, type ElectronApplication, type Page } from './fixtures/drey';

/**
 * NOT a regression suite: board 7l v3 (DeskModelsV3: Settings → Tickets → Models) as a screenshot for the
 * fidelity check. The engine answers of `poolModels` and `slots` are the board sample data, put in front of
 * the plugin handlers. Opt-in:
 *
 *   DREY_FIDELITY_SHOTS=1 npm run e2e:run -- fidelity-desk-models-v3
 *
 * Output: `test-results/fidelity/DeskModelsV3.png` (+ `.rects.json`; 1440x1700, scale factor 1).
 */

const RUN = !!process.env['DREY_FIDELITY_SHOTS'];
test.skip(!RUN, 'set DREY_FIDELITY_SHOTS=1 -- the screenshot of board 7l v3');

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
const WIDTH = 1440;
const HEIGHT = 1700;

const PIPELINE = [
  '---',
  'phases:',
  '  - { id: inbox, title: Inbox, handover: manual }',
  '  - { id: build, title: Building, handover: agent build-default, persona: ben }',
  '  - { id: ready, title: Ready to try, handover: manual }',
  '  - { id: done, title: Done, handover: none }',
  '---',
  'The phases.',
  '',
].join('\n');

const REPOS = ['---', 'repos:', '  drey:', '    url: https://example.invalid/drey.git', '    branch: main', '---', ''].join('\n');

function persona(title: string, role: string, color: string, budget: number): string {
  return ['---', `title: ${title}`, `role: ${role}`, 'worker: opencode', 'models:', '  default: qwen3-coder', '  pool: [qwen3-coder]', `color: '${color}'`, 'skills: []', `budget: ${budget}`, '---', `Who ${title} is.`, ''].join('\n');
}

function ticket(id: string, title: string, phase: string): string {
  return [
    '---',
    `id: ${id}`,
    `title: "${title}"`,
    'repo: drey',
    'priority: normal',
    `branch: t/${id}`,
    "entered-inbox: '2026-10-20T09:00:00Z'",
    ...(phase === 'inbox' ? [] : [`entered-${phase}: '2026-10-30T09:00:00Z'`]),
    '---',
    '',
    '## Description',
    '',
    `${title} - what the owner wants.`,
    '',
    '## Log',
    '',
  ].join('\n');
}

const seed: Record<string, string> = {
  'tickets/_meta/pipeline.md': PIPELINE,
  'tickets/_meta/repos.md': REPOS,
  'tickets/_meta/personas/paul/persona.md': persona('Paul', 'planner', '#f2d3e2', 3),
  'tickets/_meta/personas/ben/persona.md': persona('Ben', 'builder', '#8ecbef', 15),
  'tickets/_meta/personas/ralf/persona.md': persona('Ralf', 'reviewer', '#bfe3cd', 4),
  'tickets/_meta/personas/tessa/persona.md': persona('Tessa', 'tester', '#f2cfae', 7),
  'tickets/10-inbox/T-0133.md': ticket('T-0133', 'Sync status in the title bar', 'inbox'),
  'tickets/40-build/T-0017.md': ticket('T-0017', 'A8 large modules', 'build'),
  'projects/Notes.md': '# Notes\n\n412 words of nothing in particular.\n',
};

async function pushChain(app: ElectronApplication): Promise<void> {
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
        runs: [],
        chain: { configured: true, master: 'run', autopilot: { state: 'on' }, columns: {}, redStreak: {}, cooldownUntil: {}, poolSize: {} },
      },
    },
  );
}

async function sizeWindow(app: ElectronApplication): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow }, size) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (win.webContents.getURL().startsWith('app://')) {
          win.setContentSize(size.width, size.height);
        }
      }
    },
    { width: WIDTH, height: HEIGHT },
  );
}

async function shoot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}


const win = (name: string, remaining: number) => ({ name, spanMs: null, remaining, resetsAt: null, reliability: 'measured', fetchedAt: null });

const slotOf = (id: string, label: string, provider: string, billing: unknown, windows: unknown[], total: number) => ({
  id,
  label,
  provider,
  billing,
  quota: 'claude-code',
  state: 'ready',
  busy: 0,
  total,
  windows,
  q: 1,
  reason: null,
  lastFetch: null,
  lastFetchError: null,
  implied: false,
});

const sub = (pricePerMonth: number) => ({ kind: 'subscription', pricePerMonth, currency: 'EUR' });

/** The board's accounts (7l v3). */
const SLOTS = [
  slotOf('claude-a', 'Claude A', 'claude-code', sub(90), [win('5h', 0.78), win('7d', 0.62)], 2),
  slotOf('claude-b', 'Claude B', 'claude-code', sub(90), [win('5h', 0.5), win('7d', 0.5)], 2),
  slotOf('zai', 'z.ai', 'opencode', sub(15), [win('5h', 0.91), win('7d', 0.7)], 3),
  slotOf('kimi', 'Kimi', 'kimi', sub(19), [win('5h', 0.64), win('7d', 0.4)], 2),
  slotOf('copilot', 'Copilot', 'opencode', { kind: 'credits', pricePerCredit: 0.04, currency: 'EUR' }, [], 2),
];

const row = (model: string, slot: string, provider: string, cls: string, cost: number, context: number, image: boolean) => ({
  model,
  slot,
  provider,
  category: 'everyday',
  class: cls,
  cost,
  enabled: true,
  tools: true,
  context,
  ...(image ? { input: ['text', 'image'] } : {}),
});

const harness = (provider: string, label: string, version: string | null, state: string, providers: string[], models: number) => ({ provider, label, version, state, providers, models, error: null });

/** The board's sample pool (7l v3); `checkedAt` is set when the mock is installed. */
const poolOf = (checkedAt: string) => ({
  ok: true,
  classes: [
    { name: 'super heavy', sessions: 1 },
    { name: 'heavy', sessions: 2 },
    { name: 'standard', sessions: 4 },
    { name: 'light', sessions: 6 },
  ],
  models: [
    row('claude-fable-5-2', 'claude-a', 'claude-code', 'super heavy', 12, 1_000_000, true),
    row('claude-opus-5-5', 'claude-a', 'claude-code', 'heavy', 5, 1_000_000, true),
    row('kimi-k3.1-pro', 'kimi', 'kimi', 'heavy', 2, 256_000, false),
    row('claude-sonnet-5-5', 'claude-a', 'claude-code', 'standard', 1, 1_000_000, true),
    row('zai-coding-plan/glm-5.3', 'zai', 'opencode', 'standard', 0.4, 128_000, false),
    row('github-copilot/gpt-5.4', 'copilot', 'opencode', 'standard', 1, 128_000, true),
    row('claude-haiku-5-5', 'claude-a', 'claude-code', 'light', 0.3, 200_000, true),
    row('kimi-k2.5', 'kimi', 'kimi', 'light', 0.3, 128_000, false),
  ],
  capacity: { global: 6, perSlot: {} },
  routing: { upgradeAboveQ: 1.3, reservePerWindow: 0.1, burnRate: 0.8 },
  ledgers: { ticketAllowance: 2.5, personaPerDay: 5, providerPerDay: 15 },
  now: {
    used: 2.4,
    global: 6,
    slots: [],
    classes: [
      { name: 'super heavy', busy: 0, cap: 1 },
      { name: 'heavy', busy: 1, cap: 2 },
      { name: 'standard', busy: 2, cap: 4 },
      { name: 'light', busy: 0, cap: 6 },
    ],
  },
  queue: [],
  providerDay: [],
  errors: [],
  configPath: 'service.json',
  discovery: {
    checkedAt,
    running: false,
    harnesses: [
      harness('claude-code', 'Claude Code', '2.1.319', 'signed-in', [], 4),
      harness('opencode', 'opencode', '2.0.32', 'signed-in', ['zai-coding-plan', 'github-copilot'], 3),
      harness('kimi', 'Kimi CLI', '1.6', 'signed-in', [], 2),
      harness('copilot', 'Copilot CLI', null, 'not-installed', [], 0),
    ],
    found: [{ model: 'zai-coding-plan/glm-5.3-air', provider: 'opencode', slot: 'zai', name: null, capabilities: {}, suggested: 'light' }],
    ignored: [],
  },
});

/** Puts the sample answers in front of the tickets plugin's two read handlers; everything else goes on to the real ones. */
async function mockPool(app: ElectronApplication): Promise<void> {
  await app.evaluate(
    ({ ipcMain }, data) => {
      const registry = ipcMain as unknown as { _invokeHandlers: Map<string, (event: unknown, payload: { pluginId: string; method: string; payload?: unknown }) => unknown> };
      const original = registry._invokeHandlers.get('plugin:invoke');
      if (original === undefined) {
        throw new Error('no plugin:invoke handler to wrap');
      }
      ipcMain.removeHandler('plugin:invoke');
      ipcMain.handle('plugin:invoke', (event, payload: { pluginId: string; method: string; payload?: unknown }) => {
        if (payload.pluginId === 'tickets' && payload.method === 'poolModels') {
          return data.pool;
        }
        if (payload.pluginId === 'tickets' && payload.method === 'slots') {
          return { ok: true, slots: data.slots, configPath: 'service.json' };
        }
        return original(event, payload);
      });
    },
    { pool: poolOf(new Date(Date.now() - 135_000).toISOString()), slots: SLOTS },
  );
}

test.use({
  seedVault: seed,
  launchArgs: ['--force-device-scale-factor=1'],
  appConfig: {
    plugins: { disabled: ['sample', 'templates', 'browser', 'drawio', 'ocr', 'meeting'] },
    spellcheck: { enabled: false },
    llm: { enabled: true, provider: 'openai-compat', baseUrl: 'http://127.0.0.1:9/v1', apiKey: null, model: 'glm-5.3-flash' },
  },
});

test('board 7l v3: Settings → Tickets → Models', async ({ page, electronApp }) => {
  test.setTimeout(240_000);
  fs.mkdirSync(OUT, { recursive: true });
  await mockPool(electronApp);
  await sizeWindow(electronApp);
  await expect(page.locator('app-titlebar [role="tab"]', { hasText: 'Work' })).toBeVisible({ timeout: 30_000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await pushChain(electronApp);
  await page.keyboard.press('Control+2');
  await page.waitForTimeout(500);
  // The board draws no side panel: every panel in the left dock, both docks folded.
  await page.evaluate(() => {
    const ids = [...document.querySelectorAll<HTMLElement>('app-dock-strip button[data-widget]')].map((b) => b.dataset['widget'] ?? '');
    const saved = JSON.parse(localStorage.getItem('drey.dock') ?? '{}') as { active: string; views: Record<string, Record<string, unknown>> };
    const view = saved.views[saved.active];
    saved.views[saved.active] = {
      ...view,
      dock: { left: ids, right: [], bottom: (view['dock'] as { bottom: string[] }).bottom },
      bottomH: 140,
      open: Object.fromEntries(ids.map((id) => [id, false])),
      foldedSides: ['left', 'right'],
    };
    localStorage.setItem('drey.dock', JSON.stringify(saved));
  });
  await page.reload();
  await sizeWindow(electronApp);
  await expect(page.locator('app-titlebar [role="tab"]', { hasText: 'Work' })).toBeVisible({ timeout: 30_000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.keyboard.press('Control+p');
  await page.locator('.palette input').fill('T-0017');
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  await page.locator('app-status-bar .settings').click();
  await expect(page.locator('app-settings .category').first()).toBeVisible();
  await pushChain(electronApp);
  await page.locator('app-settings .category', { hasText: 'Tickets' }).first().click();
  await page.locator('app-settings .section-entry', { hasText: 'Models' }).click();
  await expect(page.locator('.mdl-class').first()).toBeVisible({ timeout: 20_000 });
  // The board's state: the class menu open on kimi-k3.1-pro, Claude B asking, Add account open.
  await page.locator('.mdl-account', { hasText: 'Claude B' }).locator('button[aria-label="Remove account"]').click();
  await page.locator('.mdl-grouphead button', { hasText: 'Add account' }).click();
  await page.locator('.mdl-addbox input').first().fill('Claude C');
  await page.locator('.mdl-addbox .mdl-amountfield').fill('90');
  await page.locator('.mdl-addbox .mdl-amountfield').dispatchEvent('change');
  await page.locator('button[aria-label="Class of kimi-k3.1-pro"]').click();
  await page.waitForTimeout(900);
  await shoot(page, 'DeskModelsV3');
  const rects = await page.evaluate(() => {
    const rel = (e: Element | null): number[] | null => {
      if (e === null) {
        return null;
      }
      const x = e.getBoundingClientRect();
      return [x.left, x.top, x.width, x.height].map((v) => Math.round(v * 10) / 10);
    };
    const all = (s: string): Element[] => [...document.querySelectorAll(s)];
    return {
      title: rel(document.querySelector('.mdl-title')),
      groups: all('.mdl-h2').map(rel),
      harnessRows: all('.mdl-harnesses .mdl-row').map(rel),
      found: rel(document.querySelector('.mdl-found')),
      classes: all('.mdl-class').map(rel),
      modelRows: all('.mdl-modelrow').map(rel),
      addbox: rel(document.querySelector('.mdl-addbox')),
      accounts: all('.mdl-account, .mdl-confirm').map(rel),
      fold: rel(document.querySelector('.mdl-fold')),
    };
  });
  fs.writeFileSync(path.join(OUT, 'DeskModelsV3.rects.json'), JSON.stringify(rects));
});
