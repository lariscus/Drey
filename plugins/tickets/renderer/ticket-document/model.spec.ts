import { describe, expect, it } from 'vitest';
import { renderVerificationSection } from '../../../../packages/tickets-engine/src/core/chapters/verification';
import { renderVerlaufLine } from '../../../../packages/tickets-engine/src/core/chapters/history-chapter';
import type { VerificationReport } from '../../../../packages/tickets-engine/src/contracts/verify';
import {
  assetUrl,
  chainOf,
  costSummary,
  costTableOfText,
  flowItemsOf,
  offsetWords,
  pageShapeOf,
  proofOfText,
  sectionBodyRange,
  sectionRange,
  statusOf,
  workerOf,
} from './model';
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- a spec builds the real catalog; the plugin itself gets it as `api.i18n`
import { i18n } from '../../../../shared/i18n';
import { parseVerlaufEntries } from '../../../../packages/tickets-engine/src/core/chapters/history-chapter';
import type { PipelinePhase, TicketCard } from '../../shared/tickets';

const report: VerificationReport = {
  testedAt: '2026-11-04T10:00:00Z',
  tester: 'verify@box',
  environment: 'Electron 34.2.0 on win32',
  criteria: [
    { command: 'One palette after a double Ctrl+P', passed: true, screenshot: 'verify-1.png', note: null },
    { command: 'Escape closes it', passed: true, screenshot: 'verify-2.png', note: 'focus stays' },
  ],
  findings: ['The first shot was slow.'],
  video: 'verify-20261104-T-0118.webm',
  videoChapters: [
    { atMs: 12_000, label: 'One palette after a double Ctrl+P' },
    { atMs: 24_000, label: 'Escape closes it' },
  ],
};

const phase = (id: string, title: string): PipelinePhase => ({ id, title, color: null });

describe('words', () => {
  it('writes chapter offsets as m:ss', () => {
    expect(offsetWords(72_000)).toBe('1:12');
    expect(offsetWords(5_000)).toBe('0:05');
  });

  it('builds the asset URL the editor images use', () => {
    expect(assetUrl('v1', 'tickets/videos/a b.webm')).toBe('drey-asset://v1/asset/tickets/videos/a%20b.webm');
    expect(assetUrl(null, 'x.png')).toBe('drey-asset://asset/x.png');
  });
});

describe('sectionBodyRange', () => {
  const text = '# T\n\n## Verification\n\nLine A\n- [x] `c`\n\n```\n## not a heading\n```\n\n## Log\n- x\n';

  it('spans from the first body line to the last non-blank one', () => {
    const range = sectionBodyRange(text, 'Verification')!;
    expect(text.slice(range.from, range.to)).toBe('Line A\n- [x] `c`\n\n```\n## not a heading\n```');
  });

  it('is null for a missing or empty section and tolerates CRLF', () => {
    expect(sectionBodyRange('# T\n\n## Log\n- x', 'Verification')).toBeNull();
    expect(sectionBodyRange('## Verification\n\n## Log\n', 'Verification')).toBeNull();
    const crlf = '## Verification\r\nbody\r\n\r\n## Log\r\n';
    const range = sectionBodyRange(crlf, 'Verification')!;
    expect(crlf.slice(range.from, range.to)).toBe('body');
  });
});

describe('proofOfText', () => {
  it('is null without a Verification section', () => {
    expect(proofOfText(i18n, '# T\n')).toBeNull();
  });

  it('reads summary, checks with chapter times, shots, video and findings', () => {
    const proof = proofOfText(i18n, `# T\n\n${renderVerificationSection(report)}`)!;
    expect(proof.summary).toBe('2/2 green.');
    expect(proof.allPassed).toBe(true);
    expect(proof.stamp).toBe('Tested on 2026-11-04 by the verify run, Electron 34.2.0 on win32.');
    expect(proof.checks.map((c) => [c.label, c.at, c.note])).toEqual([
      ['One palette after a double Ctrl+P', '0:12', null],
      ['Escape closes it', '0:24', 'focus stays'],
    ]);
    expect(proof.shots.map((s) => s.file)).toEqual(['verify-1.png', 'verify-2.png']);
    expect(proof.shots[0]!.caption).toBe('shot 1 · One palette after a double Ctrl+P');
    expect(proof.video?.file).toBe('verify-20261104-T-0118.webm');
    expect(proof.video?.chapters).toHaveLength(2);
    expect(proof.findings).toEqual(['The first shot was slow.']);
  });

  it('counts failures and keeps the not-kept line', () => {
    const failing: VerificationReport = {
      ...report,
      criteria: [{ ...report.criteria[0]!, passed: false }, report.criteria[1]!],
      video: null,
      videoNotKept: 'Video not kept: 31.2 MB exceeds the 25 MB limit.',
      videoChapters: [],
    };
    const proof = proofOfText(i18n, renderVerificationSection(failing))!;
    expect(proof.summary).toBe('1/2 green, 1 failing.');
    expect(proof.allPassed).toBe(false);
    expect(proof.video).toEqual({ file: null, notKept: 'Video not kept: 31.2 MB exceeds the 25 MB limit.', chapters: [] });
  });
});

