/**
 * The crew on the REAL engine with FAKE harnesses (req-78, req-120, req-148):
 * a home of its own (Drey Service, its `service.json` and fleet state live
 * there — the owner's `~/.drey-engine` is never touched), a scratch dricket
 * store on the lifecycle stages, a temp work repository the runs get their
 * worktrees of, the meta vault on the persona board with a small crew, and
 * the `fake-harness.cjs` CLIs first on `PATH` (a Claude Code run turn ends at
 * once, or hangs, as the spec's script says). Call `crewRunEnv()` at module
 * level, before the app starts: it sets `USERPROFILE`/`HOME`/`PATH` for the
 * whole spec file, which the Drey fixture and the service inherit.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fakeHarnessDir, pathWithFakes } from './fake-harness';
import { dkOf, type StoreDirs } from './persona-board-seed';

const bin = process.env['DREY_DK_BIN'] ?? 'dk';

/** `dk` >= 0.6.2 on PATH (the lifecycle store's commands). */
export function dkVersionOk(): boolean {
  try {
    const out = execFileSync(bin, ['--version'], { encoding: 'utf8', windowsHide: true });
    const m = /version:\s*v?(\d+)\.(\d+)\.(\d+)/.exec(out);
    return m !== null && (Number(m[1]) > 0 || Number(m[2]) > 6 || (Number(m[2]) === 6 && Number(m[3]) >= 2));
  } catch {
    return false;
  }
}

/** One rule of the fake harness's script (see `fake-harness.cjs`). */
export interface FakeRule {
  readonly match: string;
  readonly write?: { readonly file: string; readonly text?: string };
  readonly hang?: boolean;
  readonly result?: string;
}

/** The spec's temp world. */
export interface CrewRunEnv extends StoreDirs {
  readonly home: string;
  readonly repoDir: string;
  readonly worktrees: string;
  readonly harnessLog: string;
  readonly scriptFile: string;
}

/** The temp root, the home, the fake harnesses on PATH, the git identity — for the whole spec file. */
export function crewRunEnv(prefix: string, rules: readonly FakeRule[]): CrewRunEnv {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const home = path.join(root, 'home');
  fs.mkdirSync(home, { recursive: true });
  const harnessLog = path.join(root, 'harness.log');
  const scriptFile = path.join(root, 'harness.json');
  fs.writeFileSync(scriptFile, JSON.stringify({ log: harnessLog, rules }, null, 2));
  process.env['USERPROFILE'] = home;
  process.env['HOME'] = home;
  process.env['PATH'] = pathWithFakes(fakeHarnessDir({ script: scriptFile }));
  process.env['Path'] = process.env['PATH'];
  process.env['DK_OWNER'] = 'henrik';
  process.env['GIT_AUTHOR_NAME'] = 'Crew Test';
  process.env['GIT_AUTHOR_EMAIL'] = 'crew@test.invalid';
  process.env['GIT_COMMITTER_NAME'] = 'Crew Test';
  process.env['GIT_COMMITTER_EMAIL'] = 'crew@test.invalid';
  // Model discovery asks models.dev otherwise; nothing leaves the machine.
  process.env['DREY_MODELS_REGISTRY_URL'] = 'http://127.0.0.1:9/api.json';
  return {
    bin,
    root,
    home,
    storeDir: path.join(root, 's'),
    dataDir: path.join(root, 'd'),
    repoDir: path.join(root, 'repo'),
    worktrees: path.join(root, 'wt'),
    harnessLog,
    scriptFile,
  };
}

