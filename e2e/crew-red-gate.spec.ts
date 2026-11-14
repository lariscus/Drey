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
 * req-78 on the REAL engine (Drey Service started by the app) with FAKE
 * harnesses: a ticket at position 2 of `paul; tessa(on-red paul); you`, the
 * Autopilot On. Tessa's fake run ends its turn; her machine gate (`type
 * green.txt` in the worktree) goes red, so the runner sends the ticket back to
 * Paul — `x-at: 1`, `x-return-to: 2`, `x-red-backs: 1` and the red-gate
 * comment. Paul's fake run (its brief says it was sent back by a red gate)
 * writes `green.txt` and ends green: the cursor returns straight to 2, the
 * return mark gone, the count kept. Tessa runs again after her cool-down, her
 * gate is green, and the ticket reaches You with the loop over (the count gone). Everything lives in a temp home;
 * the owner's `~/.drey-engine` and boards are never touched. Skipped when
 * `dk` is missing.
 */
const haveDk = dkVersionOk();
const env = crewRunEnv('dcr-', [{ match: 'Sent back by a red gate', write: { file: 'green.txt', text: 'fixed' }, result: 'Fixed what the gate found.' }]);

const SEEDS: readonly Seed[] = [{ title: 'Gate goes back to the planner', stage: 'active', chain: 'paul;tessa(on-red paul);you', at: 2, body: acceptanceBody('green.txt') }];
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
  seedVault: crewVault(env, 'paul; tessa; you', [
    { id: 'paul', title: 'Paul', role: 'planner', color: '#f2d3e2' },
    { id: 'tessa', title: 'Tessa', role: 'tester', color: '#f2cfae' },
  ]),
  appConfig: { plugins: { disabled: ['sample', 'templates', 'browser', 'drawio', 'ocr', 'meeting'] }, spellcheck: { enabled: false } },
});

test.beforeEach(({ userDataDir }) => {
  if (haveDk) {
    writeTicketsConfig(userDataDir, env);
  }
});

test('a red gate sends the ticket back to the planner, and the planner\'s green run returns it (req-78)', async ({ page }) => {
  test.setTimeout(420_000);
  const tabs = page.locator('[role="tablist"][aria-label="Views"] [role="tab"]');
  await expect(tabs).toHaveText(['Notes', 'Work', 'Crew'], { timeout: 30_000 });
  await tabs.filter({ hasText: 'Work' }).click();
  await expect(page.locator('.desk-board.desk-pboard').filter({ visible: true }).locator(`.pb-card[data-id="T-0001"]`)).toBeVisible({ timeout: 60_000 });

  await setAutopilot(page, 'on');

  // Tessa's turn ends, her gate is red: the ticket goes back to Paul, inside one release into `active`.
  await expect.poll(() => ticketField(env, ID, 'x-return-to'), { timeout: 120_000, intervals: [1_000] }).toBe('2');
  expect(ticketField(env, ID, 'x-red-backs')).toBe('1');
  const tessaTurn = harnessTurns(env).find((turn) => turn.rule === null);
  expect(tessaTurn, 'Tessa ran first, on the fake harness').toBeDefined();
  expect(path.basename(tessaTurn!.cwd)).toBe('T-0001');
  await expect.poll(() => ticketHistory(env, ID), { timeout: 30_000 }).toContain('red gate at position 2 (tessa)');
  expect(ticketHistory(env, ID)).toContain('sent back to 1 (paul) (red 1 of 2)');

  // Paul's brief names the red gate; his green run returns the cursor straight to 2.
  await expect.poll(() => harnessTurns(env).some((turn) => turn.rule === 'Sent back by a red gate'), { timeout: 120_000, intervals: [1_000] }).toBe(true);
  const paulTurn = harnessTurns(env).find((turn) => turn.rule === 'Sent back by a red gate')!;
  expect(paulTurn.text).toContain('the machine gate of position 2 (tessa) went red');
  await expect.poll(() => ticketField(env, ID, 'x-return-to'), { timeout: 120_000, intervals: [1_000] }).toBeNull();
  expect(ticketField(env, ID, 'x-red-backs')).toBe('1');
  await expect.poll(() => ticketField(env, ID, 'x-at'), { timeout: 30_000 }).not.toBe('1');

  // Tessa again (after her cool-down): the file Paul's run wrote turns the gate green, the ticket reaches You.
  await expect.poll(() => ticketField(env, ID, 'x-at'), { timeout: 180_000, intervals: [2_000] }).toBe('3');
  expect(ticketField(env, ID, 'x-red-backs')).toBeNull(); // Tessa's green end is no return: it ends the loop and its count
  expect(harnessTurns(env).filter((turn) => turn.rule === null).length).toBeGreaterThanOrEqual(2);
});
