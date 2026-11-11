import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from './fixtures/drey';

/**
 * req-265 in the built app, on a SCRATCH store with a home of its own (never the owner's store): a
 * store on the six phase stages shows the migration line at the top of the Tickets panel; Migrate
 * commits the lifecycle stages to the store's `main`, moves the ticket that stood in Building to
 * `active` pinned to `building`, and the card stays in its column. Skipped when `dk` is missing.
 */
const bin = process.env['DREY_DK_BIN'] ?? 'dk';

function dkVersionOk(): boolean {
  try {
    const out = execFileSync(bin, ['--version'], { encoding: 'utf8', windowsHide: true });
    const m = /version:\s*v?(\d+)\.(\d+)\.(\d+)/.exec(out);
    return m !== null && (Number(m[1]) > 0 || Number(m[2]) > 6 || (Number(m[2]) === 6 && Number(m[3]) >= 2));
  } catch {
    return false;
  }
}
const haveDk = dkVersionOk();

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dks-'));
const home = path.join(root, 'home');
fs.mkdirSync(home, { recursive: true });
process.env['USERPROFILE'] = home;
process.env['HOME'] = home;
process.env['DK_OWNER'] = 'henrik';
process.env['GIT_AUTHOR_NAME'] = 'Stage Test';
process.env['GIT_AUTHOR_EMAIL'] = 'stages@test.invalid';
process.env['GIT_COMMITTER_NAME'] = 'Stage Test';
process.env['GIT_COMMITTER_EMAIL'] = 'stages@test.invalid';

function stopEngine(): void {
  try {
    const lock = JSON.parse(fs.readFileSync(path.join(home, '.drey-engine', 'service.lock'), 'utf8')) as { pid?: number };
    if (typeof lock.pid === 'number') {
      process.kill(lock.pid);
    }
  } catch {
    // no engine was started, or it is already gone
  }
}

test.skip(!haveDk, 'dk >= 0.6.2 not found');
test.afterEach(() => stopEngine());
test.afterAll(() => {
  stopEngine();
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {
    // The engine holds files open for a moment after the kill; a leftover temp dir is harmless.
  }
});

const PIPELINE = [
  '---',
  'phases:',
  '  - { id: inbox, title: Inbox, handover: manual }',
  '  - { id: shaping, title: Shaping, handover: manual }',
  '  - { id: prioritized, title: Prioritized, handover: manual }',
  '  - { id: building, title: Building, handover: manual }',
  '  - { id: ready, title: Ready to try, handover: manual }',
  '  - { id: done, title: Done, handover: none }',
  '---',
  'The phases.',
  '',
].join('\n');

test.use({ seedVault: { 'tickets/_meta/pipeline.md': PIPELINE } });

let storeDir = '';
let dk: (args: string[]) => string = () => '';
const git = (...args: string[]): string => execFileSync('git', args, { cwd: storeDir, windowsHide: true, stdio: 'pipe', encoding: 'utf8' }).trim();

test.beforeEach(({ userDataDir }) => {
  if (!haveDk) {
    return;
  }
  storeDir = path.join(fs.mkdtempSync(path.join(root, 's-')), 's');
  const dataDir = fs.mkdtempSync(path.join(root, 'd-'));
  dk = (args) =>
    execFileSync(bin, args, { cwd: fs.existsSync(storeDir) ? storeDir : root, env: { ...process.env, DK_OWNER: 'terminal', DK_STORE: storeDir, DK_DATA_DIR: dataDir }, encoding: 'utf8', windowsHide: true, stdio: 'pipe' });
  dk(['init', storeDir, 't']);
  git('config', 'core.autocrlf', 'false');
  git('checkout', '-q', 'main');
  fs.appendFileSync(
    path.join(storeDir, 'dricket.toml'),
    '\n[stages]\nvalues = ["inbox", "shaping", "prioritized", "building", "ready", "done"]\ninitial = "inbox"\nterminal = ["done"]\nclaim = ["building"]\ncancelled = "cancelled"\n',
  );
  git('commit', '-q', '-am', 'the six phase stages');
  git('checkout', '-q', 'tickets');
  dk(['add', '--unclaimed', '-m', 'Alpha: export the vault as a zip']);
  // Into Building, unclaimed, as the old board's move would leave it: one put --claim.
  const shown = dk(['show', 't-1']);
  const doc = shown.slice(shown.indexOf('---')).replace(/^stage: .*$/m, 'stage: building');
  const rev = /^rev: (\d+)$/m.exec(doc)?.[1] ?? '0';
  const file = path.join(root, `t-1-${Date.now()}.md`);
  fs.writeFileSync(file, doc);
  dk(['put', 't-1', '-F', file, '--claim', '--if-version', rev]);
  const dir = path.join(userDataDir, 'plugins', 'tickets');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ backend: 'dricket', 'dk.store': storeDir, 'dk.dataDir': dataDir, 'dk.syncSeconds': 0 }, null, 2));
});

test('a store on the old stages offers Migrate; one click moves it to the lifecycle stages and the card keeps its column', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await page.locator('app-dock-strip button[aria-label="Show Tickets"]').click();
  const panel = page.locator('.tickets-panel').filter({ visible: true });
  await expect(panel.locator('.work-row[data-id="T-0001"]')).toBeVisible({ timeout: 30_000 });

  const line = page.locator('.tickets-store-migration').filter({ visible: true });
  await expect(line).toContainText('The ticket store still uses the old stages (shaping, building, ready).');
  await page.screenshot({ path: testInfo.outputPath('stage-migration-line.png') });
  const mainBefore = git('rev-parse', 'main');

  await line.getByRole('button', { name: 'Migrate' }).click();
  await expect(line).toHaveCount(0, { timeout: 30_000 });

  expect(git('rev-list', '--count', `${mainBefore}..main`)).toBe('2'); // the two config commits, nothing else on main
  expect(git('show', 'main:dricket.toml')).toContain('values = ["inbox", "prioritized", "active", "running", "done"]');
  expect(git('show', 'main:dricket.toml')).toContain('claim = ["running"]');
  const ticket = dk(['show', 't-1']);
  expect(ticket).toMatch(/^stage: active$/m);
  expect(ticket).toMatch(/^x-phase: building$/m);
  expect(git('rev-parse', '--abbrev-ref', 'HEAD')).toBe('tickets'); // the checkout never left the ticket branch
  dk(['validate']);
  await expect(panel.locator('.work-row[data-id="T-0001"]')).toBeVisible();
});
