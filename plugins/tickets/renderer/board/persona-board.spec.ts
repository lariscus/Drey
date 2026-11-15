// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- the spec stands in for the host, which owns the catalog at runtime
import { i18n } from '../../../../shared/i18n';
import type { BoardLane, TicketHold } from '../../../../packages/tickets-engine/src/contracts/persona-board';
import type { ChainStatus, RunInfo } from '../../../../packages/tickets-engine/src/fleet/protocol';
import type { BoardSnapshot, TicketCard } from '../../shared/tickets';
import type { DeskDeps } from './desk-deps';
import type { TeamStore } from '../team/team-store';
import { workGroups } from '../work/work-groups';
import { mountBoard } from './board-view';
import { dropOf, initialsOf, laneOrderAfterDrop, personaBoardModelOf } from './persona-board-model';

const CHAIN = ['paul', 'paul', 'ben', 'ralf', 'tessa', 'you'];
const LANES: BoardLane[] = [
  { persona: 'pia', title: 'Pia', kind: 'mission', color: '#f2d3e2', parallel: null, min: 0 },
  { persona: 'paul', title: 'Paul', kind: 'agent', color: '#f2d3e2', parallel: 1, min: 0 },
  { persona: 'ben', title: 'Ben', kind: 'agent', color: '#8ecbef', parallel: 2, min: 0 },
  { persona: 'ralf', title: 'Ralf', kind: 'agent', color: '#bfe3cd', parallel: 1, min: 0 },
  { persona: 'tessa', title: 'Tessa', kind: 'agent', color: '#f2cfae', parallel: 1, min: 0 },
  { persona: 'you', title: 'You', kind: 'human', color: '#e0bb6e', parallel: null, min: 0 },
];

function hold(patch: Partial<TicketHold>): TicketHold {
  return { holder: 'ben', why: 'entry', position: 3, length: 6, chain: CHAIN, mode: null, named: 'ben', claimed: false, sentBack: null, questions: 0, ...patch };
}

function card(id: string, phase: string, h?: Partial<TicketHold>, cost: number | null = null): TicketCard {
  return {
    id,
    path: `tickets/${phase}/${id}.md`,
    phase,
    meta: { title: `Ticket ${id}`, priority: 'normal', chain: CHAIN.map((persona) => ({ persona, mode: null, notify: false })), entered: {}, parent: null, persona: null, claimedBy: null },
    worker: 'opencode',
    blocked: [],
    blocks: [],
    issues: [],
    ...(cost === null ? {} : { usage: { tokensIn: 0, tokensOut: 0, cost, runs: 1 } }),
    ...(h === undefined ? {} : { hold: hold(h) }),
  } as unknown as TicketCard;
}

const phase = (id: string): object => ({ id, title: id, handover: 'manual', persona: null });

function snapshot(): BoardSnapshot {
  return {
    vaultId: 'v',
    columns: [
      { phase: phase('inbox'), unknown: false, tickets: [card('T-0141', 'inbox'), card('T-0140', 'inbox'), card('T-0139', 'inbox'), card('T-0138', 'inbox')] },
      { phase: phase('prioritized'), unknown: false, tickets: [card('T-0136', 'prioritized')] },
      { phase: phase('done'), unknown: false, tickets: [card('T-0115', 'done', undefined, 2.1)] },
      {
        phase: phase('active'),
        unknown: true,
        tickets: [
          card('T-0130', 'active', { sentBack: { from: 5, to: 3 }, claimed: true }, 0.74),
          card('T-0122', 'active', {}, 0.3),
          card('T-0129', 'active', { holder: 'ralf', named: 'ralf', position: 4 }, 0.9),
          card('T-0121', 'active', { holder: 'you', why: 'question', questions: 1 }, 1.2),
          card('T-0118', 'active', { holder: 'you', named: 'you', position: 6 }, 1.84),
        ],
      },
    ],
    recentDone: [{ id: 'T-0112', title: 'Spellcheck: German dictionary', at: '' }],
    checkpoints: [],
    openStatus: [],
    priorities: { order: ['urgent', 'high', 'normal', 'low'] },
    lanes: LANES,
  } as unknown as BoardSnapshot;
}

