import { describe, expect, it } from 'vitest';
import type { BoardLane, TicketHold } from '../../../../packages/tickets-engine/src/contracts/persona-board';
import type { BoardSnapshot, TicketCard } from '../../shared/tickets';
import { personaBoardModelOf } from './persona-board-model';

const LANES: BoardLane[] = [
  { persona: 'ben', title: 'Ben', kind: 'agent', color: '#8ecbef', parallel: 2, min: 0 },
  { persona: 'ralf', title: 'Ralf', kind: 'agent', color: '#bfe3cd', parallel: 1, min: 0 },
  { persona: 'you', title: 'You', kind: 'human', color: '#e0bb6e', parallel: null, min: 0 },
];

function card(id: string, phase: string, project: string, holder?: string): TicketCard {
  const hold: TicketHold | undefined =
    holder === undefined ? undefined : { holder, why: 'entry', position: 1, length: 2, chain: [holder, 'you'], mode: null, named: holder, claimed: false, sentBack: null, questions: 0 };
  return {
    id,
    path: `tickets/${phase}/${id}.md`,
    phase,
    meta: { title: id, priority: 'normal', project, chain: [], entered: {}, parent: null, persona: null, claimedBy: null },
    worker: 'opencode',
    blocked: [],
    blocks: [],
    issues: [],
    ...(hold === undefined ? {} : { hold }),
  } as unknown as TicketCard;
}

const phase = (id: string): object => ({ id, title: id, handover: 'manual', persona: null });
const snap = {
  vaultId: 'v',
  columns: [
    { phase: phase('inbox'), unknown: false, tickets: [card('T-1', 'inbox', 'drey'), card('T-2', 'inbox', 'lariscus')] },
    { phase: phase('done'), unknown: false, tickets: [] },
    { phase: phase('active'), unknown: true, tickets: [card('T-3', 'active', 'drey', 'ben'), card('T-4', 'active', 'lariscus', 'ralf')] },
  ],
  recentDone: [],
  checkpoints: [],
  priorities: { order: ['normal'] },
  lanes: LANES,
} as unknown as BoardSnapshot;
const live = { runs: [], chain: null, queueWords: () => null, now: 0 };

describe('the persona board under a project filter (req-285)', () => {
  it('shows only the chosen project’s cards but keeps every column and its load', () => {
    const shows = (c: TicketCard): boolean => c.meta.project === 'drey';
    const model = personaBoardModelOf(snap, { ...live, shows }, false);
    expect(model.inbox.map((c) => c.id)).toEqual(['T-1']);
    const ralf = model.lanes.find((lane) => lane.lane.persona === 'ralf');
    // Ralf's only card is Lariscus's: hidden, yet his column stays (it is not folded) and empty.
    expect(ralf?.cards).toEqual([]);
    expect(model.folded.map((lane) => lane.persona)).toEqual([]);
    expect(model.lanes.find((lane) => lane.lane.persona === 'ben')?.cards.map((c) => c.id)).toEqual(['T-3']);
  });

  it('puts the chip the filter gives on each card', () => {
    const model = personaBoardModelOf(snap, { ...live, chip: (c) => ({ label: c.meta.project ?? '', color: '#000000' }) }, false);
    expect(model.inbox.map((c) => c.project?.label)).toEqual(['drey', 'lariscus']);
    expect(personaBoardModelOf(snap, live, false).inbox[0]!.project).toBeNull();
  });
});
