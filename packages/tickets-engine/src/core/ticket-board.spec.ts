import { describe, expect, it } from 'vitest';
import {
  assembleBoard,
  derivedOrder,
  orderColumn,
  parsePipeline,
  parseRepos,
  reposFileText,
} from './ticket-board';

const PIPELINE = `---
phases:
  - { id: inbox, title: Inbox, handover: manual }
  - { id: prioritized, title: Prioritized, handover: manual }
  - { id: build, title: Build, wip: 2, claim: true, handover: agent build-default }
  - { id: done, title: Done, handover: none }
---
Prose.
`;

describe('parsePipeline', () => {
  it('reads the columns — id, title, color — and ignores keys it does not know', () => {
    const { phases, error } = parsePipeline(PIPELINE);
    expect(error).toBeNull();
    expect(phases.map((p) => p.id)).toEqual(['inbox', 'prioritized', 'build', 'done']);
    expect(phases[0]!.title).toBe('Inbox');
  });

  it('reads the optional push: remote (T-0041)', () => {
    const withPush = PIPELINE.replace(/^---/, "---\npush: origin");
    const parsed = parsePipeline(withPush);
    expect(parsed.pushRemote).toBe('origin');
    expect(parsed.issues).toEqual([]);
    expect(parsePipeline(PIPELINE).pushRemote).toBeNull();
  });

  it('a non-string push: degrades to null with a noise finding', () => {
    const parsed = parsePipeline(PIPELINE.replace(/^---/, '---\npush: [upstream, 42]'));
    expect(parsed.pushRemote).toBeNull();
    expect(parsed.issues).toHaveLength(1);
    expect(parsed.issues[0]!.level).toBe('noise');
    expect(parsed.issues[0]!.message).toContain('push');
  });

  it('refuses empty lists, duplicate ids and bad id grammar', () => {
    expect(parsePipeline('---\nphases: []\n---\n').error).toContain('non-empty');
    const dup = '---\nphases:\n  - { id: inbox }\n  - { id: inbox }\n---\n';
    expect(parsePipeline(dup).error).toContain('duplicate');
    const bad = '---\nphases:\n  - { id: "1bad" }\n---\n';
    expect(parsePipeline(bad).error).toContain('phase id');
  });

  it('refuses broken YAML and missing fences', () => {
    expect(parsePipeline('no fence').error).toContain('fence');
    expect(parsePipeline('---\nphases: [\n---\n').error).toContain('parse');
  });

  it('reads an explicit color: hex (T-0084); absence means the default palette', () => {
    const colored = PIPELINE.replace('id: build,', 'id: build, color: "#c96442",');
    const parsed = parsePipeline(colored);
    expect(parsed.error).toBeNull();
    expect(parsed.phases.find((p) => p.id === 'build')!.color).toBe('#c96442');
    expect(parsePipeline(PIPELINE).phases.every((p) => p.color === null)).toBe(true);
  });

  it('a present-but-invalid color degrades to null with a noise finding, never an error', () => {
    const parsed = parsePipeline(PIPELINE.replace('id: build,', 'id: build, color: orange,'));
    expect(parsed.error).toBeNull();
    expect(parsed.phases.find((p) => p.id === 'build')!.color).toBeNull();
    const noise = parsed.issues.filter((issue) => issue.message.includes('color'));
    expect(noise).toHaveLength(1);
    expect(noise[0]!.level).toBe('noise');
    expect(noise[0]!.message).toBe("pipeline.md: build's color must be #rrggbb — ignored");
  });
});

