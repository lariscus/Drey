import path from 'node:path';
import type { Page, ElectronApplication } from '@playwright/test';
import { test, expect } from './fixtures/drey';
import { seedStore, type Seed } from './fixtures/persona-board-seed';
import { crewRunEnv, crewVault, dkVersionOk, initWorkRepo, keepEvidence, removeEnv, showTicketsPanel, stopEngine, writeServiceJson, writeTicketsConfig } from './fixtures/crew-run';

/**
 * The ticket document view on the persona board (the milestone's fix of the
 * document against boards 7a v2 and 9a), on the REAL engine in a temp home:
 * the card's Flow / Holder rows, one flowing paragraph, the spaced plan
 * chapter, the Log's formatted times. Screenshots land in
 * `docs/design/work-panel/boards/ticket-view-*-built.png` for the side-by-side
 * with the boards. Skipped when `dk` is missing. The owner's `~/.drey-engine`
 * and boards are never touched.
 */
const haveDk = dkVersionOk();
const env = crewRunEnv('dtv-', []);

const BODY = [
  '## Description',
  '',
  'The palette opens twice when the machine is slow and the first keystroke',
  'arrives before the dialog has finished mounting, so a second dialog is',
  'stacked above the first one and the owner has to close both of them.',
  '',
  '## Plan',
  '',
  'Guard the open command with a flag that is cleared when the dialog closes.',
  '',
  '### Acceptance criteria',
  '',
  '- [ ] a second Ctrl+P while the palette is open does not stack a dialog',
  '',
  '## Log',
  '',
  "- '2026-10-18T11:12:12Z' agent@legion:opencode — created in inbox",
  "- '2026-10-18T12:30:00Z' agent@legion:opencode — priority set to high",
  '',
].join('\n');

const FIRST_WORDS = 'The palette opens twice';
const LAST_WORDS = 'close both of them.';

const SEEDS: readonly Seed[] = [
  { title: 'Palette opens twice on slow CI', stage: 'inbox', chain: 'paul;ben;ralf;you', body: BODY, replaceBody: true },
  { title: 'Palette opens twice, built', stage: 'active', chain: 'paul;ben;ralf;you', at: 2, body: BODY, replaceBody: true },
];

const BOARDS = path.resolve(__dirname, '..', 'docs', 'design', 'work-panel', 'boards');

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
  seedVault: crewVault(env, 'paul; ben; ralf; you', [
    { id: 'paul', title: 'Paul', role: 'planner', color: '#f2d3e2' },
    { id: 'ben', title: 'Ben', role: 'builder', color: '#bcd7f2' },
    { id: 'ralf', title: 'Ralf', role: 'reviewer', color: '#bfe3cd' },
  ]),
  appConfig: { plugins: { disabled: ['sample', 'templates', 'browser', 'drawio', 'ocr', 'meeting'] }, spellcheck: { enabled: false } },
  launchArgs: ['--force-device-scale-factor=1'],
});

test.beforeEach(({ userDataDir }) => {
  if (haveDk) {
    writeTicketsConfig(userDataDir, env);
  }
});

async function sizeWindow(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.webContents.getURL().startsWith('app://')) {
        win.setContentSize(1440, 900);
      }
    }
  });
}

