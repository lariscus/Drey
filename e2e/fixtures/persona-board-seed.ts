/**
 * The persona board's English demo store (req-270/271/273): the tickets of
 * boards 7e v2, 7a v2, 10c v2 and 10e v2 on a scratch dricket store on the
 * lifecycle stages, and the meta vault on the persona board (the pipeline
 * Inbox · Prioritized · Done with `flow:`, the crew's `order:`, the crew's
 * records, a ledger with the cards' costs). Shared by the desktop's
 * persona-board spec and Mission Control's; every path is the caller's temp
 * dir — the owner's stores are never touched.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const STANDARD = 'paul:shape;paul;ben;ralf;tessa;you';

/** One seeded ticket: its title, stage and the chain fields; `T-000n` follows the creation order. */
export interface Seed {
  readonly title: string;
  readonly stage: 'inbox' | 'prioritized' | 'active' | 'done';
  readonly chain?: string;
  readonly at?: number;
  readonly extra?: Record<string, string>;
  readonly priority?: string;
  readonly comment?: string;
  readonly cost?: number;
  /** Text appended to the ticket's body (a `## Verlauf` with its runs). */
  readonly body?: string;
}

/** Board 10e v2's runs of T-0118 as the runner records them, one line per settled run. */
const PALETTE_RUNS = [
  '## Verlauf',
  '',
  '- {phase: plan, persona: paul, model: claude-sonnet, tokens: 16k, cost: 0.25, dauer: 3m, ausgang: handed-over}',
  '- {phase: build, persona: ben, model: claude-sonnet, tokens: 88k, cost: 0.94, dauer: 14m, ausgang: handed-over}',
  '- {phase: review, persona: ralf, model: claude-sonnet, tokens: 30k, cost: 0.32, dauer: 5m, ausgang: handed-over}',
  '- {phase: test, persona: tessa, model: claude-sonnet, tokens: 24k, cost: 0.27, dauer: 6m, ausgang: handed-over}',
  '',
].join('\n');

export const SEEDS: readonly Seed[] = [
  { title: 'Sync status in the title bar', stage: 'inbox' },
  { title: 'Backlinks: unlinked mentions', stage: 'inbox' },
  { title: 'Calendar week numbers', stage: 'inbox' },
  { title: 'Dark mode for the PDF export', stage: 'inbox' },
  { title: 'Spell-check the commit message', stage: 'inbox' },
  { title: 'Daily note template picker', stage: 'inbox' },
  { title: 'Spellcheck: add French dictionary', stage: 'prioritized', priority: 'high' },
  { title: 'Tag rename keeps pill colors', stage: 'prioritized', chain: 'ben;tessa;you' },
  { title: 'Pin tabs to the left', stage: 'prioritized' },
  { title: 'Voice capture for tickets', stage: 'active', at: 1, cost: 0.18 },
  { title: 'Weekly security audit run', stage: 'active', chain: 'paul;you', at: 1, cost: 0.46 },
  { title: 'Export the vault as a zip', stage: 'active', at: 3, extra: { 'x-sent-back': '5>3' }, cost: 0.74 },
  { title: 'Palette: recent commands', stage: 'active', at: 3, cost: 0.88 },
  { title: 'Win+H dictation hand-off', stage: 'active', at: 3, cost: 0.3 },
  { title: 'Settings search across plugins', stage: 'active', at: 4, cost: 0.9 },
  { title: 'PDF export keeps callout colors', stage: 'active', at: 5, cost: 1.05 },
  { title: 'Outline: drag headings to reorder', stage: 'active', at: 3, extra: { 'x-awaiting': 'you' }, comment: 'needs-decision: [drag-body] Should dragging a heading also move the text below it?', cost: 1.2 },
  { title: 'Theme picker in the status bar', stage: 'active', chain: 'paul:shape;paul;ben;ghost;tessa;you', at: 4 },
  { title: 'Tag field: paste a list', stage: 'active', at: 4, extra: { 'x-awaiting': 'you', 'x-sent-back': '5>4' }, comment: 'needs-decision: [second-send-back] a second send-back from position 5: a space splits a tag in two', cost: 1.96 },
  { title: 'Palette opens twice on slow CI', stage: 'active', at: 6, cost: 1.84, body: PALETTE_RUNS },
  { title: 'Tag rename keeps descendants', stage: 'done', cost: 2.1 },
  { title: 'Spellcheck: German dictionary', stage: 'done', cost: 1.45 },
  { title: 'Pin a note to the calendar', stage: 'done' },
  { title: 'Calendar week starts on Monday', stage: 'done' },
  { title: 'Find: remember the scope', stage: 'done' },
];

