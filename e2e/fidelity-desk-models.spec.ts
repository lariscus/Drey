import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test, expect, type ElectronApplication, type Page } from './fixtures/drey';

/**
 * NOT a regression suite: puts the built app in the state of board 7l
 * (DeskModels: Settings → Tickets → Models) and takes the screenshots the
 * fidelity checklist asks for. The engine's `poolModels` and `slots` answers
 * are the board's sample data, put in front of the plugin's handlers (a real
 * engine would need live provider quotas). Opt-in, so CI skips it:
 *
 *   . .\env.ps1
 *   $env:DREY_FIDELITY_SHOTS = '1'
 *   npm run e2e:run -- fidelity-desk-models
 *
 * Output: `test-results/fidelity/DeskModels.png` (+ `.below`, `.rects.json`; 1440x900, scale factor 1);
 * req-181: `DeskModels.routing-edit.png` (a Routing field while typed into), `.routing-saved.png` (after Tab:
 * stored through `poolModelsConfig`), `.routing-refused.png` (a share of 100 % or more, refused under the group).
 */

const RUN = !!process.env['DREY_FIDELITY_SHOTS'];
test.skip(!RUN, 'set DREY_FIDELITY_SHOTS=1 -- the screenshot of board 7l');

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
const HEIGHT = 900;

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

