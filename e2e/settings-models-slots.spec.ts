import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from './fixtures/drey';

/**
 * Settings → Tickets → Models, the slots (D-69, the owner's interim
 * verification 2026-11-13): `Add slot…` adds a row (no folder opens), Enter
 * adds the slot, and every slot card — an implied one too — can be removed.
 * The real engine on a home of its own: the writes land in that home's
 * `service.json`, never the owner's.
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

test.use({
  seedVault: {
    'tickets/_meta/pipeline.md': ['---', 'phases:', '  - { id: inbox, title: Inbox, handover: manual }', '  - { id: done, title: Done, handover: none }', '---', 'The phases.', ''].join('\n'),
  },
  appConfig: { plugins: { disabled: ['sample', 'templates', 'browser', 'drawio', 'ocr', 'meeting'] }, spellcheck: { enabled: false } },
});

test('Add slot… adds a row, and every slot card can be removed (D-69)', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await expect(page.locator('app-titlebar [role="tab"]', { hasText: 'Work' })).toBeVisible({ timeout: 30_000 });
  await page.locator('app-status-bar .settings').click();
  await page.locator('app-settings .category', { hasText: 'Tickets' }).first().click();
  await page.locator('app-settings .section-entry', { hasText: 'Models' }).click();
  const models = page.locator('.tset-models');
  const names = models.locator('.tset-models-cardname');
  await models.getByRole('button', { name: 'Add slot…' }).click();
  const draft = models.locator('.tset-models-slotdraft');
  await expect(draft).toBeVisible();
  await draft.getByRole('textbox', { name: 'Name' }).fill('Claude B');
  await draft.getByRole('combobox', { name: 'Provider' }).selectOption('claude-code');
  await draft.getByRole('combobox', { name: 'Profile' }).selectOption('work');
  await draft.getByRole('textbox', { name: 'Name' }).press('Enter');
  await expect(names.filter({ hasText: 'Claude B' })).toBeVisible({ timeout: 30_000 });
  await expect(draft).toHaveCount(0);
  await expect(names).toHaveText(['Claude B', 'OpenCode', 'Kimi', 'Copilot CLI']);
  await page.screenshot({ path: testInfo.outputPath('models-slot-added.png') });
  await testInfo.attach('models-slot-added', { path: testInfo.outputPath('models-slot-added.png'), contentType: 'image/png' });

  // An implied slot and the configured one: both leave.
  await models.getByRole('button', { name: 'Remove Copilot CLI' }).click();
  await expect(names).toHaveText(['Claude B', 'OpenCode', 'Kimi'], { timeout: 30_000 });
  await models.getByRole('button', { name: 'Remove Claude B' }).click();
  await expect(names).toHaveText(['OpenCode', 'Claude Code', 'Kimi'], { timeout: 30_000 });
  const written = JSON.parse(fs.readFileSync(path.join(engineHome, '.drey-engine', 'service.json'), 'utf8')) as Record<string, unknown>;
  expect(written['slots']).toEqual([]);
  expect(written['impliedOff']).toEqual(['copilot']);
});
