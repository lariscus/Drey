import { test, expect } from './fixtures/drey';
import { seedStore, type Seed } from './fixtures/persona-board-seed';
import {
  acceptanceBody,
  chainStatus,
  crewRunEnv,
  crewVault,
  dkVersionOk,
  initWorkRepo,
  keepEvidence,
  removeEnv,
  setAutopilot,
  showTicketsPanel,
  stopEngine,
  ticketField,
  writeServiceJson,
  writeTicketsConfig,
} from './fixtures/crew-run';

/**
 * req-120 and req-148 on the REAL engine (Drey Service started by the app) with
 * FAKE harnesses, in a temp home:
 *
 * - req-120: a Prioritized chain ticket's document shows board 9a's primary
 *   `Start with Paul`; the click asks in place, `Start` sends the persona board's
 *   start move — the store ticket goes `active`, chain and cursor kept — and with
 *   the Autopilot off no run starts.
 * - req-148: two tickets held by Ben, who may run one at a time (`parallel: 1`),
 *   Autopilot On: the first run hangs (a live worker), the second is the
 *   dispatcher's queue in the chain status (`queued`, why `persona`), and the
 *   Crew tab's head counts it (`· 1 queued`).
 *
 * Skipped when `dk` is missing. The owner's `~/.drey-engine` and boards are never touched.
 */
const haveDk = dkVersionOk();
const env = crewRunEnv('dcq-', [{ match: 'works the builder step', hang: true }]);

const SEEDS: readonly Seed[] = [
  { title: 'Start from the card', stage: 'prioritized', chain: 'paul;you', at: 1 },
  { title: 'Ben builds the first', stage: 'active', chain: 'ben;you', at: 1, body: acceptanceBody('never.txt') },
  { title: 'Ben builds the second', stage: 'active', chain: 'ben;you', at: 1, body: acceptanceBody('never.txt') },
];

test.skip(!haveDk, 'dk >= 0.6.2 not found');

test.beforeAll(() => {
  if (haveDk) {
    initWorkRepo(env);
    writeServiceJson(env, 4);
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
  seedVault: crewVault(env, 'paul; you', [
    { id: 'paul', title: 'Paul', role: 'planner', color: '#f2d3e2' },
    { id: 'ben', title: 'Ben', role: 'builder', color: '#bcd7f2', parallel: 1 },
  ]),
  appConfig: { plugins: { disabled: ['sample', 'templates', 'browser', 'drawio', 'ocr', 'meeting'] }, spellcheck: { enabled: false } },
});

test.beforeEach(({ userDataDir }) => {
  if (haveDk) {
    writeTicketsConfig(userDataDir, env);
  }
});

test('the ticket card starts the chain: Start with Paul asks, then the ticket is active (req-120)', async ({ page, electronApp }) => {
  test.setTimeout(240_000);
  const tabs = page.locator('[role="tablist"][aria-label="Views"] [role="tab"]');
  await expect(tabs).toHaveText(['Notes', 'Work', 'Crew'], { timeout: 30_000 });
  await tabs.filter({ hasText: 'Work' }).click();
  const panel = await showTicketsPanel(page);
  const row = panel.locator('.work-row[data-id="T-0001"]');
  await expect(row).toBeVisible({ timeout: 60_000 });
  // As the store-document spec does: a native question must not block the open.
  await electronApp.evaluate(({ dialog }) => {
    dialog.showMessageBox = (() => Promise.resolve({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
  });
  await row.click({ button: 'right' });
  await page.getByText('Open ticket', { exact: true }).first().click();
  const card = page.locator('app-editor .tickets-card-top').first();
  await expect(card).toBeVisible({ timeout: 20_000 });

  await expect(card.getByRole('button', { name: 'Thread' })).toBeVisible();
  const start = card.getByRole('button', { name: 'Start with Paul' });
  await expect(start).toBeVisible();
  expect(ticketField(env, 't-1', 'stage')).toBe('prioritized');

  // The first click only asks — Cancel puts the button back, the store is untouched.
  await start.click();
  await expect(card.locator('.tickets-doc-start-ask')).toHaveText('Start T-0001 with Paul?');
  await card.getByRole('button', { name: 'Cancel' }).click();
  await expect(start).toBeVisible();
  expect(ticketField(env, 't-1', 'stage')).toBe('prioritized');

  await start.click();
  await card.getByRole('button', { name: 'Start', exact: true }).click();
  await expect.poll(() => ticketField(env, 't-1', 'stage'), { timeout: 30_000 }).toBe('active');
  expect(ticketField(env, 't-1', 'x-chain')).toBe('paul;you');
  expect(ticketField(env, 't-1', 'x-at')).toBe('1');
  // No Start any more where the board would not accept the drop.
  await expect(card.getByRole('button', { name: 'Start with Paul' })).toHaveCount(0, { timeout: 20_000 });
});

test('a run that waits for its persona is in the fleet report and on the Crew tab (req-148)', async ({ page }) => {
  test.setTimeout(240_000);
  const tabs = page.locator('[role="tablist"][aria-label="Views"] [role="tab"]');
  await expect(tabs).toHaveText(['Notes', 'Work', 'Crew'], { timeout: 30_000 });
  await tabs.filter({ hasText: 'Work' }).click();
  await expect(page.locator('.desk-board.desk-pboard').filter({ visible: true }).locator('.pb-card[data-id="T-0002"]')).toBeVisible({ timeout: 60_000 });
  await setAutopilot(page, 'on');

  // One of Ben's two tickets runs (the fake worker hangs), the other is the queue.
  await expect.poll(async () => ((await chainStatus(env))?.['queued'] as { ticket: string }[] | undefined)?.length ?? 0, { timeout: 120_000, intervals: [1_000] }).toBe(1);
  const queued = ((await chainStatus(env))?.['queued'] as { ticket: string; persona: string; why: string; position: number }[])[0]!;
  expect(queued).toMatchObject({ persona: 'ben', why: 'persona', position: 1 });
  expect(['t-2', 't-3']).toContain(queued.ticket.replace(/^T-000/, 't-'));

  await tabs.filter({ hasText: 'Crew' }).click();
  await expect(page.locator('.desk-head-sub').filter({ visible: true })).toContainText('1 queued', { timeout: 30_000 });
});