export const idOf = (index: number): string => `T-${String(index + 1).padStart(4, '0')}`;
export const dkIdOf = (index: number): string => `t-${index + 1}`;
export const byTitle = (title: string): string => idOf(SEEDS.findIndex((seed) => seed.title === title));

/** The scratch store's paths and the `dk` binary. */
export interface StoreDirs {
  readonly bin: string;
  readonly root: string;
  readonly storeDir: string;
  readonly dataDir: string;
}

export function dkOf(dirs: StoreDirs): (args: string[], owner?: string) => string {
  return (args, owner = 'henrik') =>
    execFileSync(dirs.bin, args, { cwd: fs.existsSync(dirs.storeDir) ? dirs.storeDir : dirs.root, env: { ...process.env, DK_OWNER: owner, DK_STORE: dirs.storeDir, DK_DATA_DIR: dirs.dataDir }, encoding: 'utf8', windowsHide: true, stdio: 'pipe' });
}

/** A ticket's file as the store holds it, and one header field of it. */
export function fieldOf(dirs: StoreDirs): (id: string, key: string) => string | null {
  const dk = dkOf(dirs);
  return (id, key) => new RegExp(`^${key}: (.*)$`, 'm').exec((JSON.parse(dk(['show', id, '--json'])) as { data: { content: string } }).data.content)?.[1]?.trim() ?? null;
}

/** Initializes the store on the lifecycle stages and writes every seed with its chain fields. */
export function seedStore(dirs: StoreDirs): void {
  const dk = dkOf(dirs);
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: dirs.storeDir, encoding: 'utf8', windowsHide: true, stdio: 'pipe' });
  const shown = (id: string): string => (JSON.parse(dk(['show', id, '--json'])) as { data: { content: string } }).data.content;
  dk(['init', dirs.storeDir, 't']);
  git('config', 'core.autocrlf', 'false');
  git('checkout', '-q', 'main');
  const toml = path.join(dirs.storeDir, 'dricket.toml');
  fs.writeFileSync(toml, `${fs.readFileSync(toml, 'utf8').replace(/\[transitions\.agent\][\s\S]*?(?=\n\[|$)/, '')}\n[stages]\nvalues = ["inbox", "prioritized", "active", "running", "done"]\ninitial = "inbox"\nterminal = ["done"]\nclaim = ["running"]\ncancelled = "cancelled"\n`);
  git('commit', '-q', '-am', 'the lifecycle stages');
  git('checkout', '-q', 'tickets');
  for (const seed of SEEDS) {
    const id = dk(['add', '--unclaimed', '-m', seed.title]).trim();
    const text = shown(id);
    const fields = ['x-entered-inbox: 2026-11-10T09:00:00Z', `x-chain: ${seed.chain ?? STANDARD}`, ...(seed.at === undefined ? [] : [`x-at: ${seed.at}`]), ...Object.entries(seed.extra ?? {}).map(([k, v]) => `${k}: ${v}`)];
    // Every ticket names the work repository but the one You accepts at the end (a repository ticket's sign-off would start the commit run).
    const repo = seed.title === 'Palette opens twice on slow CI' ? '' : 'repos: drey\n';
    let header = text.replace(/^repos:.*\n/m, '').replace(/^stage: .*$/m, `${repo}stage: ${seed.stage}\n${fields.join('\n')}`);
    if (seed.priority !== undefined) {
      header = /^priority: .*$/m.test(header) ? header.replace(/^priority: .*$/m, `priority: ${seed.priority}`) : header.replace(/^stage: /m, `priority: ${seed.priority}\nstage: `);
    }
    const file = path.join(dirs.root, `${id}.md`);
    fs.writeFileSync(file, `${header.replace(/\s*$/, '\n')}${seed.body === undefined ? '' : `\n${seed.body}`}`);
    dk(['put', id, '-F', file, '--claim', '--if-version', /^rev: (\d+)$/m.exec(text)?.[1] ?? '1']);
    if (seed.comment !== undefined) {
      dk(['comment', id, '-m', seed.comment]);
    }
  }
}

