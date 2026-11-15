import { describe, expect, it } from 'vitest';
import type { RunInfo } from '../../../../packages/tickets-engine/src/fleet/protocol';
import {
  type BoardColumn,
  type BoardSnapshot,
  type PipelinePhase,
  type TicketCard,
  type TicketPriority,
} from '../../shared/tickets';
import type { TicketHold } from '../../../../packages/tickets-engine/src/contracts/persona-board';
import type { NeedItem } from '../../shared/remote-protocol';
import {
  ageWords,
  checkpointActionOf,
  needKindLabel,
  rowStatusOf,
  runningStepOf,
  crewLineOf,
  statusLineOf,
  workGroups,
  workListSignature,
} from './work-groups';

/**
 * req-271, board 7a v2: the Work panel's groups over the persona board —
 * Inbox and Prioritized are the ideas (Prioritized the queued ones), every
 * held ticket runs (the lanes draw its holder), and Needs you collects the
 * remote's needs plus every ticket that stands at You. The Done-this-week
 * group is the snapshot's recentDone, not built here.
 */

const phase = (id: string): PipelinePhase => ({ id, title: id[0]!.toUpperCase() + id.slice(1), color: null });

const PIPELINE: readonly PipelinePhase[] = [phase('inbox'), phase('prioritized'), phase('done')];

/** An active card's hold: `holder` at `position` of a chain of `length`. */
const hold = (holder: string, position: number, length = 3): TicketHold => ({
  holder,
  why: holder === 'you' ? 'question' : 'entry',
  position,
  length,
  chain: Array.from({ length }, (_, i) => (i === position - 1 ? holder : i === length - 1 ? 'you' : 'ben')),
  mode: null,
  named: null,
  claimed: false,
  sentBack: null,
  questions: 0,
});

const card = (
  id: string,
  at: string,
  opts: {
    priority?: TicketPriority;
    created?: string;
    blocked?: readonly string[];
    blocks?: readonly string[];
    hold?: TicketHold;
  } = {},
): TicketCard =>
  ({
    id,
    path: `tickets/${at}/${id}.md`,
    phase: at,
    meta: {
      title: `Ticket ${id}`,
      priority: opts.priority ?? 'normal',
      parkedReason: null,
      interactive: false,
      entered: { inbox: opts.created ?? '2026-10-30T10:00:00Z' },
    },
    blocked: opts.blocked ?? [],
    blocks: opts.blocks ?? [],
    issues: [],
    ...(opts.hold === undefined ? {} : { hold: opts.hold }),
  }) as unknown as TicketCard;

/** A persona board: the lifecycle columns plus the `active` stage column holding the chain tickets. */
const board = (placed: { inbox?: readonly TicketCard[]; prioritized?: readonly TicketCard[]; done?: readonly TicketCard[]; active?: readonly TicketCard[] }): BoardSnapshot =>
  ({
    pipeline: PIPELINE,
    columns: [
      { phase: PIPELINE[0]!, unknown: false, tickets: placed.inbox ?? [] },
      { phase: PIPELINE[1]!, unknown: false, tickets: placed.prioritized ?? [] },
      { phase: PIPELINE[2]!, unknown: false, tickets: placed.done ?? [] },
      ...(placed.active === undefined ? [] : [{ phase: phase('active'), unknown: true, tickets: placed.active } as BoardColumn]),
    ],
    checkpoints: [],
    recentDone: [],
  }) as unknown as BoardSnapshot;

const run = (patch: Partial<RunInfo>): RunInfo =>
  ({
    id: 'r1',
    ticketId: 'T-0001',
    provider: 'opencode',
    state: 'running',
    startedAt: '2026-10-30T10:00:00Z',
    endedAt: null,
    gateFailure: null,
    ...patch,
  }) as RunInfo;

const ids = (rows: readonly { card: TicketCard }[]): string[] => rows.map((r) => r.card.id);

/** A configured four-id vocabulary (M111) layered over a board — p0/p1 jump, p2 reads as default. */
const configured = (base: BoardSnapshot): BoardSnapshot =>
  ({
    ...base,
    priorities: { order: ['p0', 'p1', 'p2', 'p3'], default: 'p2' },
  }) as unknown as BoardSnapshot;