/** The work repository: `main` with one commit — what each run's worktree forks from. */
export function initWorkRepo(env: CrewRunEnv): void {
  fs.mkdirSync(env.repoDir, { recursive: true });
  const git = (...args: string[]): string => execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false', ...args], { cwd: env.repoDir, encoding: 'utf8', windowsHide: true, stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(env.repoDir, 'README.md'), '# Work repository\n');
  fs.writeFileSync(path.join(env.repoDir, '.gitignore'), 'green.txt\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'the work repository');
}

/**
 * The machine layer (`~/.drey-engine/service.json`): one Claude Code slot of
 * `sessions` places, the other providers' stand-ins off, one model in the
 * `heavy` class every persona asks for.
 */
export function writeServiceJson(env: CrewRunEnv, sessions: number): void {
  const dir = path.join(env.home, '.drey-engine');
  fs.mkdirSync(dir, { recursive: true });
  const config = {
    slots: [{ id: 'fake-claude', label: 'Fake Claude', provider: 'claude-code', quota: 'counting', sessions }],
    impliedOff: ['opencode', 'kimi', 'copilot'],
    models: [{ model: 'sonnet', provider: 'claude-code', class: 'heavy', category: 'test' }],
  };
  fs.writeFileSync(path.join(dir, 'service.json'), `${JSON.stringify(config, null, 2)}\n`);
}

/** One agent persona's record and prompt. */
export interface CrewPersona {
  readonly id: string;
  readonly title: string;
  readonly role: 'planner' | 'builder' | 'reviewer' | 'tester';
  readonly color: string;
  readonly parallel?: number;
}

const slash = (p: string): string => p.replace(/\\/g, '/');

/** The meta vault on the persona board: the lifecycle pipeline with `flow:`, the repository, the crew. */
export function crewVault(env: CrewRunEnv, flow: string, personas: readonly CrewPersona[]): Record<string, string> {
  const files: Record<string, string> = {
    'tickets/_meta/pipeline.md': ['---', 'phases:', '  - { id: inbox, title: Inbox, handover: manual }', '  - { id: prioritized, title: Prioritized, handover: manual }', '  - { id: done, title: Done, handover: none }', `flow: ${flow}`, '---', 'The lifecycle columns.', ''].join('\n'),
    'tickets/_meta/repos.md': ['---', 'repos:', '  drey:', `    url: "${slash(env.repoDir)}"`, '    branch: main', `    path: "${slash(env.repoDir)}"`, `    worktrees: "${slash(env.worktrees)}"`, '---', ''].join('\n'),
    'tickets/_meta/crew.md': [
      '---',
      'seeded-crew: [pia, paul, ben, ralf, tessa]',
      'seeded-pictures: [pia, paul, ben, ralf, tessa, you]',
      `order: [${[...personas.map((p) => p.id), 'you'].join(', ')}]`,
      '---',
      '',
    ].join('\n'),
    'tickets/_meta/personas/you/persona.md': ['---', 'title: You', 'kind: human', 'role: custom', "color: '#e0bb6e'", '---', ''].join('\n'),
  };
  for (const p of personas) {
    files[`tickets/_meta/personas/${p.id}/persona.md`] = ['---', `title: ${p.title}`, `role: ${p.role}`, 'class: heavy', `color: '${p.color}'`, ...(p.parallel === undefined ? [] : [`parallel: ${p.parallel}`]), '---', ''].join('\n');
    files[`tickets/_meta/personas/${p.id}/prompt.md`] = `## Who ${p.title} is\n\n${p.title} works the ${p.role} step of the e2e crew.\n`;
  }
  return files;
}

/** The tickets plugin on the scratch store. */
export function writeTicketsConfig(userDataDir: string, env: CrewRunEnv): void {
  const dir = path.join(userDataDir, 'plugins', 'tickets');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ backend: 'dricket', 'dk.store': env.storeDir, 'dk.dataDir': env.dataDir, 'dk.syncSeconds': 0 }, null, 2));
}

/** A ticket body whose machine gate runs one command; `type`/`test -f` keeps it free of any toolchain. */
export function acceptanceBody(file: string): string {
  const command = process.platform === 'win32' ? `type ${file}` : `test -f ${file}`;
  return ['## Plan', '', '### Acceptance criteria', '', `- [ ] \`${command}\``, ''].join('\n');
}