const persona = (title: string, kind: string, color: string, extra: string[] = [], role = 'custom'): string =>
  ['---', `title: ${title}`, ...(kind === 'agent' ? [] : [`kind: ${kind}`]), `role: ${role}`, 'worker: opencode', 'models:', '  default: qwen3-coder', '  pool: [qwen3-coder]', `color: '${color}'`, ...extra, '---', `Who ${title} is.`, ''].join('\n');

/** The meta vault on the persona board: the pipeline, the repository, the crew's order and records, the ledger. */
export function seedVaultOf(now: Date): Record<string, string> {
  const settled = (ticket: string, who: string, cost: number): string =>
    JSON.stringify({ v: 1, ts: now.toISOString(), event: 'run_settled', ticket, persona: who, model: 'qwen3-coder', tokensIn: 40_000, tokensOut: 3_000, cost });
  return {
    'tickets/_meta/pipeline.md': ['---', 'phases:', '  - { id: inbox, title: Inbox, handover: manual }', '  - { id: prioritized, title: Prioritized, handover: manual }', '  - { id: done, title: Done, handover: none }', 'flow: paul:shape; paul; ben; ralf; tessa; you', '---', 'The lifecycle columns.', ''].join('\n'),
    'tickets/_meta/repos.md': ['---', 'repos:', '  drey:', '    url: https://example.invalid/drey.git', '    branch: main', '---', ''].join('\n'),
    'tickets/_meta/crew.md': ['---', 'order: [pia, paul, ben, ralf, tessa, you]', '---', ''].join('\n'),
    'tickets/_meta/personas/pia/persona.md': persona('Pia', 'mission', '#f2d3e2'),
    'tickets/_meta/personas/paul/persona.md': persona('Paul', 'agent', '#f2d3e2', ['parallel: 1'], 'planner'),
    'tickets/_meta/personas/ben/persona.md': persona('Ben', 'agent', '#8ecbef', ['parallel: 2', 'leaving: [sync-main]'], 'builder'),
    'tickets/_meta/personas/ralf/persona.md': persona('Ralf', 'agent', '#bfe3cd', ['parallel: 1'], 'reviewer'),
    'tickets/_meta/personas/tessa/persona.md': persona('Tessa', 'agent', '#f2cfae', ['parallel: 1'], 'tester'),
    'tickets/_meta/personas/you/persona.md': persona('You', 'human', '#e0bb6e', ['leaving: [commit]']),
    'tickets/_meta/ledger.jsonl': [...SEEDS.flatMap((seed, index) => (seed.cost === undefined ? [] : [settled(idOf(index), 'ben', seed.cost)])), ''].join('\n'),
  };
}

/** A live run as the fleet reports it. */
export function liveRun(ticket: string, who: string, minutes: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const at = new Date(Date.now() - minutes * 60_000).toISOString();
  return { id: `r-${ticket}`, ticketId: ticket, persona: who, provider: 'opencode', model: 'qwen3-coder', state: 'running', pid: 4242, startedAt: at, endedAt: null, sessionRef: 'ses', tokensIn: 0, tokensOut: 0, costUsd: null, lastActivity: at, ...extra };
}

/** The fleet's live half of boards 7e v2 / 10c v2: four live runs, a persona wait, the queue's head. */
export function demoFleetRuns(): Record<string, unknown>[] {
  return [
    liveRun(byTitle('Weekly security audit run'), 'paul', 6),
    liveRun(byTitle('Export the vault as a zip'), 'ben', 3),
    liveRun(byTitle('Palette: recent commands'), 'ben', 11, { activity: 'merging main' }),
    liveRun(byTitle('PDF export keeps callout colors'), 'tessa', 4),
  ];
}

export function demoChainWaits(now: Date): Record<string, unknown> {
  return {
    personaWaits: { [byTitle('Win+H dictation hand-off')]: 'ben' },
    queue: [{ ticket: byTitle('Settings search across plugins'), persona: 'ralf', class: 'B', reason: 'capacity', line: 'waits for a B slot', detail: '', position: 1, since: now.toISOString() }],
  };
}
