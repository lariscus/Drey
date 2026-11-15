import { describe, expect, it } from 'vitest';
import type { BoardColumn, TicketCard } from '../../contracts/tickets';
import { pipelinePhaseOf } from '../../core/pipeline/pipeline-phase';
import { chainWorkingPhase, planHolderDispatch, type HolderCandidate, type HolderPlanInput, type PersonaPool } from './holder-plan';

function card(id: string, priority: 'high' | 'normal' | 'low' = 'normal', rank = 0): TicketCard {
  return {
    id,
    path: `tickets/building/${id}.md`,
    phase: 'building',
    meta: { id, title: id, repo: 'drey', repos: [], worker: null, persona: null, track: null, priority, rank, branch: null, claimedBy: null, claimedAt: null, run: null, references: [], blockedBy: [], parkedReason: null, parkedAt: null, interactive: false, entered: {} },
    worker: 'opencode',
    blocked: [],
    blocks: [],
    issues: [],
  } as unknown as TicketCard;
}

function input(cards: TicketCard[], holders: Record<string, HolderCandidate>, over: Partial<HolderPlanInput> = {}): HolderPlanInput {
  const column: BoardColumn = { phase: pipelinePhaseOf({ handover: 'agent' }, 'building', []), tickets: cards, unknown: false } as BoardColumn;
  return {
    master: 'run',
    columns: [column],
    holders: new Map(Object.entries(holders)),
    poolSize: { 'claude-code': 5 },
    liveByPool: {},
    poolOf: () => 'claude-code',
    busyTickets: new Set(),
    personaLive: {},
    personaPool: () => ({ parallel: null, min: 0 }),
    heldPersonas: new Set(),
    ...over,
  };
}

const ids = (plan: ReturnType<typeof planHolderDispatch>): string[] => plan.plan.map((item) => item.card.id);

describe('the holder plan (concept §9)', () => {
  it('starts only tickets an agent persona holds', () => {
    const plan = planHolderDispatch(input([card('T-1'), card('T-2')], { 'T-1': { persona: 'ben', position: 3 } }));
    expect(ids(plan)).toEqual(['T-1']);
    expect(plan.plan[0]).toMatchObject({ persona: 'ben', position: 3, workingPhase: 'building', overrun: false });
  });

  it('orders by priority class, then the later position (finishing beats starting), then rank', () => {
    const cards = [card('A', 'normal', 1), card('B', 'normal', 2), card('C', 'high', 9), card('D', 'normal', 0)];
    const holders = { A: { persona: 'ben', position: 3 }, B: { persona: 'ralf', position: 4 }, C: { persona: 'ben', position: 2 }, D: { persona: 'ben', position: 3 } };
    expect(ids(planHolderDispatch(input(cards, holders)))).toEqual(['C', 'B', 'D', 'A']);
  });

  it("caps a persona at its own pool (parallel) and says it waits for the persona", () => {
    const pools: Record<string, PersonaPool> = { ben: { parallel: 2, min: 0 } };
    const plan = planHolderDispatch(
      input([card('A'), card('B'), card('C')], { A: { persona: 'ben', position: 3 }, B: { persona: 'ben', position: 3 }, C: { persona: 'ben', position: 3 } }, {
        personaLive: { ben: 1 },
        personaPool: (p) => pools[p] ?? { parallel: null, min: 0 },
      }),
    );
    expect(ids(plan)).toEqual(['A']);
    expect(plan.waits.get('B')).toEqual({ persona: 'ben', why: 'persona-full' });
  });

  it('needs room in the big pool too: free places in the persona do not help', () => {
    const plan = planHolderDispatch(input([card('A')], { A: { persona: 'ben', position: 3 } }, { poolSize: { 'claude-code': 1 }, liveByPool: { 'claude-code': 1 } }));
    expect(ids(plan)).toEqual([]);
    expect(plan.waits.get('A')).toEqual({ persona: 'ben', why: 'pool-full' });
  });

  it('lets a persona below its min overrun the full big pool on purpose', () => {
    const plan = planHolderDispatch(
      input([card('A'), card('B')], { A: { persona: 'tessa', position: 5 }, B: { persona: 'tessa', position: 5 } }, {
        poolSize: { 'claude-code': 1 },
        liveByPool: { 'claude-code': 1 },
        personaPool: () => ({ parallel: null, min: 1 }),
      }),
    );
    expect(plan.plan.map((item) => [item.card.id, item.overrun])).toEqual([['A', true]]);
    expect(plan.waits.get('B')?.why).toBe('pool-full');
  });

  it('starts nothing for a held persona, a busy ticket, or while the master is halted', () => {
    const holders = { A: { persona: 'ben', position: 3 }, B: { persona: 'ralf', position: 4 } };
    expect(ids(planHolderDispatch(input([card('A'), card('B')], holders, { heldPersonas: new Set(['ben']), busyTickets: new Set(['B']) })))).toEqual([]);
    expect(ids(planHolderDispatch(input([card('A')], holders, { master: 'halted' })))).toEqual([]);
  });
});

describe('the working column of a chain run', () => {
  it('is the pipeline column, else a plain column of that id', () => {
    const pipeline = [pipelinePhaseOf({ title: 'Building' }, 'building', [])];
    expect(chainWorkingPhase(pipeline, 'building').title).toBe('Building');
    expect(chainWorkingPhase(pipeline, 'active')).toEqual({ id: 'active', title: 'Active', color: null });
  });
});