/** Stops the Drey Service the app started under `home` (it outlives Drey by design). */
export function stopEngine(env: CrewRunEnv): void {
  try {
    const lock = JSON.parse(fs.readFileSync(path.join(env.home, '.drey-engine', 'service.lock'), 'utf8')) as { pid?: number };
    if (typeof lock.pid === 'number') {
      process.kill(lock.pid);
    }
  } catch {
    // no engine was started, or it is already gone
  }
}

/** A failed test's evidence: the service home (logs, fleet state, run notes) and the fake harness's log, copied beside the test's output. */
export function keepEvidence(env: CrewRunEnv, outDir: string): void {
  try {
    fs.cpSync(path.join(env.home, '.drey-engine'), path.join(outDir, 'drey-engine'), { recursive: true, filter: (src) => !/[\\/](node_modules|_worktrees)([\\/]|$)/.test(src) });
  } catch {
    // nothing there, or a file still locked
  }
  try {
    fs.copyFileSync(env.harnessLog, path.join(outDir, 'harness.log'));
  } catch {
    // no fake turn ran
  }
}

/** Removes the temp world; a file the killed processes still hold open leaves a harmless leftover. */
export function removeEnv(env: CrewRunEnv): void {
  stopEngine(env);
  try {
    fs.rmSync(env.root, { recursive: true, force: true });
  } catch {
    // the engine and its workers hold files open for a moment after the kill
  }
}

/** The runner's chain status (`GET /chain` on its loopback API, port and token from `service.lock`); null while it is down. */
export async function chainStatus(env: CrewRunEnv): Promise<Record<string, unknown> | null> {
  try {
    const lock = JSON.parse(fs.readFileSync(path.join(env.home, '.drey-engine', 'service.lock'), 'utf8')) as { components?: { runner?: { port?: number; token?: string; state?: string } } };
    const runner = lock.components?.runner;
    if (runner?.port === undefined || runner.token === undefined) {
      return null;
    }
    const res = await fetch(`http://127.0.0.1:${runner.port}/chain`, { headers: { Authorization: `Bearer ${runner.token}` } });
    return res.ok ? ((await res.json()) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The ticket's whole file as the store holds it now. */
export function ticketText(env: CrewRunEnv, dkId: string): string {
  return (JSON.parse(dkOf(env)(['show', dkId, '--json'])) as { data: { content: string } }).data.content;
}

/** One header field of the ticket, or null when it is absent. */
export function ticketField(env: CrewRunEnv, dkId: string, key: string): string | null {
  return new RegExp(`^${key}: (.*)$`, 'm').exec(ticketText(env, dkId))?.[1]?.trim() ?? null;
}

/** Everything `dk show` says about the ticket, comments included (its JSON, parsed back to text — the spec matches on it). */
export function ticketShown(env: CrewRunEnv, dkId: string): string {
  return JSON.stringify(JSON.parse(dkOf(env)(['show', dkId, '--json'])) as unknown);
}

/** The fake harness's log: one entry per user message a fake Claude Code got. */
export function harnessTurns(env: CrewRunEnv): { readonly cwd: string; readonly rule: string | null; readonly text: string }[] {
  try {
    return fs
      .readFileSync(env.harnessLog, 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as { cwd: string; rule: string | null; text: string });
  } catch {
    return [];
  }
}

/** The Autopilot from the status bar's popover. */
export async function setAutopilot(page: Page, state: 'on' | 'off'): Promise<void> {
  const status = page.locator('app-status-bar');
  await status.getByText(/^Autopilot · /).click();
  const popover = page.locator('.tickets-autopilot-pop');
  await popover.locator(`[data-state="${state}"]`).click();
  await status.getByText(state === 'on' ? 'Autopilot · On' : 'Autopilot · Off').waitFor({ timeout: 30_000 });
  await page.keyboard.press('Escape');
}
