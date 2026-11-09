import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test, expect, type ElectronApplication, type Page } from './fixtures/drey';

/**
 * NOT a regression suite: puts the built app in the states of board 7g
 * (DeskSettings) and the desktop part of board 10t (Autopilot) and takes the
 * screenshots the fidelity checklist asks for. Opt-in, so CI skips it:
 *
 *   . .\env.ps1
 *   $env:DREY_FIDELITY_SHOTS = '1'
 *   npm run e2e:run -- fidelity-desk-settings
 *
 * Output: `test-results/fidelity/<Board>.png` (1440x900, scale factor 1).
 */

const RUN = !!process.env['DREY_FIDELITY_SHOTS'];
test.skip(!RUN, 'set DREY_FIDELITY_SHOTS=1 -- the screenshots of boards 7g and 10t');

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
  return ['---', `title: ${title}`, `role: ${role}`, 'worker: opencode', 'models:', '  default: qwen3-coder', '  pool: [qwen3-coder]', '  router: off', `color: '${color}'`, 'skills: []', `budget: ${budget}`, '---', `Who ${title} is.`, ''].join('\n');
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

const settled = (ticketId: string, personaId: string, cost: number): string =>
  JSON.stringify({ v: 1, ts: new Date().toISOString(), event: 'run_settled', ticket: ticketId, persona: personaId, model: 'qwen3-coder', tokensIn: 40_000, tokensOut: 3_000, cost });

const seed: Record<string, string> = {
  'tickets/_meta/pipeline.md': PIPELINE,
  'tickets/_meta/repos.md': REPOS,
  'tickets/_meta/personas/paul/persona.md': persona('Paul', 'planner', '#f2d3e2', 3),
  'tickets/_meta/personas/ben/persona.md': persona('Ben', 'builder', '#8ecbef', 15),
  'tickets/_meta/personas/ralf/persona.md': persona('Ralf', 'reviewer', '#bfe3cd', 4),
  'tickets/_meta/personas/tessa/persona.md': persona('Tessa', 'tester', '#f2cfae', 7),
  'tickets/_meta/ledger.jsonl': [settled('T-0121', 'ben', 4.1), ''].join('\n'),
  'tickets/10-inbox/T-0133.md': ticket('T-0133', 'Sync status in the title bar', 'inbox'),
  'tickets/40-build/T-0017.md': ticket('T-0017', 'A8 large modules', 'build'),
  'projects/Notes.md': '# Notes\n\n412 words of nothing in particular.\n',
};

/** Board 10t's tranche (4 of 10 runs, $4.10 of $15, 2 h 10 min left, the bar at 40 %): started 87 min ago, ends in 130. */
function tranche(patch: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Date.now();
  return {
    index: 1,
    of: 3,
    done: 4,
    total: 10,
    spent: 4.1,
    budget: 15,
    startedAt: new Date(now - 87 * 60_000).toISOString(),
    endsAt: new Date(now + 130 * 60_000).toISOString(),
    checkpoint: null,
    report: null,
    ...patch,
  };
}

/** Board 10u part 1: 7 of 8 gates green, +212 -40, $0.41 median / $1.20 max, T-0119 ran twice, 10 runs, $4.10, 130 min. */
const REPORT = {
  kind: 'end',
  at: new Date(new Date().setHours(14, 2, 0, 0)).toISOString(),
  endedBy: 'runs',
  runs: 10,
  spent: 4.1,
  minutes: 130,
  gates: { green: 7, total: 8 },
  change: { added: 212, removed: 40 },
  cost: { median: 0.41, max: 1.2 },
  repeated: { ticket: 'T-0119', runs: 2 },
  earlyStop: null,
};

/** Board 10u part 6: three of the last six gates red, six runs left, three red tickets. */
const EARLY_REPORT = {
  ...REPORT,
  kind: 'early',
  at: new Date(new Date().setHours(14, 4, 0, 0)).toISOString(),
  endedBy: null,
  earlyStop: {
    rule: 'gate_rate',
    red: 3,
    window: 6,
    runsLeft: 6,
    ticket: null,
    value: null,
    median: null,
    tickets: [
      { ticket: 'T-0119', phase: 'build', persona: 'ben', red: 2 },
      { ticket: 'T-0124', phase: 'test', persona: 'tessa', red: 1 },
      { ticket: 'T-0125', phase: 'review', persona: 'ralf', red: 1 },
    ],
  },
};

async function pushChain(
  app: ElectronApplication,
  autopilot: { state: string; resumeAt?: string; reason?: string },
  trancheBlock?: Record<string, unknown>,
): Promise<void> {
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
        chain: {
          configured: true,
          master: autopilot.state === 'off' ? 'halted' : 'run',
          autopilot,
          columns: {},
          redStreak: {},
          cooldownUntil: {},
          poolSize: { opencode: 2, 'claude-code': 3 },
          ...(trancheBlock === undefined ? {} : { tranche: trancheBlock }),
        },
      },
    },
  );
}

async function sizeWindow(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }, size) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.webContents.getURL().startsWith('app://')) {
        win.setContentSize(size.width, size.height);
      }
    }
  }, { width: WIDTH, height: HEIGHT });
}

async function shoot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
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