describe('parseRepos', () => {
  it('reads the mapping with optional branch, policy and local path', () => {
    const text = [
      '---',
      'repos:',
      '  drey:',
      '    url: https://github.com/x/Drey.git',
      '    branch: main',
      '    path: E:/projects/Drey-m83',
      '  local:',
      '    url: E:/code/local',
      '---',
    ].join('\n');
    const { repos, error } = parseRepos(text);
    expect(error).toBeNull();
    expect(repos).toHaveLength(2);
    expect(repos[0]).toMatchObject({
      name: 'drey',
      url: 'https://github.com/x/Drey.git',
      branch: 'main',
      policy: null,
      path: 'E:/projects/Drey-m83',
    });
    expect(repos[1]).toMatchObject({ name: 'local', url: 'E:/code/local', branch: null, path: null });
  });

  it('requires a url per repo and a repos mapping', () => {
    const noUrl = '---\nrepos:\n  x:\n    branch: main\n---\n';
    expect(parseRepos(noUrl).error).toContain('needs a url');
    expect(parseRepos('---\nrepos: 3\n---\n').error).toContain('mapping');
    expect(parseRepos(null).repos).toEqual([]);
  });

  it('reads link: as one folder or a list, and refuses a path that leaves the repo (req-56)', () => {
    const repo = (link: string): string => `---\nrepos:\n  drey:\n    url: x\n    link: ${link}\n---\n`;
    expect(parseRepos(repo('[.tools, node_modules/]')).repos[0]?.link).toEqual(['.tools', 'node_modules']);
    expect(parseRepos(repo('node_modules')).repos[0]?.link).toEqual(['node_modules']);
    expect(parseRepos('---\nrepos:\n  drey:\n    url: x\n---\n').repos[0]?.link).toBeUndefined();
    expect(parseRepos(repo('../outside')).error).toContain('must be a path inside the repo');
    expect(parseRepos(repo('C:/abs')).error).toContain('must be a path inside the repo');
    expect(parseRepos(repo('3')).error).toContain('folder name or a list');
  });

  it('reads launch: as the worktree start command; anything else warns and reads null (req-75 W3)', () => {
    const withLaunch = '---\nrepos:\n  drey:\n    url: x\n    launch: npm run dev\n---\n';
    expect(parseRepos(withLaunch).repos[0]).toMatchObject({ launch: 'npm run dev' });
    expect(parseRepos('---\nrepos:\n  drey:\n    url: x\n---\n').repos[0]?.launch).toBeNull();
    const bad = parseRepos('---\nrepos:\n  drey:\n    url: x\n    launch: [a, b]\n---\n');
    expect(bad.repos[0]?.launch).toBeNull();
    expect(bad.warnings).toEqual(['repos.md: repo "drey" launch must be a command string']);
  });

  it('reads instructions: as a repo-relative file; anything else warns and reads null (req-79)', () => {
    const entry = (value: string): string => `---\nrepos:\n  drey:\n    url: x\n    instructions: ${value}\n---\n`;
    expect(parseRepos(entry('docs\\agents\\fleet-worker.md')).repos[0]?.instructions).toBe('docs/agents/fleet-worker.md');
    expect(parseRepos('---\nrepos:\n  drey:\n    url: x\n---\n').repos[0]?.instructions).toBeNull();
    for (const bad of ['../outside.md', 'C:/abs.md', '[a, b]']) {
      const parsed = parseRepos(entry(bad));
      expect(parsed.error).toBeNull();
      expect(parsed.repos[0]?.instructions).toBeNull();
      expect(parsed.warnings).toEqual(['repos.md: repo "drey" instructions must be a file path inside the repo']);
    }
  });
});

describe('ordering', () => {
  const ticket = (
    id: string,
    priority: 'urgent' | 'high' | 'normal' | 'low',
    rank: number,
    entered: string,
  ) => ({
    id,
    priority,
    rank,
    entered,
    key: { id, priority, rank, entered },
  });

  it('derives: priority, then rank, then entered, then id', () => {
    const tickets = [
      ticket('T-0003', 'normal', 5000, '2026-10-17T10:00:00Z'),
      ticket('T-0001', 'urgent', 9000, '2026-10-17T12:00:00Z'),
      ticket('T-0002', 'urgent', 1000, '2026-10-17T11:00:00Z'),
      ticket('T-0004', 'normal', 5000, '2026-10-16T09:00:00Z'),
      ticket('T-0005', 'normal', 5000, ''),
    ];
    const ordered = orderColumn(tickets, (t) => t.key);
    expect(ordered.map((t) => t.id)).toEqual(['T-0002', 'T-0001', 'T-0004', 'T-0003', 'T-0005']);
  });

});

