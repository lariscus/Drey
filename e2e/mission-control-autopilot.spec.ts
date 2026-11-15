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
 * The fidelity shots land in test-results/fidelity/ beside the fidelity
 * specs'; the clock stands at the boards' 14:10.
 */
const FID_OUT = process.env['FID_OUT'] ?? 'test-results/fidelity';

async function openAt(page: Page, desk: Desk): Promise<void> {
  await page.clock.setFixedTime(new Date(2026, 10, 7, 14, 10));
  await openApp(page, desk);
  await page.waitForTimeout(350);
}

test.describe('req-181 phone: the burn rate', () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true, locale: 'en-GB' });

  test('the card sits in the chat, the sheet says the hold, Allow today once lifts it on the desk', async ({ page }) => {
    const desk = await startFakeDesk({ boards: true, hold: true });
    try {
      await openAt(page, desk);
      await page.locator('mc-menu .chats .sess').first().click();
      const card = page.locator('mc-chat mc-burn-rate-card .card');
      await expect(card.locator('.title')).toContainText('Burn rate reached · 20 % of the week today');
      await expect(card.locator('.chip')).toHaveText(['spent 21 %', /^resumes \d\d:\d\d$/]);
      await card.scrollIntoViewIfNeeded();
      await page.waitForTimeout(350);
      await page.screenshot({ path: `${FID_OUT}/MCCards-phone-burn-rate.png` });
      await page.locator('mc-chat mc-app-bar mc-autopilot-button button').first().click();
      const sheet = page.getByRole('dialog', { name: 'Autopilot' });
      await expect(sheet.locator('[data-state=on] .ph-sentence')).toHaveText(/^Burn rate reached · resumes at \d\d:\d\d$/);
      await page.keyboard.press('Escape');
      await expect(sheet).toBeHidden();
      await card.getByRole('button', { name: 'Allow today once' }).click();
      await expect(card).toBeHidden();
      expect(desk.holdLifts()).toHaveLength(1);
    } finally {
      await desk.stop();
    }
  });
});
