import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from './fixtures/drey';

/**
 * req-268, the live board migration's code side, in the RUNNING app over the
 * real engine: a SCRATCH dricket store already on the lifecycle stages (steps
 * 1–2, milestone 239's Migrate) and a meta vault still describing the phase
 * board — Building names `build-default`, the crew file has no order, the two
 * legacy defaults exist. The Tickets panel offers steps 3, 4 and 5 one at a
 * time; each is reviewed and confirmed (never run on its own) and lands as
 * its commit(s) in the meta vault. The owner's own board is never touched:
 * everything lives under a temp dir with a home of its own. Skipped without `dk`.
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

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dbm-'));
const home = path.join(root, 'home');
const storeDir = path.join(root, 's');
const dataDir = path.join(root, 'd');
fs.mkdirSync(home, { recursive: true });
process.env['USERPROFILE'] = home;
process.env['HOME'] = home;
process.env['DK_OWNER'] = 'henrik';
process.env['GIT_AUTHOR_NAME'] = 'Migration Test';
process.env['GIT_AUTHOR_EMAIL'] = 'migration@test.invalid';
process.env['GIT_COMMITTER_NAME'] = 'Migration Test';
process.env['GIT_COMMITTER_EMAIL'] = 'migration@test.invalid';

const dk = (args: string[]): string =>
  execFileSync(bin, args, { cwd: fs.existsSync(storeDir) ? storeDir : root, env: { ...process.env, DK_STORE: storeDir, DK_DATA_DIR: dataDir }, encoding: 'utf8', windowsHide: true, stdio: 'pipe' });
const git = (...args: string[]): string => execFileSync('git', args, { cwd: storeDir, encoding: 'utf8', windowsHide: true, stdio: 'pipe' });

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

const OUT = path.resolve(__dirname, '..', 'test-results', 'fidelity');

/** The owner's live pipeline as concept §0 read it: Building names build-default twice and carries its run keys. */
const PIPELINE = [
  '---',
  'phases:',
  '  - { id: inbox, title: Inbox, handover: manual, persona: you }',
  '  - { id: shaping, title: Shaping, handover: manual, persona: you }',
  '  - { id: prioritized, title: Prioritized, handover: manual, persona: you }',
  '  - { id: building, title: Building, wip: 3, claim: true, handover: agent build-default, persona: build-default, token-budget: 40000000, min-class: B, max-turns: 80 }',
  '  - { id: ready, title: Ready to try, handover: manual, persona: you }',
  '  - { id: done, title: Done, handover: none }',
  '---',
  'The phases.',
  '',
].join('\n');

const persona = (title: string, kind: string, role: string): string =>
  // req-288: v3 records — a light class, so step 3's moved floor raises the builder's class.
  ['---', `title: ${title}`, ...(kind === 'agent' ? [] : [`kind: ${kind}`]), `role: ${role}`, ...(kind === 'agent' ? ['class: light'] : []), '---', ''].join('\n');

const SEED_VAULT: Record<string, string> = {
  'tickets/_meta/pipeline.md': PIPELINE,
  'tickets/_meta/repos.md': ['---', 'repos:', '  drey:', '    url: https://example.invalid/drey.git', '    branch: main', '---', ''].join('\n'),
  'tickets/_meta/crew.md': ['---', 'seeded-crew: [paul, ben, ralf, tessa]', '---', ''].join('\n'),
  'tickets/_meta/personas/pia/persona.md': persona('Pia', 'mission', 'custom'),
  'tickets/_meta/personas/paul/persona.md': persona('Paul', 'agent', 'planner'),
  'tickets/_meta/personas/ben/persona.md': persona('Ben', 'agent', 'builder'),
  'tickets/_meta/personas/ben/prompt.md': 'Ben builds.\n',
  'tickets/_meta/personas/ralf/persona.md': persona('Ralf', 'agent', 'reviewer'),
  'tickets/_meta/personas/tessa/persona.md': persona('Tessa', 'agent', 'tester'),
  'tickets/_meta/personas/you/persona.md': persona('You', 'human', 'custom'),
  'tickets/_meta/personas/build-default/persona.md': persona('build-default', 'agent', 'builder'),
  'tickets/_meta/personas/build-default/prompt.md': 'Build the ticket, run its checks, hand it on.\n',
  'tickets/_meta/personas/commit-default/persona.md': persona('commit-default', 'agent', 'custom'),
};

test.beforeAll(() => {
  if (!haveDk) {
    return;
  }
  dk(['init', storeDir, 't']);
  git('config', 'core.autocrlf', 'false');
  git('checkout', '-q', 'main');
  const toml = path.join(storeDir, 'dricket.toml');
  fs.writeFileSync(toml, `${fs.readFileSync(toml, 'utf8').replace(/\[transitions\.agent\][\s\S]*?(?=\n\[|$)/, '')}\n[stages]\nvalues = ["inbox", "prioritized", "active", "running", "done"]\ninitial = "inbox"\nterminal = ["done"]\nclaim = ["running"]\ncancelled = "cancelled"\n`);
  git('commit', '-q', '-am', 'the lifecycle stages');
  git('checkout', '-q', 'tickets');
  dk(['add', '--unclaimed', '-m', 'Export the vault as a zip']);
});

