/**
 * req-95b — Mission Control's Autopilot clients (canvas board 10t): the iPad
 * chip with its popover, the phone's app-bar button with its sheet. Runs the
 * built app against the fake desk in a stock Chromium (no engine); the desk
 * can refuse the write the way the engine does, so the spec checks that a
 * refusal reads as words, never as a code. Prerequisite:
 * `npm run build:mission-control`.
 */
import { test, expect, type Page } from '@playwright/test';
import { startFakeDesk } from './fixtures/mission-control-fake-desk';

type Desk = Awaited<ReturnType<typeof startFakeDesk>>;

async function openApp(page: Page, desk: Desk): Promise<void> {
  await page.goto(`${desk.origin}/#token=e2e-device-token`);
  await expect(page.locator('mc-root .shell')).toBeVisible();
}

test.describe('iPad: the header chip', () => {
  test.use({ viewport: { width: 1194, height: 834 }, hasTouch: true });

  test('shows the state, switches it and leaves a trace on the desk', async ({ page }) => {
    const desk = await startFakeDesk();
    try {
      await openApp(page, desk);
      const chip = page.locator('mc-shell-header mc-autopilot-chip .chip');
      await expect(chip).toHaveText(/Autopilot · On/);
      expect((await chip.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await chip.click();
      await page.getByRole('radio', { name: 'Off' }).click();
      await expect(chip).toHaveText(/Autopilot · Off/);
      expect(desk.autopilotWrites()).toEqual([{ state: 'off' }]);
    } finally {
      await desk.stop();
    }
  });

  test('a refused write says why in words', async ({ page }) => {
    const desk = await startFakeDesk({ refuseAutopilot: 'read_only' });
    try {
      await openApp(page, desk);
      await page.locator('mc-shell-header mc-autopilot-chip .chip').click();
      await page.getByRole('radio', { name: 'Paused' }).click();
      const alert = page.getByRole('alert');
      await expect(alert).toHaveText('This device is paired read-only, so it cannot change the Autopilot.');
      await expect(alert).not.toContainText('read_only');
    } finally {
      await desk.stop();
    }
  });

  test('a read-only device sees the state and every control is disabled', async ({ page }) => {
    const desk = await startFakeDesk({ readOnly: true });
    try {
      await openApp(page, desk);
      await page.locator('mc-shell-header mc-autopilot-chip .chip').click();
      for (const name of ['On', 'Paused', 'Off']) {
        await expect(page.getByRole('radio', { name })).toBeDisabled();
      }
      await expect(page.getByRole('button', { name: /Stop all running steps now/ })).toBeDisabled();
      expect(desk.autopilotWrites()).toEqual([]);
    } finally {
      await desk.stop();
    }
  });
});

test.describe('phone: the app-bar button and its sheet', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('opens a sheet of three 56 px rows with Stop-now below', async ({ page }, testInfo) => {
    const desk = await startFakeDesk();
    try {
      await openApp(page, desk);
      // The phone's root is the menu; Work is the first place.
      await expect(page.locator('mc-menu .row.autopilot')).toHaveAccessibleName('Autopilot, On');
      await page.locator('mc-menu').getByRole('button', { name: /^Work/ }).click();
      const button = page.locator('mc-work mc-app-bar mc-autopilot-button .btn');
      const box = (await button.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      await button.click();
      const sheet = page.getByRole('dialog', { name: 'Autopilot' });
      await expect(sheet.getByRole('radio')).toHaveCount(3);
      for (const row of await sheet.getByRole('radio').all()) {
        expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(56);
      }
      await expect(sheet.getByRole('button', { name: /Stop all running steps now/ })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath('mc-phone-autopilot-sheet.png') });
    } finally {
      await desk.stop();
    }
  });
});

/**
 * req-179 (boards 10t and 10u): the tranche on the iPad popover, the phone
 * sheet and the checkpoint card in the chat. The shots land in
 * test-results/fidelity/ beside the fidelity specs'; the clock stands at the
 * boards' 14:10.
 */
const FID_OUT = process.env['FID_OUT'] ?? 'test-results/fidelity';

async function openAt(page: Page, desk: Desk): Promise<void> {
  await page.clock.setFixedTime(new Date(2026, 10, 7, 14, 10));
  await openApp(page, desk);
  await page.waitForTimeout(350);
}

test.describe('req-179 iPad: the tranche in the popover', () => {
  test.use({ viewport: { width: 1194, height: 834 }, deviceScaleFactor: 1, hasTouch: true, locale: 'en-GB' });

  test('On shows the tranche chips, bar and note', async ({ page }) => {
    const desk = await startFakeDesk({ boards: true, pad: true, tranche: 'running' });
    try {
      await openAt(page, desk);
      await page.locator('mc-autopilot-chip button').first().click();
      const pop = page.locator('mc-autopilot-panel');
      await expect(pop.locator('.pd-chip')).toHaveText(['Tranche 4 of 10 runs', '$4.10 of $15 today', '2 h 10 min left']);
      await expect(pop.locator('.pd-note')).toHaveText('Pauses with a checkpoint report after the tranche.');
      await page.screenshot({ path: `${FID_OUT}/Autopilot-ipad-on.png` });
    } finally {
      await desk.stop();
    }
  });

  test('Paused at a checkpoint releases with Autopilot On', async ({ page }) => {
    const desk = await startFakeDesk({ boards: true, pad: true, tranche: 'checkpoint' });
    try {
      await openAt(page, desk);
      const chip = page.locator('mc-autopilot-chip button').first();
      await expect(chip).toContainText('Autopilot · Paused');
      await chip.click();
      const pop = page.locator('mc-autopilot-panel');
      await expect(pop.locator('.pd-chip')).toHaveText(['Checkpoint report waiting', 'Resume at 18:00', '$4.10 of $15 today']);
      await page.screenshot({ path: `${FID_OUT}/Autopilot-ipad-checkpoint.png` });
      await pop.getByRole('button', { name: 'Release next tranche' }).click();
      await expect(chip).toContainText('Autopilot · On');
      expect(desk.autopilotWrites()).toEqual([{ state: 'on' }]);
    } finally {
      await desk.stop();
    }
  });
});

test.describe('req-179 phone: the checkpoint', () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true, locale: 'en-GB' });

  test('the sheet carries the checkpoint header and a Release button; the card sits in the chat', async ({ page }) => {
    const desk = await startFakeDesk({ boards: true, tranche: 'checkpoint' });
    try {
      await openAt(page, desk);
      await page.locator('mc-menu .chats .sess').first().click();
      const card = page.locator('mc-chat mc-tranche-card .card');
      await expect(card.locator('.title')).toContainText('Checkpoint · tranche 1 of 3 done');
      await card.scrollIntoViewIfNeeded();
      await page.waitForTimeout(350);
      await page.screenshot({ path: `${FID_OUT}/MCCards-phone-checkpoint.png` });
      await page.locator('mc-chat mc-app-bar mc-autopilot-button button').first().click();
      const sheet = page.getByRole('dialog', { name: 'Autopilot' });
      await expect(sheet.locator('.ph-resume span')).toHaveText('Checkpoint · resume at 18:00');
      expect((await sheet.locator('.ph-release').boundingBox())!.height).toBe(48);
      await page.waitForTimeout(350);
      await page.screenshot({ path: `${FID_OUT}/Autopilot-phone-checkpoint.png` });
      await sheet.getByRole('button', { name: 'Release next tranche' }).click();
      await expect(sheet).toBeHidden();
      expect(desk.autopilotWrites()).toEqual([{ state: 'on' }]);
      await expect(card).toBeHidden();
    } finally {
      await desk.stop();
    }
  });

  test('an early stop draws the red tickets and Open report adds the grid', async ({ page }, testInfo) => {
    const desk = await startFakeDesk({ boards: true, tranche: 'early' });
    try {
      await openAt(page, desk);
      await page.locator('mc-menu .chats .sess').first().click();
      const card = page.locator('mc-chat mc-tranche-card .card');
      await expect(card.locator('.title')).toContainText('Stopped early · gate rate fell');
      await expect(card.locator('.red-row')).toHaveCount(3);
      await card.scrollIntoViewIfNeeded();
      await page.waitForTimeout(350);
      await page.screenshot({ path: `${FID_OUT}/MCCards-phone-early.png` });
      await card.getByRole('button', { name: 'Open report' }).click();
      await expect(card.locator('.metric')).toHaveCount(4);
      await page.screenshot({ path: testInfo.outputPath('early-report.png') });
    } finally {
      await desk.stop();
    }
  });
});
