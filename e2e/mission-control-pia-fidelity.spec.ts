/**
 * req-281 (with req-293, req-294, req-296): Mission Control's persona Pia on
 * the crew boards 10i v2 (phone Crew, `MPhoneTeamV2`), the phone detail
 * (`MPhonePia`, drawn 1100 tall) and 5d v2 (iPad Crew with Pia selected,
 * `PadTeamV2`). Stands the built Mission Control in each board's state over the
 * fake desk's board sample with Pia leading the crew and writes the
 * screenshot to test-results/fidelity/<Board>.png for boards/compare.html.
 * Prerequisite: npm run build:mission-control.
 */
import { test, expect, type Page } from '@playwright/test';
import { startFakeDesk } from './fixtures/mission-control-fake-desk';

const OUT = process.env['FID_OUT'] ?? 'test-results/fidelity';
const settle = (page: Page) => page.waitForTimeout(350);
const shot = async (page: Page, board: string) => {
  await settle(page);
  await page.screenshot({ path: `${OUT}/${board}.png` });
};

async function open(page: Page, origin: string, insets: { top: number; bottom: number }): Promise<void> {
  await page.clock.setFixedTime(new Date(2026, 10, 7, 14, 10));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: insets.top, left: 0, bottom: insets.bottom, right: 0 } });
  await page.goto(`${origin}/#token=e2e-device-token`);
  await expect(page.locator('mc-root .shell')).toBeVisible();
  await settle(page);
}

test.describe('phone', () => {
  let desk: Awaited<ReturnType<typeof startFakeDesk>>;
  test.beforeAll(async () => {
    desk = await startFakeDesk({ boards: true, mission: true });
  });
  test.afterAll(async () => {
    await desk.stop();
  });
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true, locale: 'en-GB' });

  test('10i v2: Pia leads the crew — idle, her one line, no budget, no runs; a tap opens her', async ({ page }) => {
    await open(page, desk.origin, { top: 47, bottom: 34 });
    await page.locator('mc-menu .places .row', { hasText: 'Crew' }).click();
    const tiles = page.locator('mc-team .ph-card');
    await expect(tiles.first()).toContainText('Pia');
    await expect(tiles.first()).toContainText('idle');
    await expect(tiles.first().locator('.ph-budget')).toHaveCount(0);
    await expect(page.locator('mc-team .ph-summary')).toContainText('4 personas');
    await shot(page, 'MPhoneTeamV2');
    await tiles.first().locator('.ph-head').click();
    await expect(page.locator('mc-persona-detail')).toBeVisible();
  });

  test('10i v2 detail: Setup holds her model, her skills and her instructions', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 1100 });
    await open(page, desk.origin, { top: 47, bottom: 34 });
    await page.locator('mc-menu .places .row', { hasText: 'Crew' }).click();
    await page.locator('mc-team .ph-card').first().locator('.ph-head').click();
    const detail = page.locator('mc-persona-detail');
    await detail.getByRole('tab', { name: 'Setup' }).click();
    await expect(detail).toContainText('Same as the assistant');
    await expect(detail).toContainText('LM Studio · qwen3-coder-30b');
    await expect(detail).toContainText('board-triage');
    await expect(detail).toContainText('Who Pia is');
    await expect(detail.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    await shot(page, 'MPhonePia');
  });
});

test.describe('iPad', () => {
  let desk: Awaited<ReturnType<typeof startFakeDesk>>;
  test.beforeAll(async () => {
    desk = await startFakeDesk({ boards: true, pad: true, mission: true });
  });
  test.afterAll(async () => {
    await desk.stop();
  });
  test.use({ viewport: { width: 1194, height: 834 }, deviceScaleFactor: 1, hasTouch: true, locale: 'en-GB' });

  test('5d v2: Pia selected — no pause, Chat · Memory · Setup, Setup with model, skills, instructions', async ({ page }) => {
    await open(page, desk.origin, { top: 24, bottom: 20 });
    await page.locator('mc-shell-header .sw', { hasText: 'Crew' }).click();
    await settle(page);
    const card = page.locator('mc-team .pd-card', { hasText: 'Pia' });
    await expect(card.locator('.pd-budget')).toHaveCount(0);
    await card.locator('.pd-head').click();
    const detail = page.locator('mc-persona-detail');
    await expect(detail.locator('.pd-pause')).toHaveCount(0);
    await expect(detail.getByRole('tab', { name: /^Memory/ })).toBeVisible();
    await detail.getByRole('tab', { name: 'Setup' }).click();
    await expect(detail).toContainText('Same as the assistant');
    await expect(detail).toContainText('Who Pia is');
    await shot(page, 'PadTeamV2');
  });
});