test.afterEach(() => stopEngine());

test.afterAll(() => {
  stopEngine();
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {
    // The engine holds files open for a moment after the kill; a leftover temp dir is harmless.
  }
});

test.use({
  seedVault: SEED_VAULT,
  launchArgs: ['--force-device-scale-factor=1'],
  appConfig: { plugins: { disabled: ['sample', 'templates', 'browser', 'drawio', 'ocr', 'meeting'] }, spellcheck: { enabled: false } },
});

test.beforeEach(({ userDataDir }) => {
  if (!haveDk) {
    return;
  }
  const dir = path.join(userDataDir, 'plugins', 'tickets');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ backend: 'dricket', 'dk.store': storeDir, 'dk.dataDir': dataDir, 'dk.syncSeconds': 0 }, null, 2));
});

test('the board migration steps 3 to 5, each on the owner’s confirmation (req-268)', async ({ page, vaultDir }, testInfo) => {
  test.setTimeout(300_000);
  fs.mkdirSync(OUT, { recursive: true });
  const meta = path.join(vaultDir, 'tickets', '_meta');
  const read = (rel: string): string => fs.readFileSync(path.join(meta, rel), 'utf8');
  const tabs = page.locator('[role="tablist"][aria-label="Views"] [role="tab"]');
  await expect(tabs).toHaveText(['Notes', 'Work', 'Crew'], { timeout: 30_000 });
  await tabs.filter({ hasText: 'Work' }).click();
  const panel = page.locator('.tickets-panel').filter({ visible: true });
  const line = panel.locator('.tickets-board-migration');

  // Step 3: offered with what it writes; nothing changes before the confirmation.
  await expect(line).toContainText('Board migration, step 3 of 5: the pipeline keeps only Inbox, Prioritized and Done.', { timeout: 60_000 });
  expect(read('pipeline.md')).toContain('building');
  await line.getByRole('button', { name: 'Review…' }).click();
  await expect(line.locator('li')).toHaveText([
    'Removes the columns Shaping, Building, Ready to try.',
    'Writes the standard flow: paul:shape; paul; ben; ralf; tessa; you.',
    'Moves min-class, max-turns onto ben.',
    'Keeps the token budget 40,000,000 as a board key.',
    'One commit in the tickets repository.',
  ]);
  await page.screenshot({ path: testInfo.outputPath('migration-step-3.png') });
  await page.screenshot({ path: path.join(OUT, 'BoardMigration.step3.png'), clip: { x: 0, y: 40, width: 360, height: 400 } });
  await line.getByRole('button', { name: 'Migrate' }).click();
  await expect.poll(() => read('pipeline.md'), { timeout: 30_000 }).not.toContain('building');
  expect(read('pipeline.md')).toContain('token-budget: 40000000');
  expect(read('personas/ben/persona.md')).toContain('class: standard'); // req-288: the floor raised the class
  expect(read('personas/ben/persona.md')).not.toContain('min-class');

  // Step 4: the leaving actions (the engine's crew seeding wrote the order at start, so the step keeps it).
  await expect(line).toContainText('step 4 of 5', { timeout: 30_000 });
  expect(read('crew.md')).toMatch(/order: \[pia, /);
  await line.getByRole('button', { name: 'Review…' }).click();
  await expect(line.locator('li')).toHaveText(['Adds the leaving action sync-main to ben.', 'Adds the leaving action commit to you.', 'One commit in the tickets repository.']);
  await line.getByRole('button', { name: 'Migrate' }).click();
  await expect.poll(() => read('personas/ben/persona.md'), { timeout: 30_000 }).toContain('leaving: [sync-main]');
  expect(read('personas/you/persona.md')).toContain('leaving: [commit]');

  // Step 5: the legacy defaults go through req-261's route; a prompt that differs from Ben's is named first.
  await expect(line).toContainText('step 5 of 5: delete build-default, commit-default', { timeout: 30_000 });
  await line.getByRole('button', { name: 'Review…' }).click();
  await expect(line.locator('li')).toContainText(["The prompt of build-default differs from ben's own: read it before you delete."]);
  await page.screenshot({ path: testInfo.outputPath('migration-step-5.png') });
  await line.getByRole('button', { name: 'Migrate' }).click();
  await expect.poll(() => fs.existsSync(path.join(meta, 'personas', 'build-default')), { timeout: 30_000 }).toBe(false);
  await expect.poll(() => fs.existsSync(path.join(meta, 'personas', 'commit-default')), { timeout: 30_000 }).toBe(false);
  await expect(line).toHaveCount(0, { timeout: 30_000 });
});