describe('cost table', () => {
  const lines = [
    renderVerlaufLine({ phase: 'plan', persona: 'paul', model: 'sonnet', tokens: '21k', cost: 0.31, dauer: '4m', ausgang: 'handed-over' }),
    renderVerlaufLine({ phase: 'build', persona: 'ben', model: 'sonnet', tokens: '88k', cost: 0.94, dauer: '14m', ausgang: 'handed-over' }),
    renderVerlaufLine({ phase: 'review', persona: 'ralf', model: 'sonnet', tokens: '30k', cost: null, dauer: '', ausgang: 'failed' }),
  ];
  const text = `# T\n\n## Verlauf\n\n${lines.join('\n')}\n`;

  it('has one row per run and never counts an unknown cost as zero', () => {
    const table = costTableOfText(i18n, text, (id) => id.toUpperCase())!;
    expect(table.rows.map((r) => [r.phase, r.model, r.tokens, r.time, r.cost])).toEqual([
      ['PLAN', 'Paul · sonnet', '21k', '4 min', '$0.31'],
      ['BUILD', 'Ben · sonnet', '88k', '14 min', '$0.94'],
      ['REVIEW', 'Ralf · sonnet', '30k', '', '—'],
    ]);
    expect(table.rows[2]!.bad).toBe(true);
    expect(table.total).toEqual({ tokens: '139k', time: '18 min', cost: '$1.25' });
  });

  it('adds a quiet row for each phase of the chain without a run', () => {
    const table = costTableOfText(i18n, text, (id) => id.toUpperCase(), [
      { id: 'build', title: 'Build' },
      { id: 'test', title: 'Test' },
      { id: 'commit', title: 'Accept', checkpoint: true },
    ])!;
    expect(table.rows.map((r) => [r.phase, r.pending])).toEqual([
      ['PLAN', false],
      ['BUILD', false],
      ['REVIEW', false],
      ['Test', true],
    ]);
  });

  it('is null for a ticket that has not run, and summarises so far / in total with what it is', () => {
    expect(costTableOfText(i18n, '# T\n', (id) => id)).toBeNull();
    const entries = parseVerlaufEntries(text);
    expect(costSummary(i18n, entries, true).label).toBe('$1.25 in total');
    expect(costSummary(i18n, entries, false).label).toBe('$1.25 so far');
    expect(costSummary(i18n, [], true).label).toBeNull();
  });
});

describe('chainOf', () => {
  const pipeline = [
    phase('ideas', 'Ideas'),
    phase('plan', 'Plan'),
    phase('build', 'Build'),
    phase('review', 'Review'),
    phase('commit', 'Commit'),
    phase('done', 'Done'),
  ];
  const entry = (persona: string, extra: Record<string, unknown> = {}) => ({ persona, mode: null, notify: false, ...extra });
  const card = (meta: Record<string, unknown>): TicketCard =>
    ({ id: 'T-1', meta: { chain: [], persona: null, ...meta } }) as unknown as TicketCard;
  const personas = [{ id: 'ben', title: 'Ben' }];
  const flow = [entry('paul'), entry('ben'), entry('ralf'), entry('you')];

  it('shows the persona list around the cursor, with who does each', () => {
    const chain = chainOf({ pipeline, currentPhaseId: 'build', card: card({ at: 2 }), personas, flow });
    expect(chain.map((s) => [s.title, s.state, s.who])).toEqual([
      ['Paul', 'past', 'Paul'],
      ['Ben', 'current', 'Ben'],
      ['Ralf', 'future', 'Ralf'],
      ['You', 'future', 'you'],
    ]);
    expect(chain[1]!.personaId).toBe('ben');
    expect(chain[3]!.personaId).toBeNull();
  });

  it('falls back to the pipeline\'s inner columns without a chain of its own and without a standard flow — the owner\'s checkpoints', () => {
    const chain = chainOf({ pipeline, currentPhaseId: 'build', card: card({}), personas });
    expect(chain.map((s) => [s.title, s.state, s.who])).toEqual([
      ['Plan', 'past', 'you'],
      ['Build', 'current', 'you'],
      ['Review', 'future', 'you'],
      ['Commit', 'future', 'you'],
    ]);
  });

  it("prefers the ticket's own chain to the standard flow, and queues a ticket in the first column", () => {
    const own = [entry('paul', { mode: 'shape' }), entry('tessa', { notify: true }), entry('you')];
    const chain = chainOf({ pipeline, currentPhaseId: 'ideas', card: card({ chain: own }), personas, flow });
    expect(chain.map((s) => [s.title, s.state, s.notify])).toEqual([
      ['Paul', 'future', false],
      ['Tessa', 'future', true],
      ['You', 'future', false],
    ]);
  });
});

