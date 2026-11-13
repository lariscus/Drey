import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect, type ElectronApplication, type Page } from './fixtures/drey';

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

const dk = (args: string[], owner = 'henrik'): string =>
  execFileSync(bin, args, { cwd: fs.existsSync(storeDir) ? storeDir : root, env: { ...process.env, DK_OWNER: owner, DK_STORE: storeDir, DK_DATA_DIR: dataDir }, encoding: 'utf8', windowsHide: true, stdio: 'pipe' });
const git = (...args: string[]): string => execFileSync('git', args, { cwd: storeDir, encoding: 'utf8', windowsHide: true, stdio: 'pipe' });
const shown = (id: string): string => (JSON.parse(dk(['show', id, '--json'])) as { data: { content: string } }).data.content;
const field = (id: string, key: string): string | null => new RegExp(`^${key}: (.*)$`, 'm').exec(shown(id))?.[1]?.trim() ?? null;

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
const STANDARD = 'paul:shape;paul;ben;ralf;tessa;you';

/** One seeded ticket: its title, stage and the chain fields; `T-000n` follows the creation order. */
interface Seed {
  readonly title: string;
  readonly stage: 'inbox' | 'prioritized' | 'active' | 'done';
  readonly chain?: string;
  readonly at?: number;
  readonly extra?: Record<string, string>;
  readonly priority?: string;
  readonly comment?: string;
  readonly cost?: number;
}

const SEEDS: readonly Seed[] = [
  { title: 'Sync status in the title bar', stage: 'inbox' },
  { title: 'Backlinks: unlinked mentions', stage: 'inbox' },
  { title: 'Calendar week numbers', stage: 'inbox' },
  { title: 'Dark mode for the PDF export', stage: 'inbox' },
  { title: 'Spell-check the commit message', stage: 'inbox' },
  { title: 'Daily note template picker', stage: 'inbox' },
  { title: 'Spellcheck: add French dictionary', stage: 'prioritized', priority: 'high' },
  { title: 'Tag rename keeps pill colors', stage: 'prioritized', chain: 'ben;tessa;you' },
  { title: 'Pin tabs to the left', stage: 'prioritized' },
  { title: 'Voice capture for tickets', stage: 'active', at: 1, cost: 0.18 },
  { title: 'Weekly security audit run', stage: 'active', chain: 'paul;you', at: 1, cost: 0.46 },
  { title: 'Export the vault as a zip', stage: 'active', at: 3, extra: { 'x-sent-back': '5>3' }, cost: 0.74 },
  { title: 'Palette: recent commands', stage: 'active', at: 3, cost: 0.88 },
  { title: 'Win+H dictation hand-off', stage: 'active', at: 3, cost: 0.3 },
  { title: 'Settings search across plugins', stage: 'active', at: 4, cost: 0.9 },
  { title: 'PDF export keeps callout colors', stage: 'active', at: 5, cost: 1.05 },
  { title: 'Outline: drag headings to reorder', stage: 'active', at: 3, extra: { 'x-awaiting': 'you' }, comment: 'needs-decision: [drag-body] Should dragging a heading also move the text below it?', cost: 1.2 },
  { title: 'Theme picker in the status bar', stage: 'active', chain: 'paul:shape;paul;ben;ghost;tessa;you', at: 4 },
  { title: 'Tag field: paste a list', stage: 'active', at: 4, extra: { 'x-awaiting': 'you', 'x-sent-back': '5>4' }, comment: 'needs-decision: [second-send-back] Sent back a second time: the paste drops the last tag.', cost: 1.96 },
  { title: 'Palette opens twice on slow CI', stage: 'active', at: 6, cost: 1.84 },
  { title: 'Tag rename keeps descendants', stage: 'done', cost: 2.1 },
  { title: 'Spellcheck: German dictionary', stage: 'done', cost: 1.45 },
  { title: 'Pin a note to the calendar', stage: 'done' },
  { title: 'Calendar week starts on Monday', stage: 'done' },
  { title: 'Find: remember the scope', stage: 'done' },
];

const idOf = (index: number): string => `T-${String(index + 1).padStart(4, '0')}`;
const dkIdOf = (index: number): string => `t-${index + 1}`;
const byTitle = (title: string): string => idOf(SEEDS.findIndex((seed) => seed.title === title));