/** Opens a ticket from its row in the Tickets panel (Work view). */
async function openTicket(page: Page, electronApp: ElectronApplication, id: string) {
  await sizeWindow(electronApp);
  const tabs = page.locator('[role="tablist"][aria-label="Views"] [role="tab"]');
  await expect(tabs).toHaveText(['Notes', 'Work', 'Crew'], { timeout: 30_000 });
  await tabs.filter({ hasText: 'Work' }).click();
  const panel = await showTicketsPanel(page);
  const row = panel.locator(`.work-row[data-id="${id}"]`);
  await expect(row).toBeVisible({ timeout: 60_000 });
  await electronApp.evaluate(({ dialog }) => {
    dialog.showMessageBox = (() => Promise.resolve({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
  });
  await row.click({ button: 'right' });
  await page.getByText('Open ticket', { exact: true }).first().click();
  const card = page.locator('app-editor .tickets-card').first();
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('app-editor .cm-content').first()).toContainText('Acceptance criteria', { timeout: 20_000 });
  return card;
}

async function checkBody(page: Page): Promise<void> {
  const editor = page.locator('app-editor').first();
  // Soft breaks: the wrapped description is one flowing line.
  expect(await editor.locator('.tickets-doc-soft-break').count()).toBeGreaterThanOrEqual(2);
  const line = editor.locator('.cm-line').filter({ hasText: FIRST_WORDS });
  await expect(line).toHaveCount(1);
  await expect(line).toContainText(LAST_WORDS);
  // The sub-chapter is spaced like a section head.
  await expect(editor.locator('.cm-line.tickets-doc-h2').filter({ hasText: 'Acceptance criteria' })).toHaveCount(1);
  // The Log is folded; unfolding shows formatted times, not the quoted stamps.
  await editor.locator('.tickets-doc-log-chevron').click();
  await expect(editor.locator('time.tickets-doc-log-time')).toHaveCount(2);
  const visible = await editor.locator('.cm-content').innerText();
  expect(visible).not.toContain("'2026-");
  await expect(editor.locator('time.tickets-doc-log-time').first()).toHaveText(/Oct 18, 2026/);
}

test('an active ticket: the chain with its cursor, the holder, no Worker (board 7a v2)', async ({ page, electronApp }) => {
  test.setTimeout(240_000);
  const card = await openTicket(page, electronApp, 'T-0002');
  const labels = (await card.locator('.tickets-card-label').allInnerTexts()).map((t) => t.trim());
  expect(labels.slice(0, 2)).toEqual(['Flow', 'Holder']);
  expect(labels.length === 2 || (labels.length === 3 && labels[2] === 'Cost')).toBe(true);
  for (const absent of ['Worker', 'Priority', 'Repo']) {
    expect(labels).not.toContain(absent);
  }
  const chain = card.locator('.tickets-doc-chain');
  await expect(chain).toContainText('✓ Paul');
  await expect(chain.locator('.tickets-doc-step.is-current')).toHaveText('Ben');
  await expect(chain).toContainText('(2 of 4)');
  await expect(chain).toContainText('Ralf');
  await expect(chain).toContainText('You');
  const holder = card.locator('.tickets-card-label', { hasText: 'Holder' }).locator('xpath=following-sibling::*[1]');
  await expect(holder).toContainText('Ben');
  // The pill names the holder and the position (Mission Control's chip, 10e v2), never the stage id.
  await expect(card.locator('.tickets-head-phase')).toHaveText('Ben · 2 of 4');
  // The Plan heading 7a v2 leaves out keeps one paragraph gap between the description and the plan.
  const editor = page.locator('app-editor').first();
  const planLine = editor.locator('.cm-line').filter({ hasText: 'Guard the open command' });
  const shown = planLine.locator('xpath=preceding-sibling::*[not(contains(@class, "tickets-doc-collapsed"))][1]');
  await expect(shown).toHaveClass(/tickets-doc-gap/);

  await checkBody(page);
  await page.locator('app-editor .cm-content').first().evaluate((el) => el.closest('.cm-scroller')?.scrollTo(0, 0));
  await page.screenshot({ path: path.join(BOARDS, 'ticket-view-DeskWorkV2-built.png') });

  // Editor zoom (Ctrl +) scales the column.
  const content = page.locator('app-editor .cm-content').first();
  const before = (await content.boundingBox())!.width;
  await content.click({ position: { x: 5, y: 5 } }).catch(() => undefined);
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Control+=');
  }
  await expect(page.locator('app-editor .zoom-chip')).toBeVisible();
  const after = (await content.boundingBox())!.width;
  expect(after).toBeGreaterThan(before);
  await page.screenshot({ path: path.join(BOARDS, 'ticket-view-DeskWorkV2-built-zoom.png') });
});

test('an inbox ticket: Priority, Repo, Flow as a chain, no Worker (board 9a)', async ({ page, electronApp }) => {
  test.setTimeout(240_000);
  const card = await openTicket(page, electronApp, 'T-0001');
  const labels = (await card.locator('.tickets-card-label').allInnerTexts()).map((t) => t.trim());
  expect(labels).toEqual(['Priority', 'Repo', 'Flow']);
  const flow = card.locator('.tickets-card-label', { hasText: 'Flow' }).locator('xpath=following-sibling::*[1]');
  await expect(flow).toContainText('Paul → Ben → Ralf → You');
  await expect(card).not.toContainText('Worker');
  await expect(card).not.toContainText('Building');

  await checkBody(page);
  await page.locator('app-editor .cm-content').first().evaluate((el) => el.closest('.cm-scroller')?.scrollTo(0, 0));
  await page.screenshot({ path: path.join(BOARDS, 'ticket-view-DeskClean-built.png') });
});
