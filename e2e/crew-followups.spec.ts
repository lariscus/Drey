import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from './fixtures/drey';
import { seedStore, type Seed } from './fixtures/persona-board-seed';
import {
  acceptanceBody,
  crewRunEnv,
  crewVault,
  dkVersionOk,
  harnessTurns,
  initWorkRepo,
  keepEvidence,
  removeEnv,
  setAutopilot,
  stopEngine,
  ticketField,
  ticketText,
  writeServiceJson,
  writeTicketsConfig,
} from './fixtures/crew-run';

/**
 * req-299 on the REAL engine (Drey Service started by the app) with a FAKE
 * harness: Ben's run on T-0001 (in the project Lariscus, repository `drey`)
 * ends its last message with `FOLLOWUPS:` and two bullets. The brief the
 * worker received carries the rule; the run settles green and the ticket
 * moves on; the engine files ONE session, "Follow-ups from T-0001", with
 * two pending `createTicket` cards — and no ticket exists yet. In Mission
 * Control (the Assistant's target) the cards are there; Confirm creates the
 * ticket in the capture phase with the source's repository and project,
 * Dismiss leaves nothing. Everything lives in a temp home; the owner's
 * `~/.drey-engine` and boards are never touched. Skipped when `dk` is missing.
 */
const haveDk = dkVersionOk();
const FINDINGS = [
  'Checked the outline.',
  'FOLLOWUPS:',
  '- Drop the dead export',
  '  why: nothing imports it any more',
  '  priority: low',
  '- Tidy the CSV header',
  '  why: the export writes a BOM',
  '  priority: urgent-ish',
].join('\n');
const env = crewRunEnv('dfu-', [{ match: 'Cache the outline tree', write: { file: 'green.txt', text: 'ok' }, result: FINDINGS }]);

const SEEDS: readonly Seed[] = [{ title: 'Cache the outline tree', stage: 'active', chain: 'ben;you', at: 1, extra: { 'x-project': 'lariscus' }, body: acceptanceBody('green.txt') }];
const SOURCE = 't-1';
const project = (name: string, color: string): string => ['---', `name: ${name}`, `color: "${color}"`, 'repos: [drey]', '---', `${name}.`, ''].join('\n');

test.skip(!haveDk, 'dk >= 0.6.2 not found');

test.beforeAll(() => {
  if (haveDk) {
    initWorkRepo(env);
    writeServiceJson(env, 2);
    seedStore(env, SEEDS);
  }
});

test.afterEach(({}, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    keepEvidence(env, testInfo.outputDir);
  }
  stopEngine(env);
});
test.afterAll(() => removeEnv(env));

test.use({
  seedVault: {
    ...crewVault(env, 'ben; you', [{ id: 'ben', title: 'Ben', role: 'builder', color: '#8ecbef' }]),
    'tickets/_meta/projects/drey.md': project('Drey', '#8ecbef'),
    'tickets/_meta/projects/lariscus.md': project('Lariscus', '#f2cfae'),
  },
  appConfig: { plugins: { disabled: ['sample', 'templates', 'browser', 'drawio', 'ocr', 'meeting'] }, spellcheck: { enabled: false } },
});

test.beforeEach(({ userDataDir }) => {
  if (haveDk) {
    writeTicketsConfig(userDataDir, env);
  }
});

/** The follow-ups session files of the tickets vault. */
const sessionFiles = (vaultDir: string): string[] => {
  const dir = path.join(vaultDir, 'tickets', '_meta', 'chat');
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /follow-ups-from-t-0001\.md$/.test(f)) : [];
};

/** True while the store holds a ticket under this dk id. */
const exists = (id: string): boolean => {
  try {
    ticketText(env, id);
    return true;
  } catch {
    return false;
  }
};

test("a worker's FOLLOWUPS: become pending Mission Control cards; the owner's confirm creates the ticket (req-299)", async ({ page, vaultDir }) => {
  test.setTimeout(420_000);
  const tabs = page.locator('[role="tablist"][aria-label="Views"] [role="tab"]');
  await expect(tabs).toHaveText(['Notes', 'Work', 'Crew'], { timeout: 30_000 });
  await tabs.filter({ hasText: 'Work' }).click();
  await expect(page.locator('.desk-board.desk-pboard').filter({ visible: true }).locator('.pb-card[data-id="T-0001"]')).toBeVisible({ timeout: 60_000 });

  await setAutopilot(page, 'on');

  // Ben's fake run ends its turn with the proposals; the green gate hands the ticket on to You.
  await expect.poll(() => ticketField(env, SOURCE, 'x-at'), { timeout: 180_000, intervals: [1_000] }).toBe('2');
  const turn = harnessTurns(env).find((t) => t.rule === 'Cache the outline tree');
  expect(turn, 'Ben ran on the fake harness').toBeDefined();
  expect(turn!.text, 'the brief carries the follow-ups rule').toContain('end your final message with `FOLLOWUPS:`');

  // One session, two pending cards — and no ticket yet (the worker and the filer create none).
  await expect.poll(() => sessionFiles(vaultDir).length, { timeout: 60_000, intervals: [500] }).toBe(1);
  const text = fs.readFileSync(path.join(vaultDir, 'tickets', '_meta', 'chat', sessionFiles(vaultDir)[0]!), 'utf8');
  expect(text).toContain('title: "Follow-ups from T-0001"');
  expect(text).toMatch(/Run \S+ of T-0001 \(Cache the outline tree\) proposes 2 follow-up tickets\. Nothing is created until you confirm a card\./);
  expect(text.match(/proposal p-\d+ pending/g)).toHaveLength(2);
  expect(text).toContain('"title":"Drop the dead export"');
  expect(text).toContain('"project":"lariscus"');
  expect(text).toContain('"repo":"drey"');
  expect(exists('t-2')).toBe(false);

  // Mission Control: the history lists the session with its two open cards; the thread shows them.
  await tabs.filter({ hasText: 'Notes' }).click();
  const panel = page.locator('app-panel-frame', { has: page.locator('.assistant-panel') });
  const switcher = panel.locator('.assistant-targets');
  await switcher.getByLabel('Mission Control', { exact: true }).click();
  await panel.getByLabel('Chat history').click();
  const row = panel.locator('.assistant-chatlist-row', { hasText: 'Follow-ups from T-0001' });
  await expect(row).toContainText('2 open', { timeout: 30_000 });
  await row.click();
  const cards = panel.locator('.target-thread .target-card');
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).toContainText('Drop the dead export');
  await expect(cards.nth(1)).toContainText('Tidy the CSV header');

  // Confirm the first: the ticket lands in the capture phase with the source's repository and project. Dismiss the second: nothing.
  await cards.first().locator('.target-card-btn', { hasText: 'Confirm' }).click();
  await expect(cards.first().locator('.target-card-btn')).toHaveCount(0, { timeout: 30_000 });
  await expect.poll(() => exists('t-2'), { timeout: 30_000, intervals: [500] }).toBe(true);
  const created = ticketText(env, 't-2');
  expect(created).toContain('Drop the dead export');
  expect(created).toContain('nothing imports it any more');
  expect(created).toContain('Proposed by the worker of T-0001');
  expect(created).toMatch(/^repos?: ('|")?drey/m);
  expect(created).toMatch(/^x-project: ('|")?lariscus/m);
  expect(ticketField(env, 't-2', 'stage')).toBe('inbox');

  await cards.nth(1).locator('.target-card-btn', { hasText: 'Dismiss' }).click();
  await expect(cards.nth(1)).toContainText('Dismissed', { timeout: 30_000 });
  expect(exists('t-3')).toBe(false);
});