describe('workGroups', () => {
  it('places every open ticket in exactly one group: at You in Needs you, other holds in Running, the edges in Ideas', () => {
    const snap = board({
      inbox: [card('T-0001', 'inbox')],
      prioritized: [card('T-0002', 'prioritized')],
      done: [card('T-0003', 'done')],
      active: [card('T-0004', 'active', { hold: hold('you', 2) }), card('T-0005', 'active', { hold: hold('ben', 1) })],
    });
    const groups = workGroups(snap, []);
    expect(ids(groups.needs)).toEqual(['T-0004']);
    expect(ids(groups.running)).toEqual(['T-0005']);
    expect(ids(groups.ideas)).toEqual(['T-0002', 'T-0001']);
    expect(groups.ideas.filter((row) => row.queued).map((row) => row.card.id)).toEqual(['T-0002']);
  });

  it('a waiting run puts its ticket into Needs you; a working one stays in Running with its run', () => {
    const snap = board({ active: [card('T-0001', 'active', { hold: hold('ben', 1) }), card('T-0002', 'active', { hold: hold('ben', 1) })] });
    const groups = workGroups(snap, [
      run({ id: 'a', ticketId: 'T-0001', waiting: { kind: 'question', text: 'Which file?', since: '2026-10-30T10:05:00Z' } }),
      run({ id: 'b', ticketId: 'T-0002', activity: 'Working' }),
    ]);
    expect(ids(groups.needs)).toEqual(['T-0001']);
    expect(ids(groups.running)).toEqual(['T-0002']);
    expect(groups.running[0]!.run?.id).toBe('b');
  });

  it('orders ideas by priority, newest first within a priority', () => {
    const snap = board({
      inbox: [
        card('T-0001', 'inbox', { priority: 'low', created: '2026-10-31T09:00:00Z' }),
        card('T-0002', 'inbox', { priority: 'urgent' }),
        card('T-0003', 'inbox', { priority: 'normal', created: '2026-10-29T09:00:00Z' }),
        card('T-0004', 'inbox', { priority: 'normal', created: '2026-10-28T09:00:00Z' }),
      ],
    });
    expect(ids(workGroups(snap, []).ideas)).toEqual(['T-0002', 'T-0003', 'T-0004', 'T-0001']);
  });

  it('orders by the vault\'s configured vocabulary, not the default words (M111)', () => {
    const snap = configured(
      board({
        inbox: [card('T-0001', 'inbox', { priority: 'p1' }), card('T-0002', 'inbox', { priority: 'p0' }), card('T-0003', 'inbox', { priority: 'p3' })],
      }),
    );
    expect(ids(workGroups(snap, []).ideas)).toEqual(['T-0002', 'T-0001', 'T-0003']);
  });

  it('Running: live runs on top, then the queue — a live run hides the dependency, the queue orders by it', () => {
    const snap = board({
      active: [
        card('T-0001', 'active', { hold: hold('ben', 1), priority: 'urgent', blocked: ['T-0002'] }),
        card('T-0002', 'active', { hold: hold('ben', 1), priority: 'low', blocks: ['T-0001'] }),
        card('T-0003', 'active', { hold: hold('ben', 1), priority: 'normal' }),
      ],
    });
    expect(ids(workGroups(snap, []).running)).toEqual(['T-0002', 'T-0001', 'T-0003']);
    // The urgent ticket runs: the queue behind it has no open dependency left, so priority orders it.
    const groups = workGroups(snap, [run({ ticketId: 'T-0001' })]);
    expect(ids(groups.running)).toEqual(['T-0001', 'T-0003', 'T-0002']);
  });

  it('rows carry a phase colour: explicit, palette by position (T-0084)', () => {
    const snap = board({ inbox: [card('T-0001', 'inbox')] });
    const [row] = workGroups(snap, []).ideas;
    expect(row!.phaseColor).not.toBe('');
  });
});

describe('rowStatusOf (T-0084)', () => {
  const row = (over: Partial<Parameters<typeof rowStatusOf>[0]>): Parameters<typeof rowStatusOf>[0] =>
    ({ card: card('T-0001', 'inbox'), phase: phase('inbox'), phaseColor: '', need: null, queued: false, run: null, ...over });

  it('a need decides first: waiting, failed, review', () => {
    const need = (kind: NeedItem['kind']): NeedItem => ({ kind, ticketId: 'T-0001', title: 'T', phase: 'active', runId: null, text: '', since: null });
    expect(rowStatusOf(row({ need: need('question') }))).toBe('waiting');
    expect(rowStatusOf(row({ need: need('permission') }))).toBe('waiting');
    expect(rowStatusOf(row({ need: need('red-gate') }))).toBe('failed');
    expect(rowStatusOf(row({ need: need('checkpoint') }))).toBe('review');
  });

  it('a live run wins over a blocker; then blocked, queued, parked, idle', () => {
    expect(rowStatusOf(row({ run: run({}) }))).toBe('running');
    expect(rowStatusOf(row({ card: card('T-0001', 'inbox', { blocked: ['T-0002'] }) }))).toBe('blocked');
    expect(rowStatusOf(row({ queued: true }))).toBe('queued');
    const parked = card('T-0001', 'inbox');
    (parked.meta as { parkedReason: string | null }).parkedReason = 'waiting for input';
    expect(rowStatusOf(row({ card: parked }))).toBe('parked');
    expect(rowStatusOf(row({}))).toBe('idle');
  });
});