test('boards 7g and 10t desktop: Settings, the Autopilot item', async ({ page, electronApp }) => {
  test.setTimeout(240_000);
  fs.mkdirSync(OUT, { recursive: true });
  await sizeWindow(electronApp);
  await expect(page.locator('app-titlebar [role="tab"]', { hasText: 'Work' })).toBeVisible({ timeout: 30_000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await pushChain(electronApp, { state: 'on' }, tranche());
  await page.waitForTimeout(800);

  // 10t desktop: the item and its popover in each state.
  const item = page.locator('app-status-bar button', { hasText: 'Autopilot' });
  await expect(item).toBeVisible({ timeout: 20_000 });
  await item.click();
  await expect(page.getByRole('dialog', { name: 'Autopilot' })).toBeVisible();
  await shoot(page, 'Autopilot.desktop-on');
  // The measures the board's markup gives (rects relative to the popover), for the comparison.
  const rects = await page.evaluate(() => {
    const dlg = document.querySelector('.tickets-autopilot-pop') as HTMLElement;
    const base = dlg.getBoundingClientRect();
    const rel = (e: Element): number[] => {
      const x = e.getBoundingClientRect();
      return [x.left - base.left, x.top - base.top, x.width, x.height].map((v) => Math.round(v * 10) / 10);
    };
    const o: Record<string, number[]> = { dialog: [base.left, base.top, base.width, base.height] };
    [...dlg.children].forEach((c, i) => (o[`child${i}`] = rel(c)));
    [...dlg.querySelectorAll('[role=radio]')].forEach((c, i) => (o[`seg${i}`] = rel(c)));
    const item = document.querySelector('app-status-bar button[aria-haspopup]') as HTMLElement;
    const ib = item.getBoundingClientRect();
    o['item'] = [ib.left, ib.top, ib.width, ib.height];
    const bb = item.parentElement!.getBoundingClientRect();
    o['bar'] = [bb.left, bb.top, bb.width, bb.height];
    return o;
  });
  fs.writeFileSync(path.join(OUT, 'Autopilot.desktop-rects.json'), JSON.stringify(rects));
  // Paused at a checkpoint (the iPad state of the board at the desktop popover's scale).
  await pushChain(electronApp, { state: 'paused', reason: 'checkpoint' }, tranche({ done: 10, checkpoint: 'waiting', report: REPORT }));
  await expect(page.locator('.tickets-autopilot-release')).toBeVisible();
  await shoot(page, 'Autopilot.desktop-checkpoint');
  await pushChain(electronApp, { state: 'paused', resumeAt: new Date(new Date().setHours(18, 0, 0, 0)).toISOString() });
  await shoot(page, 'Autopilot.desktop-paused');
  await pushChain(electronApp, { state: 'off' });
  await shoot(page, 'Autopilot.desktop-off');
  await page.keyboard.press('Escape');

  // 10u parts 1 and 6: the two cards in the Assistant's Mission Control thread.
  await pushChain(electronApp, { state: 'paused', reason: 'checkpoint' }, tranche({ done: 10, checkpoint: 'waiting', report: REPORT }));
  const assistant = page.locator('app-panel-frame', { has: page.locator('.assistant-panel') });
  await assistant.locator('.assistant-targets').getByLabel(/Mission Control/).first().click();
  const card = assistant.locator('.target-card-rich');
  await expect(card).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(400);
  await card.screenshot({ path: path.join(OUT, 'MCCards.desktop-checkpoint.png') });
  await pushChain(electronApp, { state: 'paused', reason: 'checkpoint' }, tranche({ done: 4, checkpoint: 'waiting', report: EARLY_REPORT }));
  await expect(card.locator('.target-card-row').first()).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(400);
  await card.screenshot({ path: path.join(OUT, 'MCCards.desktop-early.png') });
  await page.screenshot({ path: path.join(OUT, 'MCCards.desktop-panel.png') });
  const cardRects = await card.evaluate((root) => {
    const base = root.getBoundingClientRect();
    const rel = (e: Element): number[] => {
      const x = e.getBoundingClientRect();
      return [x.left - base.left, x.top - base.top, x.width, x.height].map((v) => Math.round(v * 10) / 10);
    };
    const o: Record<string, number[]> = { card: [base.width, base.height] };
    [...root.children].forEach((c, i) => (o[`child${i}_${c.className}`] = rel(c)));
    return o;
  });
  fs.writeFileSync(path.join(OUT, 'MCCards.desktop-rects.json'), JSON.stringify(cardRects));
  await pushChain(electronApp, { state: 'on' });

  // 7g: the Work view with both docks folded, the ticket's tab, then the Settings tab (Tickets, All devices).
  await page.keyboard.press('Control+2');
  await page.waitForTimeout(500);
  // The board draws no side panel: every panel in the left dock, the right dock empty, both docks folded. The Work view keeps its Capacity band (milestone 180).
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
  await page.locator('app-settings .category', { hasText: 'Tickets' }).first().click();
  await shoot(page, 'DeskSettings');
  // The rest of the page, as far as the board's sample content goes (the board shows it only below its fold).
  await page.locator('app-settings .section-entry', { hasText: 'Budget and runners' }).click();
  await page.waitForTimeout(700);
  await shoot(page, 'DeskSettings.budget');
  await page.locator('app-settings .section-entry', { hasText: 'Walkthrough videos' }).click();
  await page.waitForTimeout(700);
  await shoot(page, 'DeskSettings.videos');
  await page.locator('app-settings .section-entry', { hasText: 'Devices' }).click();
  await page.waitForTimeout(700);
  await shoot(page, 'DeskSettings.devices');
  // Optional: a probe script (returns element rects) to compare against the board's markup.
  const probe = process.env['FIDELITY_PROBE'];
  if (probe) {
    const rects = await page.evaluate(fs.readFileSync(probe, 'utf8'));
    fs.writeFileSync(path.join(OUT, 'DeskSettings.rects.json'), JSON.stringify(rects));
  }
});