const run = (ticketId: string, persona: string, patch: Partial<RunInfo> = {}): RunInfo =>
  ({ id: `r-${ticketId}`, ticketId, persona, provider: 'opencode', state: 'running', startedAt: new Date(Date.now() - 6 * 60_000).toISOString(), lastActivity: '', ...patch }) as unknown as RunInfo;

let runs: RunInfo[];
let chain: ChainStatus | null;
let invoked: [string, unknown][];
let snap: BoardSnapshot;

function deps(): DeskDeps {
  return {
    api: { i18n, ui: { icon: () => document.createElement('i') }, documents: { active: () => ({ path: 'board://all' }), onChange: () => () => undefined } },
    snapshot: () => snap,
    runs: () => runs,
    chain: () => chain,
    invoke: async (method: string, payload?: unknown) => {
      invoked.push([method, payload]);
      return { ok: true };
    },
    subscribe: () => () => undefined,
    mutate: async (_label: string, fn: () => Promise<unknown>) => {
      await fn();
      return { ok: true };
    },
    chainAction: async () => undefined,
    openTicket: () => undefined,
    newIdea: () => undefined,
    titleOf: () => null,
  } as unknown as DeskDeps;
}

const store = { personas: () => [], nameOf: (id: string | null) => id ?? '', loaded: () => true, error: () => '', refresh: async () => undefined, subscribe: () => () => undefined } as TeamStore;

beforeEach(() => {
  runs = [run('T-0130', 'ben'), run('T-0131', 'ben')];
  chain = { master: 'run', poolSize: { opencode: 5 }, personaWaits: { 'T-0122': 'ben' }, queue: [{ ticket: 'T-0129', persona: 'ralf', class: 'B', reason: 'capacity', line: '', detail: '', position: 1, since: '' }] } as unknown as ChainStatus;
  invoked = [];
  snap = snapshot();
  document.body.replaceChildren();
});

describe('the persona board model', () => {
  it('draws Inbox, Prioritized, the crew in its order with You, and folds the empty agent and Mission Control lanes', () => {
    const model = personaBoardModelOf(snap, { runs, chain, queueWords: () => null, now: Date.now() }, false);
    expect(model.lanes.map((lane) => lane.lane.persona)).toEqual(['ben', 'ralf', 'you']);
    expect(model.folded.map((lane) => lane.persona)).toEqual(['pia', 'paul', 'tessa']);
    expect(model.inbox).toHaveLength(4);
    expect(model.done.map((c) => c.id)).toEqual(['T-0115']);
    expect(personaBoardModelOf(snap, { runs, chain, queueWords: () => null, now: Date.now() }, true).lanes).toHaveLength(6);
  });

  it("counts a persona's runs against its cap and what waits", () => {
    const model = personaBoardModelOf(snap, { runs, chain, queueWords: () => 'queued · waits for a B slot', now: Date.now() }, false);
    const ben = model.lanes.find((lane) => lane.lane.persona === 'ben')!;
    expect(ben.load).toEqual({ running: 2, cap: 2, waiting: 1, atCap: true });
    expect(model.lanes.find((lane) => lane.lane.persona === 'you')!.load).toBeNull();
  });

  it('reads initials, a crew drop and where a card goes', () => {
    expect(initialsOf('Paul')).toBe('PA');
    expect(initialsOf('Mary Ann')).toBe('MA');
    expect(laneOrderAfterDrop(['a', 'b', 'c'], 'c', 'a', false)).toEqual(['c', 'a', 'b']);
    expect(laneOrderAfterDrop(['a', 'b', 'c'], 'a', 'c', true)).toEqual(['b', 'c', 'a']);
    const held = card('T-1', 'active', {});
    const idea = card('T-2', 'inbox');
    expect(dropOf(idea, 'ben', 'done')).toEqual({ kind: 'move', payload: { kind: 'start', id: 'T-2', persona: 'ben' } });
    expect(dropOf(held, 'ralf', 'done')).toEqual({ kind: 'move', payload: { kind: 'hand', id: 'T-1', persona: 'ralf' } });
    expect(dropOf(held, 'prioritized', 'done')).toEqual({ kind: 'move', payload: { kind: 'park', id: 'T-1', stage: 'prioritized' } });
    expect(dropOf(idea, 'prioritized', 'done')).toEqual({ kind: 'transition', id: 'T-2', from: 'inbox', to: 'prioritized' });
    expect(dropOf(held, 'done', 'done')).toEqual({ kind: 'transition', id: 'T-1', from: 'active', to: 'done' });
    expect(dropOf(idea, 'inbox', 'done')).toEqual({ kind: 'none' });
  });
});