describe('workListSignature - what re-renders the Work list (T-0086)', () => {
  it('ignores activity, tokens and clocks - text the live paint refreshes in place', () => {
    const a = run({ id: 'r1', activity: 'Reading', tokensOut: 10 });
    const b = run({ id: 'r1', activity: 'Writing', tokensOut: 20 });
    expect(workListSignature([a], [])).toBe(workListSignature([b], []));
  });

  it('moves on state, column, waiting kind, turn, interactive and held', () => {
    const a = run({ id: 'r1', state: 'running' });
    const b = run({ id: 'r1', state: 'done' });
    expect(workListSignature([a], [])).not.toBe(workListSignature([b], []));
    const waiting = run({ id: 'r1', waiting: { kind: 'question', text: 'q', since: '2026-10-30T10:05:00Z' } });
    expect(workListSignature([a], [])).not.toBe(workListSignature([waiting], []));
  });

  it('sorts by run id, so the fleet snapshot\'s order does not matter', () => {
    const one = [run({ id: 'r1' }), run({ id: 'r2' })];
    const two = [run({ id: 'r2' }), run({ id: 'r1' })];
    expect(workListSignature(one, [])).toBe(workListSignature(two, []));
  });

  it('follows the alert keys', () => {
    expect(workListSignature([], ['a'])).not.toBe(workListSignature([], ['b']));
  });
});

describe('checkpointActionOf', () => {
  it('approves into the next column; the terminal one accepts', () => {
    const snap = board({});
    expect(checkpointActionOf(snap, 'inbox')).toEqual({ kind: 'approve', to: 'prioritized', label: 'Accept → Prioritized' });
    expect(checkpointActionOf(snap, 'done')).toEqual({ kind: 'accept', label: 'Accept' });
  });
});

describe('a decision from a comment (D-12)', () => {
  const snap = board({});
  const decision = { kind: 'needs-decision', ticketId: 'T-0001', title: 't', phase: 'active', runId: null, text: 'CSV or JSON?', since: null } as NeedItem;

  it('reads as a decision with its question, not as a review', () => {
    expect(needKindLabel(decision, snap)).toBe('Decision');
    expect(needKindLabel({ ...decision, kind: 'blocked' }, snap)).toBe('Blocked');
    const row = { need: decision, run: null } as unknown as Parameters<typeof statusLineOf>[0];
    expect(statusLineOf(row, snap)).toBe('CSV or JSON?');
  });
});

describe('needKindLabel', () => {
  const need = (kind: NeedItem['kind'], phaseId: string): NeedItem =>
    ({ kind, ticketId: 'T-0001', title: 'T', phase: phaseId, runId: null, text: '', since: null });

  it('names the run-driven kinds', () => {
    const snap = board({});
    expect(needKindLabel(need('question', 'active'), snap)).toBe('Question');
    expect(needKindLabel(need('permission', 'active'), snap)).toBe('Approval');
    expect(needKindLabel(need('red-gate', 'active'), snap)).toBe('Gate red');
    expect(needKindLabel(need('failed', 'active'), snap)).toBe('Run failed');
  });

  it('the terminal phase is ready to try; the rest review', () => {
    const snap = board({});
    expect(needKindLabel(need('checkpoint', 'done'), snap)).toBe('Ready to try');
    expect(needKindLabel(need('checkpoint', 'prioritized'), snap)).toBe('Review');
  });
});