describe('the card of a page', () => {
  const pipeline = [
    { id: 'inbox', title: 'Inbox' },
    { id: 'prioritized', title: 'Prioritized' },
    { id: 'done', title: 'Done' },
  ] as unknown as PipelinePhase[];
  const standard = [
    { persona: 'paul', mode: null, notify: false },
    { persona: 'ben', mode: null, notify: false },
    { persona: 'you', mode: null, notify: false },
  ];
  const chain = (currentPhaseId: string, at = 1) =>
    chainOf({ pipeline, currentPhaseId, card: { meta: { chain: standard, at } } as unknown as TicketCard, personas: [] });

  it('the capture columns follow board 9a, later columns row 7', () => {
    expect(['inbox', 'prioritized', 'active', 'done', null].map((phaseId) => pageShapeOf(phaseId, pipeline))).toEqual(['early', 'early', 'flow', 'flow', 'flow']);
  });

  it('words the flow row as the boards do', () => {
    const titles = (at = 1) => flowItemsOf(i18n, chain('active', at)).map((item) => [item.title, item.state, item.note]);
    expect(titles()).toEqual([
      ['Paul', 'current', null],
      ['Ben', 'future', null],
      ['Accept', 'future', null],
    ]);
    expect(titles(3).slice(-1)).toEqual([['Accept', 'current', '(your turn)']]);
  });

  it('names the :shape entry of the chain Shape (req-266)', () => {
    const shaped = chainOf({ pipeline, currentPhaseId: 'active', card: { meta: { chain: [{ persona: 'paul', mode: 'shape', notify: false }, ...standard], at: 1 } } as unknown as TicketCard, personas: [] });
    expect(flowItemsOf(i18n, shaped).map((item) => [item.title, item.state, item.note])).toEqual([
      ['Shape', 'current', null],
      ['Paul', 'future', null],
      ['Ben', 'future', null],
      ['Accept', 'future', null],
    ]);
  });

  it('names the worker of the current step, else the last one, else the next one', () => {
    expect(workerOf(chain('active', 2))?.personaId).toBe('ben');
    expect(workerOf(chain('active', 3))?.personaId).toBe('ben');
    expect(workerOf(chain('active'))?.personaId).toBe('paul');
  });

  it('picks the pill of the phase', () => {
    const board = { pipeline } as unknown as Parameters<typeof statusOf>[2];
    expect(statusOf(i18n, null, board, 'Prioritized')).toMatchObject({ label: 'Prioritized', pill: 'accent' });
    expect(statusOf(i18n, null, board, 'Inbox')).toMatchObject({ pill: 'grey' });
  });
});

describe('sectionRange', () => {
  it('takes the heading along', () => {
    const text = 'x\n\n## Verlauf\n\n- a\n- b\n\n## Log\n\n- c\n';
    const range = sectionRange(text, 'Verlauf')!;
    expect(text.slice(range.from, range.to)).toBe('## Verlauf\n\n- a\n- b');
    expect(sectionRange(text, 'Plan')).toBeNull();
  });
});

describe('statusOf', () => {
  const board = { columns: [], pipeline: [] } as never;
  const row = (need: Record<string, unknown> | null, extra: Record<string, unknown> = {}) =>
    ({ need, run: null, card: { blocked: [] }, phase: { id: 'build' }, ...extra }) as never;

  it('says Needs you with the kind of the need beside it', () => {
    const status = statusOf(i18n, row({ kind: 'question', text: 'Which one?', phase: 'build' }), board, 'Build');
    expect(status).toMatchObject({ label: 'Needs you', tone: 'needs', kind: 'Question' });
  });

  it('says Ready to try and Plan to accept in the same caps words, with no extra kind chip', () => {
    const ready = statusOf(i18n, row({ kind: 'checkpoint', text: '', phase: 'ready' }), board, 'Ready to try');
    expect(ready).toMatchObject({ label: 'Ready to try', kind: '' });
  });

  it('names a running and a blocked ticket, and an idle one by its phase', () => {
    expect(statusOf(i18n, row(null, { run: {} }), board, 'Build').label).toBe('Running');
    expect(statusOf(i18n, row(null, { card: { blocked: ['T-0001'] } }), board, 'Build')).toMatchObject({ label: 'Blocked', pill: 'amber' });
    expect(statusOf(i18n, null, board, 'Build')).toMatchObject({ label: 'Build', tone: 'idle' });
  });
});
