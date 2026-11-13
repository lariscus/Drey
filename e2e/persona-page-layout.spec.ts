import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect, type Page } from './fixtures/drey';

/**
 * The Persona page's layout (D-66, the owner's interim verification
 * 2026-11-13): the right column fits the page without a scrollbar of its
 * own, the Instructions editor takes the room the other blocks leave and
 * scrolls its own text once it no longer fits, and the splitter under it
 * sets its height (a double-click hands the height back to the page).
 * A home of its own, so the plugin spawns an engine for the seeded vault.
 */
const engineHome = fs.mkdtempSync(path.join(os.tmpdir(), 'drey-e2e-home-'));
process.env['USERPROFILE'] = engineHome;
process.env['HOME'] = engineHome;

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
});

const longPrompt = ['# Who Tessa is', '', 'Tessa is the tester.', '', '## How Tessa works', ''].concat(Array.from({ length: 80 }, (_, i) => `- Rule ${i + 1}: one verdict per acceptance criterion, each backed by what she saw.`)).join('\n');

test.use({
  seedVault: {
    'tickets/_meta/pipeline.md': ['---', 'phases:', '  - { id: inbox, title: Inbox, handover: manual }', '  - { id: done, title: Done, handover: none }', '---', 'The phases.', ''].join('\n'),
    'tickets/_meta/personas/tessa/persona.md': ['---', 'title: Tessa', 'role: tester', 'worker: opencode', 'models:', '  default: qwen3-coder', '  pool: [qwen3-coder]', '  router: off', "color: '#8ecbef'", 'skills: []', 'budget: 5', '---', ''].join('\n'),
    'tickets/_meta/personas/tessa/prompt.md': `${longPrompt}\n`,
  },
  appConfig: { plugins: { disabled: ['sample', 'templates', 'browser', 'drawio', 'ocr', 'meeting'] }, spellcheck: { enabled: false } },
});

test.beforeEach(({ vaultDir }) => {
  execFileSync('git', ['init', '-q'], { cwd: vaultDir, windowsHide: true });
});

async function openTessa(page: Page): Promise<void> {
  await expect(page.locator('app-titlebar [role="tab"]', { hasText: 'Work' })).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press('Control+2');
  await page.locator('app-panel-frame', { has: page.locator('.tickets-panel') }).filter({ visible: true }).locator('.head').hover();
  await page.locator('button[aria-label="More actions"]:visible').click({ force: true });
  await page.getByRole('menuitem', { name: 'Crew', exact: true }).click();
  await page.locator('.desk-team [data-persona="tessa"]').first().click();
  await page.locator('.desk-detail-head .persona-edit-btn').click();
  await expect(page.locator('.persona-page .persona-ed-view .cm-content').filter({ visible: true })).toBeVisible({ timeout: 15_000 });
}

test('the Persona page fits, its editor scrolls its own text, and the splitter sets the editor height', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await openTessa(page);
  const pageRoot = page.locator('.persona-page').filter({ visible: true });
  const right = pageRoot.locator('.persona-right');
  const frame = pageRoot.locator('.persona-block-fill > .persona-ed');
  const scroller = frame.locator('.cm-scroller');

  // The column holds everything without a scrollbar of its own.
  const column = await right.evaluate((node) => ({ scroll: node.scrollHeight, client: node.clientHeight }));
  expect(column.scroll).toBeLessThanOrEqual(column.client + 1);
  // The editor's text is longer than the editor: its own scroller scrolls it.
  const text = await scroller.evaluate((node) => ({ scroll: node.scrollHeight, client: node.clientHeight, overflow: getComputedStyle(node).overflowY }));
  expect(text.client).toBeGreaterThan(100);
  expect(text.scroll).toBeGreaterThan(text.client);
  expect(text.overflow).toBe('auto');
  await page.screenshot({ path: testInfo.outputPath('persona-layout-fit.png') });
  await testInfo.attach('persona-layout-fit', { path: testInfo.outputPath('persona-layout-fit.png'), contentType: 'image/png' });

  // The splitter: a drag down makes the editor taller (the column may then scroll), a double-click hands the height back.
  const before = (await frame.boundingBox())!.height;
  const grip = pageRoot.getByRole('separator', { name: 'Resize the instructions' });
  const box = (await grip.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 150, { steps: 6 });
  await page.mouse.up();
  const dragged = (await frame.boundingBox())!.height;
  expect(dragged).toBeGreaterThan(before + 100);
  await page.screenshot({ path: testInfo.outputPath('persona-layout-dragged.png') });
  await testInfo.attach('persona-layout-dragged', { path: testInfo.outputPath('persona-layout-dragged.png'), contentType: 'image/png' });

  await grip.dblclick();
  await expect.poll(async () => Math.round((await frame.boundingBox())!.height)).toBe(Math.round(before));
});
