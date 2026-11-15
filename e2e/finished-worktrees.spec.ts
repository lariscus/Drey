import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from './fixtures/drey';
import { dkIdOf, fieldOf, idOf, seedStore, type Seed } from './fixtures/persona-board-seed';

/**
 * req-185 (milestone 273, ADR-0099): a finished ticket's worktree goes after
 * its merge. In the RUNNING app over the real engine and the real Crew runner,
 * on a SCRATCH dricket store on the lifecycle stages: one ticket whose chain
 * ends at You, its branch `t/T-0001` with a commit in a real git work repo,
 * its worktree under the repo's `worktrees:` base (the per-repo override of
 * `repos.md`, kept). The owner's Accept at You is the sign-off: You's `commit`
 * runs as a machine run (no worker, no model), merges the branch into main,
 * and then removes the worktree with `git worktree remove` — the branch stays
 * and the ticket lands in Done. Everything lives under a temp dir with a home
 * of its own; the owner's `~/.drey-engine`, boards and repositories are never
 * touched, and no harness is started. Skipped when `dk` is missing.
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

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dfw-'));
const home = path.join(root, 'home');
const storeDir = path.join(root, 's');
const dataDir = path.join(root, 'd');
const repoDir = path.join(root, 'drey');
const worktreeBase = path.join(root, 'wt');
const worktree = path.join(worktreeBase, 'T-0001');
fs.mkdirSync(home, { recursive: true });
process.env['USERPROFILE'] = home;
process.env['HOME'] = home;
process.env['DK_OWNER'] = 'henrik';
process.env['GIT_AUTHOR_NAME'] = 'Worktree Test';
process.env['GIT_AUTHOR_EMAIL'] = 'worktree@test.invalid';
process.env['GIT_COMMITTER_NAME'] = 'Worktree Test';
process.env['GIT_COMMITTER_EMAIL'] = 'worktree@test.invalid';

const dirs = { bin, root, storeDir, dataDir };
const field = fieldOf(dirs);
const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, stdio: 'pipe' }).trim();

const SEEDS: readonly Seed[] = [{ title: 'Spell-check the commit message', stage: 'active', chain: 'you', at: 1 }];

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

/** The work repo: main with one commit, the ticket's branch one commit ahead in its worktree; the checkout itself on another branch, so main may move. */
function seedRepo(): void {
  fs.mkdirSync(repoDir, { recursive: true });
  git(repoDir, 'init', '-q', '-b', 'main');
  git(repoDir, 'config', 'core.autocrlf', 'false');
  fs.writeFileSync(path.join(repoDir, 'README.md'), '# Drey\n');
  git(repoDir, 'add', '-A');
  git(repoDir, 'commit', '-q', '-m', 'first');
  fs.mkdirSync(worktreeBase, { recursive: true });
  git(repoDir, 'worktree', 'add', '-q', '-b', 't/T-0001', worktree, 'main');
  fs.writeFileSync(path.join(worktree, 'spell.md'), 'Checked.\n');
  git(worktree, 'add', '-A');
  git(worktree, 'commit', '-q', '-m', 'T-0001: spell-check the commit message');
  git(repoDir, 'checkout', '-q', '-b', 'dev');
}

test.skip(!haveDk, 'dk >= 0.6.2 not found');

const persona = (title: string, kind: string, extra: string[] = []): string =>
  ['---', `title: ${title}`, ...(kind === 'agent' ? [] : [`kind: ${kind}`]), 'role: custom', `color: '#e0bb6e'`, ...extra, '---', `Who ${title} is.`, ''].join('\n');

test.beforeAll(() => {
  if (haveDk) {
    seedStore(dirs, SEEDS);
    seedRepo();
  }
});

