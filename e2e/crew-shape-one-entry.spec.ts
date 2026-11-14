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
  ticketHistory,
  writeServiceJson,
  writeTicketsConfig,
} from './fixtures/crew-run';

/**
 * req-305 on the REAL engine (Drey Service started by the app) with FAKE
 * harnesses: a ticket at position 1 of `paul:shape; you`, the Autopilot On.
 * The entry is ONE position that shapes and then plans — while the owner
 * shapes (the Shape chat) no run is dispatched, the card says so and offers
 * *Shaping done*; the click is the owner's Accept: the engine rewrites the
 * entry without its mode (`paul`), keeps the cursor at 1 and Paul's plan run
 * starts at that same position; its green end moves the cursor to You. The
 * home, the store and the work repository are temp; the owner's
 * `~/.drey-engine` and boards are never touched. Skipped when `dk` is missing.
 */
const haveDk = dkVersionOk();
const env = crewRunEnv('dcs-', []);

const SEEDS: readonly Seed[] = [{ title: 'Shape then plan at one position', stage: 'active', chain: 'paul:shape;you', at: 1, body: acceptanceBody('green.txt') }];
const ID = 't-1';

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
  seedVault: crewVault(env, 'paul:shape; you', [{ id: 'paul', title: 'Paul', role: 'planner', color: '#f2d3e2' }]),
  appConfig: { plugins: { disabled: ['sample', 'templates', 'browser', 'drawio', 'ocr', 'meeting'] }, spellcheck: { enabled: false } },
});

test.beforeEach(({ userDataDir }) => {
  if (haveDk) {
    writeTicketsConfig(userDataDir, env);
  }
});

test('a ticket shapes first and plans at the same position: one entry, Paul once (req-305)', async ({ page }) => {
  test.setTimeout(420_000);
  const tabs = page.locator('[role="tablist"][aria-label="Views"] [role="tab"]');
  await expect(tabs).toHaveText(['Notes', 'Work', 'Crew'], { timeout: 30_000 });
  await tabs.filter({ hasText: 'Work' }).click();
  const card = page.locator('.desk-board.desk-pboard').filter({ visible: true }).locator('.pb-card[data-id="T-0001"]');
  await expect(card).toBeVisible({ timeout: 60_000 });

  // While the ticket waits at the shaping entry: the card says so, no run starts, Paul stands once in the flow.
  await expect(card.locator('.pb-status-text')).toHaveText('shaping with you');
  await expect(card.locator('.pb-cell')).toHaveCount(2);
  await setAutopilot(page, 'on');
  await page.waitForTimeout(8_000);
  expect(harnessTurns(env)).toHaveLength(0);
  expect(ticketField(env, ID, 'x-chain')).toBe('paul:shape;you');
  expect(ticketField(env, ID, 'x-at')).toBe('1');

  // Shaping done is the owner's Accept: the entry loses its mode, the cursor stays — the plan run follows at position 1.
  await card.locator('.pb-shaping-done').click();
  await expect.poll(() => ticketHistory(env, ID), { timeout: 60_000 }).toContain('shaping done at position 1 of 2');
  await expect.poll(() => ticketField(env, ID, 'x-chain'), { timeout: 30_000 }).toBe('paul;you');
  await expect.poll(() => harnessTurns(env).length, { timeout: 120_000, intervals: [1_000] }).toBeGreaterThanOrEqual(1);
  expect(path.basename(harnessTurns(env)[0]!.cwd)).toBe('T-0001');

  // Paul's green end hands the ticket on: position 2, You — the one position planned and ended once.
  await expect.poll(() => ticketField(env, ID, 'x-at'), { timeout: 180_000, intervals: [2_000] }).toBe('2');
  expect(harnessTurns(env).filter((turn) => path.basename(turn.cwd) === 'T-0001')).toHaveLength(1);
  await expect(card.locator('.pb-decide-accept')).toBeVisible({ timeout: 60_000 });
});