describe('the Board tab on persona columns', () => {
  const mount = (): HTMLElement => {
    const host = document.body.appendChild(document.createElement('div'));
    mountBoard(deps(), store, host);
    return host;
  };

  it('draws the columns, the fold chip, the heads with their load and the pool chip', () => {
    const host = mount();
    expect([...host.querySelectorAll('.pb-col')].map((col) => (col as HTMLElement).dataset['column'])).toEqual(['inbox', 'prioritized', 'ben', 'ralf', 'you', 'done']);
    expect(host.querySelector('.pb-fold-chip')!.textContent).toBe('+ 3 personas');
    const ben = host.querySelector('[data-column="ben"] .pb-col-head')!;
    expect(ben.querySelector('.pb-avatar')!.textContent).toBe('BE');
    expect(ben.querySelector('.pb-load')!.textContent).toBe('2/2 · 1 waiting');
    expect(ben.querySelector('.pb-load-full')).not.toBeNull();
    expect(host.querySelector('.pb-pool-chip')!.textContent).toBe('2/5 · 1 queued');
    expect(host.querySelector('[data-column="inbox"] .pb-more')!.textContent).toBe('1 more');
  });

  it('draws a card: badge, chain with the cursor and the invalidated stretch, position, cost, status', () => {
    const host = mount();
    const sent = host.querySelector('.pb-card[data-id="T-0130"]')!;
    expect(sent.querySelector('.pb-badge')!.textContent).toBe('Sent back once');
    expect([...sent.querySelectorAll('.pb-cell')].map((c) => c.className.replace('pb-cell ', ''))).toEqual(['pb-cell-done', 'pb-cell-done', 'pb-cell-now pb-cell-sent-back', 'pb-cell-again', 'pb-cell-again', 'pb-cell-next']);
    expect(sent.querySelector('.pb-card-who')!.textContent).toBe('Ben · 3 of 6');
    expect(sent.querySelector('.pb-card-cost')!.textContent).toBe('$0.74');
    expect(sent.querySelector('.pb-status-text')!.textContent).toBe('running · from Tessa');
    expect(host.querySelector('.pb-card[data-id="T-0122"] .pb-status-text')!.textContent).toBe('waits for Ben');
    expect(host.querySelector('.pb-card[data-id="T-0121"] .pb-status-text')!.textContent).toBe('Ben asks · 1 question');
    expect(host.querySelector('.pb-card[data-id="T-0121"]')!.classList.contains('pb-card-need')).toBe(true);
  });

  it("accepts and sends back at You's entry, to a picked position with a note", async () => {
    const host = mount();
    const you = host.querySelector('.pb-card[data-id="T-0118"]')!;
    expect(you.querySelector('.pb-badge')!.textContent).toBe('Accept');
    you.querySelector<HTMLButtonElement>('.pb-decide-accept')!.click();
    await Promise.resolve();
    expect(invoked).toContainEqual(['acceptTicket', { id: 'T-0118' }]);
    you.querySelector<HTMLButtonElement>('.pb-decide-back')!.click();
    const picker = document.querySelector<HTMLFormElement>('.pb-sendback')!;
    expect([...picker.querySelectorAll('.pb-sendback-row')].map((row) => row.textContent)).toEqual(['1 · Paul', '2 · Paul', '3 · Ben', '4 · Ralf', '5 · Tessa']);
    expect(picker.querySelector<HTMLInputElement>('input:checked')!.value).toBe('5');
    expect(picker.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
    picker.querySelector<HTMLInputElement>('input[value="3"]')!.checked = true;
    const note = picker.querySelector<HTMLTextAreaElement>('textarea')!;
    note.value = 'the export misses images';
    note.dispatchEvent(new Event('input'));
    picker.dispatchEvent(new Event('submit', { cancelable: true }));
    await Promise.resolve();
    expect(invoked).toContainEqual(['sendBack', { id: 'T-0118', note: 'the export misses images', position: 3 }]);
  });

  it('a card at a shaping entry offers Shaping done — the same Accept, the persona plans at that position (req-305)', async () => {
    (snap.columns[3]!.tickets as TicketCard[]).push(card('T-0127', 'active', { holder: 'paul', named: 'paul', position: 1, mode: 'shape' }));
    const host = mount();
    const shaping = host.querySelector('.pb-card[data-id="T-0127"]')!;
    expect(shaping.querySelector('.pb-status-text')!.textContent).toBe('shaping with you');
    expect(shaping.querySelector('.pb-decide-back')).toBeNull();
    shaping.querySelector<HTMLButtonElement>('.pb-shaping-done')!.click();
    await Promise.resolve();
    expect(invoked).toContainEqual(['acceptTicket', { id: 'T-0127' }]);
    expect(host.querySelector('.pb-card[data-id="T-0122"] .pb-shaping-done')).toBeNull();
  });

  it('sends a dropped card as one move: start, hand, park', async () => {
    const host = mount();
    const drop = async (id: string, column: string): Promise<void> => {
      const target = host.querySelector<HTMLElement>(`.pb-col[data-column="${column}"]`)!;
      const event = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent;
      Object.defineProperty(event, 'dataTransfer', { value: { getData: () => id, types: ['application/x-drey-ticket'] } });
      target.dispatchEvent(event);
      await new Promise((resolve) => setTimeout(resolve, 0));
    };
    await drop('T-0141', 'ben');
    await drop('T-0122', 'ralf');
    await drop('T-0129', 'prioritized');
    expect(invoked).toEqual([
      ['personaBoardMove', { kind: 'start', id: 'T-0141', persona: 'ben' }],
      ['personaBoardMove', { kind: 'hand', id: 'T-0122', persona: 'ralf' }],
      ['personaBoardMove', { kind: 'park', id: 'T-0129', stage: 'prioritized' }],
    ]);
  });

  it('opens the folded personas from the chip', async () => {
    const host = mount();
    host.querySelector<HTMLButtonElement>('.pb-fold-chip')!.click();
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    expect(host.querySelector('.pb-fold-chip')).toBeNull();
    expect(host.querySelectorAll('.pb-col-lane')).toHaveLength(6);
  });

  it('reorders the crew by a column head drop', async () => {
    const host = mount();
    const head = host.querySelector<HTMLElement>('[data-column="ben"] .pb-col-head')!;
    vi.spyOn(head, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 100 } as DOMRect);
    const event = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(event, 'dataTransfer', { value: { getData: () => 'you', types: ['application/x-drey-lane'] } });
    Object.defineProperty(event, 'clientX', { value: 10 });
    head.dispatchEvent(event);
    await Promise.resolve();
    expect(invoked).toContainEqual(['crewOrderSet', { order: ['pia', 'paul', 'you', 'ben', 'ralf', 'tessa'] }]);
  });
});

describe('the Tickets panel on a persona board', () => {
  it('groups by holder: Needs you is You, Running the rest, Prioritized and Inbox their columns', () => {
    const groups = workGroups(snap, runs);
    expect(groups.needs.map((row) => row.card.id)).toEqual(['T-0121', 'T-0118']);
    expect(groups.running.map((row) => row.card.id)).toEqual(['T-0130', 'T-0129', 'T-0122']);
    expect(groups.ideas.filter((row) => row.queued).map((row) => row.card.id)).toEqual(['T-0136']);
    expect(groups.ideas.filter((row) => !row.queued)).toHaveLength(4);
  });
});