test.afterEach(({}, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    const fleet = path.join(home, '.drey-engine', 'fleet');
    const read = (p: string): string => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : `(no ${p})`);
    const runs = path.join(fleet, 'runs');
    const streams = fs.existsSync(runs) ? fs.readdirSync(runs).map((id) => `${id}:\n${read(path.join(runs, id, 'stream.jsonl'))}`).join('\n') : '(no runs)';
    console.log(`--- runner.log ---\n${read(path.join(fleet, 'runner.log')).slice(-6000)}\n--- streams ---\n${streams.slice(-6000)}`);
  }
  stopEngine();
});

test.afterAll(() => {
  stopEngine();
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {
    // The engine holds files open for a moment after the kill; a leftover temp dir is harmless.
  }
});

test.use({
  seedVault: {
    'tickets/_meta/pipeline.md': ['---', 'phases:', '  - { id: inbox, title: Inbox, handover: manual }', '  - { id: prioritized, title: Prioritized, handover: manual }', '  - { id: done, title: Done, handover: none }', 'flow: you', '---', 'The lifecycle columns.', ''].join('\n'),
    'tickets/_meta/repos.md': ['---', 'repos:', '  drey:', '    url: https://example.invalid/drey.git', '    branch: main', `    path: ${repoDir.replaceAll('\\', '/')}`, `    worktrees: ${worktreeBase.replaceAll('\\', '/')}`, '---', ''].join('\n'),
    'tickets/_meta/crew.md': ['---', 'order: [you]', '---', ''].join('\n'),
    'tickets/_meta/personas/you/persona.md': persona('You', 'human', ['leaving: [commit]']),
  },
  launchArgs: ['--force-device-scale-factor=1'],
  appConfig: { plugins: { disabled: ['sample', 'templates', 'browser', 'drawio', 'ocr', 'meeting'] }, spellcheck: { enabled: false } },
});

test.beforeEach(({ userDataDir }) => {
  if (!haveDk) {
    return;
  }
  const dir = path.join(userDataDir, 'plugins', 'tickets');
  fs.mkdirSync(dir, { recursive: true });
  // The commit takes a heavy governor seat: no CPU reserve, so a busy machine does not hold the test.
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ 'dk.store': storeDir, 'dk.dataDir': dataDir, 'dk.syncSeconds': 0, 'service.load.reserve': 0 }, null, 2));
});

test("the sign-off merges the branch, then the ticket's worktree goes and its branch stays (req-185)", async ({ page }) => {
  test.setTimeout(300_000);
  const tip = git(worktree, 'rev-parse', 'HEAD');
  const tabs = page.locator('[role="tablist"][aria-label="Views"] [role="tab"]');
  await expect(tabs).toHaveText(['Notes', 'Work', 'Crew'], { timeout: 30_000 });
  // The Work view opens on the Board (its default layout, req-297).
  await tabs.filter({ hasText: 'Work' }).click();
  const board = page.locator('.desk-board.desk-pboard').filter({ visible: true });
  await expect(board.locator(`.pb-card[data-id="${idOf(0)}"]`)).toBeVisible({ timeout: 60_000 });

  // You's Accept at the chain's last entry of a repository ticket: the commit run.
  await board.locator(`.pb-card[data-id="${idOf(0)}"] .pb-decide-accept`).click();

  // The merge landed on main (no upstream: the local branch moved, the checkout is on dev).
  const onMain = (): boolean => {
    try {
      git(repoDir, 'merge-base', '--is-ancestor', tip, 'main');
      return true;
    } catch {
      return false; // exit 1: not (yet) an ancestor
    }
  };
  await expect.poll(onMain, { timeout: 120_000 }).toBe(true);
  // The worktree is gone — removed by git, not left as a folder — and git no longer lists it.
  await expect.poll(() => fs.existsSync(worktree), { timeout: 60_000 }).toBe(false);
  expect(git(repoDir, 'worktree', 'list', '--porcelain')).not.toContain('T-0001');
  // The branch stays: it carries the work.
  expect(git(repoDir, 'rev-parse', '--verify', 'refs/heads/t/T-0001')).toBe(tip);
  // And the ticket is in Done.
  await expect.poll(() => field(dkIdOf(0), 'stage'), { timeout: 60_000 }).toBe('done');
});