describe('assembleBoard', () => {
  const ticketText = (id: string, title: string, extra = ''): string =>
    [
      '---',
      `id: ${id}`,
      `title: "${title}"`,
      'repo: drey',
      'priority: normal',
      'rank: 5000',
      `branch: t/${id}`,
      `entered-inbox: '2026-10-17T09:00:00Z'`,
      extra,
      '---',
      '',
      '## Description',
      '',
      title,
      '',
      '## Log',
      '',
      `- '2026-10-17T09:00:00Z' owner@desk ??? created in inbox`,
      '',
    ].join('\n');

  const baseInput = (files: { path: string; text: string }[]) => ({
    vaultId: 'v1',
    vaultName: 'tickets',
    activeVaultName: 'tickets',
    isGitRepo: true,
    defaultWorker: 'opencode',
    pipelineText: PIPELINE,
    reposText: '---\nrepos:\n  drey:\n    url: https://example/drey.git\n---\n',
    files,
  });

  it('builds configured columns in pipeline order with tickets placed', () => {
    const snap = assembleBoard(baseInput([
      { path: 'tickets/inbox/T-0002.md', text: ticketText('T-0002', 'Second') },
      { path: 'tickets/build/T-0001.md', text: ticketText('T-0001', 'First') },
    ]));
    expect(snap.columns.map((c) => c.phase.id)).toEqual(['inbox', 'prioritized', 'build', 'done']);
    expect(snap.columns[0]!.tickets.map((t) => t.id)).toEqual(['T-0002']);
    expect(snap.columns[2]!.tickets.map((t) => t.id)).toEqual(['T-0001']);
    expect(snap.issues).toEqual([]);
  });

  it('folds numbered phase directories into the stripped phase columns (T-0041)', () => {
    const snap = assembleBoard(baseInput([
      { path: 'tickets/10-inbox/T-0002.md', text: ticketText('T-0002', 'Second') },
      { path: 'tickets/35-qa/T-0001.md', text: ticketText('T-0001', 'Gap column') },
      { path: 'tickets/inbox/T-0003.md', text: ticketText('T-0003', 'Unprefixed') },
    ]));
    // Configured columns first (pipeline order), numbered and unprefixed
    // inbox files folded into ONE inbox column.
    expect(snap.columns.slice(0, 4).map((c) => c.phase.id)).toEqual(['inbox', 'prioritized', 'build', 'done']);
    expect(snap.columns[0]!.tickets.map((t) => t.id)).toEqual(['T-0002', 'T-0003']);
    // 35-qa is not a pipeline phase here: it lands in the trailing unknown
    // column under its STRIPPED id (reader-forgiving, never renumbered).
    const unknown = snap.columns[snap.columns.length - 1]!;
    expect(unknown.unknown).toBe(true);
    expect(unknown.phase.id).toBe('qa');
    // The card keeps its real on-disk path.
    expect(snap.columns[0]!.tickets[0]!.path).toBe('tickets/10-inbox/T-0002.md');
  });

  it('threads the pipeline push: remote into the snapshot (T-0041)', () => {
    const withPush = PIPELINE.replace(/^---/, '---\npush: origin');
    const snap = assembleBoard({ ...baseInput([]), pipelineText: withPush });
    expect(snap.pushRemote).toBe('origin');
    expect(assembleBoard(baseInput([])).pushRemote).toBeNull();
  });

  it('carries an unknown phase directory as a trailing unknown column', () => {
    const snap = assembleBoard(baseInput([
      { path: 'tickets/inbox/T-0002.md', text: ticketText('T-0002', 'Second') },
      { path: 'tickets/limbo/T-0001.md', text: ticketText('T-0001', 'Lost phase') },
    ]));
    const last = snap.columns[snap.columns.length - 1]!;
    expect(last.unknown).toBe(true);
    expect(last.phase.id).toBe('limbo');
    expect(snap.issues.some((i) => i.message.includes('limbo'))).toBe(true);
  });

  it('flags duplicate ids across phases and stray files', () => {
    const snap = assembleBoard(baseInput([
      { path: 'tickets/inbox/T-0001.md', text: ticketText('T-0001', 'One') },
      { path: 'tickets/build/T-0001.md', text: ticketText('T-0001', 'Twin') },
      { path: 'tickets/inbox/readme.md', text: 'note' },
    ]));
    const twin = snap.columns.flatMap((c) => c.tickets).filter((t) => t.id === 'T-0001');
    expect(twin).toHaveLength(2);
    expect(twin.every((t) => t.issues.some((i) => i.message.includes('more than one phase')))).toBe(true);
    expect(snap.issues.some((i) => i.message.includes('unexpected file'))).toBe(true);
  });

  it('never badges _meta files as strays, even when fed unfiltered', () => {
    const base = baseInput([{ path: 'tickets/inbox/T-0001.md', text: ticketText('T-0001', 'One') }]);
    const snap = assembleBoard({
      ...base,
      defaultWorker: 'opencode',
      files: [
        ...base.files,
        { path: 'tickets/_meta/pipeline.md', text: 'x' },
        { path: 'tickets/_meta/T-0099.md', text: ticketText('T-0099', 'Hidden') },
      ],
    });
    expect(snap.issues.filter((i) => i.message.includes('unexpected file'))).toEqual([]);
    expect(snap.columns.flatMap((c) => c.tickets).some((t) => t.id === 'T-0099')).toBe(false);
  });

  it('excludes tickets/archive/ entirely — no column, no badge, no count (T-0041)', () => {
    const snap = assembleBoard(baseInput([
      { path: 'tickets/inbox/T-0001.md', text: ticketText('T-0001', 'One') },
      { path: 'tickets/archive/T-0002.md', text: ticketText('T-0002', 'Gone but kept') },
    ]));
    expect(snap.columns.flatMap((c) => c.tickets).some((t) => t.id === 'T-0002')).toBe(false);
    expect(snap.issues.some((i) => i.message.includes('T-0002'))).toBe(false);
    expect(snap.issues.some((i) => i.message.includes('archive'))).toBe(false);
    // A pipeline phase named "archive" is not fed from the reserved folder.
    expect(snap.columns.some((c) => c.phase.id === 'archive')).toBe(false);
  });

  it('warns when a ticket names an unknown repo', () => {
    const text = ticketText('T-0003', 'Elsewhere').replace('repo: drey', 'repo: nowhere');
    const snap = assembleBoard(baseInput([{ path: 'tickets/inbox/T-0003.md', text }]));
    expect(snap.columns[0]!.tickets[0]!.issues.some((i) => i.message.includes('nowhere'))).toBe(true);
  });

  it('renders the no-vault snapshot when the pipeline is missing', () => {
    const snap = assembleBoard({ ...baseInput([]), vaultId: null, vaultName: null, pipelineText: null });
    expect(snap.vaultId).toBeNull();
    expect(snap.pipelineError).toContain('missing');
    expect(snap.columns).toEqual([]);
  });

  it('attaches the settled-run usage to the matching cards (costtracking, concept §4.3)', () => {
    const snap = assembleBoard({
      ...baseInput([
        { path: 'tickets/build/T-0001.md', text: ticketText('T-0001', 'Costly') },
        { path: 'tickets/inbox/T-0002.md', text: ticketText('T-0002', 'Untracked') },
      ]),
      ticketUsage: {
        'T-0001': { tokensIn: 98_000, tokensOut: 8_500, cost: 1.283, runs: 2 },
      },
    });
    const costly = snap.columns[2]!.tickets[0]!;
    expect(costly.usage).toEqual({ tokensIn: 98_000, tokensOut: 8_500, cost: 1.283, runs: 2 });
    const untracked = snap.columns[0]!.tickets[0]!;
    expect(untracked.usage).toBeUndefined();
  });
});