function seedStore(): void {
  dk(['init', storeDir, 't']);
  git('config', 'core.autocrlf', 'false');
  git('checkout', '-q', 'main');
  const toml = path.join(storeDir, 'dricket.toml');
  fs.writeFileSync(toml, `${fs.readFileSync(toml, 'utf8').replace(/\[transitions\.agent\][\s\S]*?(?=\n\[|$)/, '')}\n[stages]\nvalues = ["inbox", "prioritized", "active", "running", "done"]\ninitial = "inbox"\nterminal = ["done"]\nclaim = ["running"]\ncancelled = "cancelled"\n`);
  git('commit', '-q', '-am', 'the lifecycle stages');
  git('checkout', '-q', 'tickets');
  SEEDS.forEach((seed, index) => {
    const id = dk(['add', '--unclaimed', '-m', seed.title]).trim();
    const text = shown(id);
    const fields = ['x-entered-inbox: 2026-11-10T09:00:00Z', `x-chain: ${seed.chain ?? STANDARD}`, ...(seed.at === undefined ? [] : [`x-at: ${seed.at}`]), ...Object.entries(seed.extra ?? {}).map(([k, v]) => `${k}: ${v}`)];
    // Every ticket names the work repository but the one You accepts at the end (a repository ticket's sign-off would start the commit run).
    const repo = seed.title === 'Palette opens twice on slow CI' ? '' : 'repos: drey\n';
    let header = text.replace(/^repos:.*\n/m, '').replace(/^stage: .*$/m, `${repo}stage: ${seed.stage}\n${fields.join('\n')}`);
    if (seed.priority !== undefined) {
      header = /^priority: .*$/m.test(header) ? header.replace(/^priority: .*$/m, `priority: ${seed.priority}`) : header.replace(/^stage: /m, `priority: ${seed.priority}\nstage: `);
    }
    const file = path.join(root, `${id}.md`);
    fs.writeFileSync(file, `${header.replace(/\s*$/, '\n')}`);
    dk(['put', id, '-F', file, '--claim', '--if-version', /^rev: (\d+)$/m.exec(text)?.[1] ?? '1']);
    if (seed.comment !== undefined) {
      dk(['comment', id, '-m', seed.comment]);
    }
    void index;
  });
}

const persona = (title: string, kind: string, color: string, extra: string[] = []): string =>
  ['---', `title: ${title}`, ...(kind === 'agent' ? [] : [`kind: ${kind}`]), 'role: custom', 'worker: opencode', 'models:', '  default: qwen3-coder', '  pool: [qwen3-coder]', `color: '${color}'`, ...extra, '---', `Who ${title} is.`, ''].join('\n');

const now = new Date();
const settled = (ticket: string, who: string, cost: number): string =>
  JSON.stringify({ v: 1, ts: now.toISOString(), event: 'run_settled', ticket, persona: who, model: 'qwen3-coder', tokensIn: 40_000, tokensOut: 3_000, cost });

const SEED_VAULT: Record<string, string> = {
  'tickets/_meta/pipeline.md': ['---', 'phases:', '  - { id: inbox, title: Inbox, handover: manual }', '  - { id: prioritized, title: Prioritized, handover: manual }', '  - { id: done, title: Done, handover: none }', 'flow: paul:shape; paul; ben; ralf; tessa; you', '---', 'The lifecycle columns.', ''].join('\n'),
  'tickets/_meta/repos.md': ['---', 'repos:', '  drey:', '    url: https://example.invalid/drey.git', '    branch: main', '---', ''].join('\n'),
  'tickets/_meta/crew.md': ['---', 'order: [pia, paul, ben, ralf, tessa, you]', '---', ''].join('\n'),
  'tickets/_meta/personas/pia/persona.md': persona('Pia', 'mission', '#f2d3e2'),
  'tickets/_meta/personas/paul/persona.md': persona('Paul', 'agent', '#f2d3e2', ['parallel: 1']),
  'tickets/_meta/personas/ben/persona.md': persona('Ben', 'agent', '#8ecbef', ['parallel: 2', 'leaving: [sync-main]']),
  'tickets/_meta/personas/ralf/persona.md': persona('Ralf', 'agent', '#bfe3cd', ['parallel: 1']),
  'tickets/_meta/personas/tessa/persona.md': persona('Tessa', 'agent', '#f2cfae', ['parallel: 1']),
  'tickets/_meta/personas/you/persona.md': persona('You', 'human', '#e0bb6e', ['leaving: [commit]']),
  'tickets/_meta/ledger.jsonl': [...SEEDS.flatMap((seed, index) => (seed.cost === undefined ? [] : [settled(idOf(index), 'ben', seed.cost)])), ''].join('\n'),
};

test.beforeAll(() => {
  if (haveDk) {
    seedStore();
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
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ backend: 'dricket', 'dk.store': storeDir, 'dk.dataDir': dataDir, 'dk.syncSeconds': 0 }, null, 2));
});

function liveRun(ticket: string, who: string, minutes: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const at = new Date(Date.now() - minutes * 60_000).toISOString();
  return { id: `r-${ticket}`, ticketId: ticket, persona: who, provider: 'opencode', model: 'qwen3-coder', state: 'running', pid: 4242, startedAt: at, endedAt: null, sessionRef: 'ses', tokensIn: 0, tokensOut: 0, costUsd: null, lastActivity: at, ...extra };
}

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
  const panel = page.locator('.tickets-panel').filter({ visible: true });
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