/** A date `daysAhead` days from today at a wall-clock time, or the next given weekday (0 = Sunday). */
function at(daysAhead: number, hour: number, minute = 0, weekday?: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  if (weekday !== undefined) {
    d.setDate(d.getDate() + (((weekday - d.getDay() + 7) % 7) || 7));
  }
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

const win = (name: string, remaining: number | null, resetsAt: string | null, reliability: string, extra: Record<string, unknown> = {}) => ({
  name,
  spanMs: null,
  remaining,
  resetsAt,
  reliability,
  fetchedAt: null,
  ...extra,
});

const slotOf = (id: string, label: string, provider: string, profile: string, billing: unknown, windows: unknown[], q: number | null, quota = 'claude-code') => ({
  id,
  label,
  provider,
  profile,
  billing,
  quota,
  state: 'ready',
  busy: 0,
  total: 2,
  windows,
  q,
  reason: null,
  lastFetch: null,
  lastFetchError: null,
  implied: false,
});

const NEXT_MONTH = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString();

/** The board's sample slots (7l). */
const SLOTS = [
  slotOf('claude-a', 'Claude A', 'claude-code', 'private', { kind: 'subscription', pricePerMonth: 90, currency: 'EUR' }, [win('5h', 0.78, at(0, 14, 20), 'measured'), win('7d', 0.62, at(5, 9, 0), 'measured')], 1.4),
  slotOf('claude-b', 'Claude B', 'claude-code', 'private', { kind: 'subscription', pricePerMonth: 90, currency: 'EUR' }, [win('7d', 0.31, at(5, 9, 0), 'measured')], 0.8),
  slotOf('zai', 'z.ai', 'opencode', 'private', { kind: 'subscription', pricePerMonth: 30, currency: 'EUR' }, [win('5h', 0.55, at(0, 15, 5), 'estimated'), win('7d', 0.7, at(6, 0, 0), 'estimated')], 1.2, 'zai'),
  slotOf('kimi', 'Kimi', 'kimi', 'private', { kind: 'subscription', pricePerMonth: 19, currency: 'EUR' }, [], 1.0, 'counting'),
  slotOf('copilot', 'Copilot', 'opencode', 'work', { kind: 'credits', pricePerCredit: 0.04, currency: 'EUR' }, [win('month', 0.412, NEXT_MONTH, 'estimated', { used: 588, limit: 1000, unit: 'tokens' })], 0.9, 'counting'),
];

const row = (model: string, slot: string, provider: string, category: string, cls: string, cost: number, sessions: number) => ({ model, slot, provider, category, class: cls, cost, sessions });

/** The board's sample pool (7l): the model table, the caps, the ledgers, the live load. */
const POOL = {
  ok: true,
  models: [
    row('claude-opus-4-1', 'claude-a', 'claude-code', 'frontier', 'A', 5, 1),
    row('claude-sonnet-4-5', 'claude-a', 'claude-code', 'everyday', 'B', 1, 2),
    row('claude-sonnet-4-5', 'claude-b', 'claude-code', 'everyday', 'B', 1, 2),
    row('glm-5.3', 'zai', 'opencode', 'everyday', 'B', 0.4, 3),
    row('kimi-k2.5', 'kimi', 'kimi', 'bulk', 'C', 0.3, 2),
    row('gpt-5.4', 'copilot', 'opencode', 'everyday', 'B', 1, 2),
  ],
  capacity: { global: 6, perSlot: {} },
  routing: { upgradeAboveQ: 1.3, reservePerWindow: 0.1, burnRate: 0.2 },
  ledgers: { ticketAllowance: 2.5, personaPerDay: 5, providerPerDay: 15 },
  now: {
    used: 2.4,
    global: 6,
    slots: [
      { id: 'claude-a', label: 'Claude A', used: 2, cap: 5, derived: true },
      { id: 'claude-b', label: 'Claude B', used: 0, cap: 2, derived: true },
      { id: 'zai', label: 'z.ai', used: 0.4, cap: 1.2, derived: true },
      { id: 'kimi', label: 'Kimi', used: 0, cap: 0.6, derived: true },
      { id: 'copilot', label: 'Copilot', used: 0, cap: 2, derived: true },
    ],
  },
  queue: [],
  providerDay: [],
  errors: [],
  configPath: 'service.json',
};

/** Puts the sample answers in front of the tickets plugin's two read handlers (and req-181's routing write); everything else goes on to the real ones. */
async function mockPool(app: ElectronApplication): Promise<void> {
  await app.evaluate(
    ({ ipcMain }, data) => {
      const registry = ipcMain as unknown as { _invokeHandlers: Map<string, (event: unknown, payload: { pluginId: string; method: string; payload?: unknown }) => unknown> };
      const original = registry._invokeHandlers.get('plugin:invoke');
      if (original === undefined) {
        throw new Error('no plugin:invoke handler to wrap');
      }
      ipcMain.removeHandler('plugin:invoke');
      let pool: Record<string, unknown> = data.pool;
      ipcMain.handle('plugin:invoke', (event, payload: { pluginId: string; method: string; payload?: unknown }) => {
        if (payload.pluginId === 'tickets' && payload.method === 'poolModels') {
          return pool;
        }
        if (payload.pluginId === 'tickets' && payload.method === 'poolModelsConfig') {
          const routing = (payload.payload as { routing?: { burnRate?: number } } | undefined)?.routing;
          if (routing !== undefined && typeof routing.burnRate === 'number' && routing.burnRate >= 1) {
            return { ok: false, error: 'routing.burnRate must be a share from 0 to below 1 (0.2 = 20 % of the weekly quota per day; 0 = off)' };
          }
          pool = { ...pool, ...(routing !== undefined ? { routing } : {}) };
          return pool;
        }
        if (payload.pluginId === 'tickets' && payload.method === 'slots') {
          return { ok: true, slots: data.slots, configPath: 'service.json' };
        }
        return original(event, payload);
      });
    },
    { pool: POOL, slots: SLOTS },
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

test('board 7l: Settings → Tickets → Models', async ({ page, electronApp }) => {
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
  await expect(page.locator('.tset-models-card').first()).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(900);
  await shoot(page, 'DeskModels');
  const rects = await page.evaluate(() => {
    const rel = (e: Element | null): number[] | null => {
      if (e === null) {
        return null;
      }
      const x = e.getBoundingClientRect();
      return [x.left, x.top, x.width, x.height].map((v) => Math.round(v * 10) / 10);
    };
    const q = (s: string): Element | null => document.querySelector(s);
    const all = (s: string): Element[] => [...document.querySelectorAll(s)];
    return {
      title: rel(q('.tset-models-title')),
      groups: all('.tset-models-group').map(rel),
      th: all('.tset-models-table th').map(rel),
      rows: all('.tset-models-table tbody tr').map(rel),
      chip: rel(q('.tset-models-chipwrap .tset-models-chip')),
      addModel: rel(q('.tset-models-addrow .tset-models-btn')),
      globalCap: rel(q('input[aria-label="Global cap"]')),
      perProvider: rel(q('.tset-models-perprovider')),
      cards: all('.tset-models-card').map(rel),
      cardHead: rel(q('.tset-models-cardhead')),
      windows: all('.tset-models-card:first-child .tset-models-window').map(rel),
      bars: all('.tset-models-card:first-child .tset-models-bar').map(rel),
      fills: all('.tset-models-card:first-child .tset-models-fill').map(rel),
      q: rel(q('.tset-models-card:first-child .tset-models-q')),
    };
  });
  fs.writeFileSync(path.join(OUT, 'DeskModels.rects.json'), JSON.stringify(rects));
  // The rest of the page, below the board's fold.
  await page.locator('app-settings .detail').evaluate((node) => node.scrollBy({ top: 600 }));
  await shoot(page, 'DeskModels.below');
  await page.locator('app-settings .detail').evaluate((node) => node.scrollBy({ top: 600 }));
  await shoot(page, 'DeskModels.below2');

  // req-181: the Routing group stores what it shows — typed into, saved on Tab, a refusal under the group.
  const burn = page.locator('input[aria-label="Burn rate"]');
  await page.locator('.tset-models-group', { hasText: 'Routing' }).evaluate((node) => node.scrollIntoView({ block: 'center' }));
  await expect(burn).toHaveValue('20');
  await burn.click();
  await burn.fill('25');
  await shoot(page, 'DeskModels.routing-edit');
  await page.keyboard.press('Tab');
  await expect(burn).toHaveValue('25');
  await shoot(page, 'DeskModels.routing-saved');
  const routingRects = await page.evaluate(() => {
    const rel = (e: Element | null): number[] | null => {
      if (e === null) {
        return null;
      }
      const x = e.getBoundingClientRect();
      return [x.left, x.top, x.width, x.height].map((v) => Math.round(v * 10) / 10);
    };
    return {
      fields: ['Upgrade above q', 'Reserve per window', 'Burn rate'].map((label) => rel(document.querySelector(`input[aria-label="${label}"]`))),
      rule: rel(document.querySelector('.tset-models-rule')),
    };
  });
  fs.writeFileSync(path.join(OUT, 'DeskModels.routing-rects.json'), JSON.stringify(routingRects));
  await burn.fill('120');
  await page.keyboard.press('Tab');
  await expect(page.locator('.tset-models-error', { hasText: 'A share from 0 to below 100 %.' })).toBeVisible();
  await shoot(page, 'DeskModels.routing-refused');
});