describe('repos.md writer (req-72)', () => {
  it('round-trips through the parser, optional keys omitted when unset', () => {
    const repos = [
      {
        name: 'drey',
        url: 'https://example.invalid/drey.git',
        branch: 'main',
        policy: null,
        path: 'E:/code/drey',
        worker: null,
        worktrees: null,
        launch: 'npm run dev',
        instructions: 'docs/agents/fleet-worker.md',
        link: ['.tools', 'node_modules'],
      },
      { name: 'bare', url: 'https://example.invalid/bare.git', branch: null, policy: null, path: null, worker: null, worktrees: null, launch: null, instructions: null },
    ];
    const text = reposFileText(repos, 'Owner prose.\n');
    expect(text).toContain('Owner prose.');
    expect(text).toContain('launch: npm run dev');
    expect(text).not.toContain('launch: null');
    expect(text).toContain('instructions: docs/agents/fleet-worker.md');
    expect(text).not.toContain('instructions: null');
    const { repos: parsed, error } = parseRepos(text);
    expect(error).toBeNull();
    expect(parsed).toEqual(repos);
  });
});

describe('parsePipeline priorities (M111)', () => {
  it('absent priorities: ride the default vocabulary silently', () => {
    const parsed = parsePipeline(PIPELINE);
    expect(parsed.priorities.order).toEqual(['urgent', 'high', 'normal', 'low']);
    expect(parsed.priorities.default).toBe('normal');
  });

  it('a configured list rides in weight order with noise findings surfaced', () => {
    const text = PIPELINE.replace(/^---/, '---\npriorities: [critical, high, medium, low]');
    const parsed = parsePipeline(text);
    expect(parsed.priorities.order).toEqual(['critical', 'high', 'medium', 'low']);
    expect(parsed.priorities.default).toBe('medium');
    expect(parsed.issues).toEqual([]);
  });

  it('an unreadable list degrades to the default vocabulary with a noise finding', () => {
    const parsed = parsePipeline(PIPELINE.replace(/^---/, '---\npriorities: urgent'));
    expect(parsed.priorities).toEqual({
      order: ['urgent', 'high', 'normal', 'low'],
      default: 'normal',
    });
    expect(parsed.issues).toEqual([
      { level: 'noise', message: 'priorities must be a list of ids — the default vocabulary applies' },
    ]);
  });
});