describe('runningStepOf', () => {
  const stepOf = (id: string, snap: BoardSnapshot, runs: readonly RunInfo[] = [], queueWords: string | null = null): ReturnType<typeof runningStepOf> => {
    const row = workGroups(snap, runs).running.find((r) => r.card.id === id);
    if (row === undefined) {
      throw new Error(`${id} is not in Running`);
    }
    return runningStepOf(row, snap, queueWords);
  };

  it('names the step by the column title, with the run’s activity as the line', () => {
    const snap = board({ active: [card('T-0001', 'active', { hold: hold('ben', 1) })] });
    expect(stepOf('T-0001', snap, [run({ ticketId: 'T-0001', activity: 'Reading daily-note.ts' })])).toEqual({
      step: 'Active',
      line: 'Reading daily-note.ts',
      live: true,
    });
  });

  it('without a run it is queued — behind the first blocker by title, else a free worker', () => {
    const snap = board({
      active: [card('T-0001', 'active', { hold: hold('ben', 1), blocked: ['T-0002'] }), card('T-0003', 'active', { hold: hold('ben', 1) })],
      done: [card('T-0002', 'done')],
    });
    expect(stepOf('T-0001', snap)).toEqual({ step: 'queued', line: 'waits for “Ticket T-0002”', live: false });
    expect(stepOf('T-0003', snap)).toEqual({ step: 'queued', line: 'waits for a free worker', live: false });
    // The pool's own words replace the plain word while it holds the ticket back (req-186).
    expect(stepOf('T-0003', snap, [], 'queued · waits for a B slot · 2nd').step).toBe('queued · waits for a B slot · 2nd');
    // An unknown blocker falls back to its id.
    const orphan = board({ active: [card('T-0004', 'active', { hold: hold('ben', 1), blocked: ['T-0099'] })] });
    expect(stepOf('T-0004', orphan).line).toBe('waits for “T-0099”');
  });
});

describe('ageWords', () => {
  const NOW = Date.parse('2026-10-31T12:00:00Z');

  it('steps through now, minutes, hours, yesterday and days', () => {
    expect(ageWords(null, NOW)).toBe('');
    expect(ageWords('not a stamp', NOW)).toBe('');
    expect(ageWords('2026-10-31T11:59:30Z', NOW)).toBe('now');
    expect(ageWords('2026-10-31T11:56:00Z', NOW)).toBe('4 min');
    expect(ageWords('2026-10-31T09:00:00Z', NOW)).toBe('3 h');
    expect(ageWords('2026-10-30T09:00:00Z', NOW)).toBe('yesterday');
    expect(ageWords('2026-10-27T00:00:00Z', NOW)).toBe('4 d');
  });
});

describe('statusLineOf (Needs-you lines)', () => {
  it('says why it waits, after the kind chip', () => {
    const snap = board({
      active: [card('T-0001', 'active', { hold: hold('ben', 1) }), card('T-0004', 'active', { hold: hold('you', 2) })],
      done: [card('T-0002', 'done')],
    });
    const groups = workGroups(snap, [
      run({ ticketId: 'T-0001', waiting: { kind: 'question', text: 'Which file?', since: '2026-10-30T10:05:00Z' } }),
    ]);
    const line = (id: string): string => {
      const row = groups.needs.find((r) => r.card.id === id);
      if (row === undefined) {
        throw new Error(`${id} is not in Needs you`);
      }
      return statusLineOf(row, snap);
    };
    expect(line('T-0001')).toBe('Which file?');
  });

  it('a shaped question reads as its question (req-75 W2)', () => {
    const snap = board({ active: [card('T-0001', 'active', { hold: hold('ben', 1) })] });
    const groups = workGroups(snap, [
      run({
        ticketId: 'T-0001',
        waiting: {
          kind: 'question',
          text: 'Which database?\nTicket: the store\nOptions:\n1. SQLite — no server',
          since: '2026-10-30T10:05:00Z',
          shaped: {
            question: 'Which database?',
            context: 'the store',
            where: null,
            why: null,
            options: [{ n: 1, label: 'SQLite', consequence: 'no server' }],
            recommended: null,
            recommendationWhy: null,
          },
        },
      }),
    ]);
    expect(statusLineOf(groups.needs[0]!, snap)).toBe('Which database?');
  });
});

describe('crewLineOf', () => {
  it('names the busy personas once each', () => {
    expect(crewLineOf(['Ben', 'Tessa', 'Ben'], 3)).toBe('Crew · Ben, Tessa busy');
  });
  it('counts runs without a persona', () => {
    expect(crewLineOf([null, undefined, ''], 2)).toBe('Crew · 2 busy');
  });
  it('says idle when nothing runs', () => {
    expect(crewLineOf([], 0)).toBe('Crew · idle');
  });
});