describe('derivedOrder with a configured vocabulary (M111)', () => {
  const CONFIG = {
    order: ['critical', 'high', 'medium', 'low'],
    default: 'medium',
  };

  const key = (id: string, priority: string, rank = 0) => ({ id, priority, rank, entered: '' });

  it('sorts by the configured index, not the word list', () => {
    const order = derivedOrder([key('a', 'low'), key('b', 'critical'), key('c', 'high')], CONFIG);
    expect(order.map((k) => k.id)).toEqual(['b', 'c', 'a']);
  });

  it('an id outside the vocabulary sorts after every configured one', () => {
    const order = derivedOrder([key('a', 'urgent'), key('b', 'low'), key('c', 'high')], CONFIG);
    expect(order.map((k) => k.id)).toEqual(['c', 'b', 'a']);
  });
});

describe('assembleBoard column order with a configured vocabulary (M111 regression, M112)', () => {
  const VOCAB_PIPELINE = `---
priorities: [critical, high, medium, low]
phases:
  - { id: inbox, title: Inbox, handover: manual }
  - { id: done, title: Done, handover: none }
---
`;

  const ticket = (id: string, priority: string): { path: string; text: string } => ({
    path: `tickets/10-inbox/${id}.md`,
    text: `---\nid: ${id}\ntitle: "One"\npriority: ${priority}\n---\n`,
  });

  it('the columns sort by the configured weight — critical before low, though critical is foreign to the default list', () => {
    const snap = assembleBoard({
      vaultId: 'v',
      vaultName: 'V',
      activeVaultName: null,
      isGitRepo: false,
      pipelineText: VOCAB_PIPELINE,
      reposText: null,
      files: [ticket('T-0002', 'low'), ticket('T-0001', 'critical')],
      defaultWorker: 'x',
    });
    const inbox = snap.columns.find((column) => column.phase.id === 'inbox')!;
    expect(inbox.tickets.map((card) => card.id)).toEqual(['T-0001', 'T-0002']);
    expect(snap.priorities.order).toEqual(['critical', 'high', 'medium', 'low']);
  });
});
