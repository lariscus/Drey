import { describe, expect, it } from 'vitest';
import { priorityClass, type PriorityConfig, type TicketCard } from '../contracts/tickets';
import { dispatchable } from './chain';

/** The chain's pure rule (M85, ADR-0077): which card the machine may take. */

function card(id: string, over: Partial<TicketCard['meta']> = {}, rest: Partial<TicketCard> = {}): TicketCard {
  return {
    id,
    path: `tickets/prioritized/${id}.md`,
    phase: 'prioritized',
    meta: {
      id,
      title: `Ticket ${id}`,
      repo: 'drey',
      repos: ['drey'],
      worker: null,
      persona: null,
      track: null,
      priority: 'normal',
      rank: 5000,
      branch: `t/${id}`,
      claimedBy: null,
      claimedAt: null,
      run: null,
      references: [],
      blockedBy: [],
      parkedReason: null,
      parkedAt: null,
      interactive: false,
      entered: {},
      ...over,
    },
    worker: 'opencode',
    blocked: [],
    blocks: [],
    issues: [],
    ...rest,
  };
}

describe('dispatchable', () => {
  it('takes a free, unblemished card', () => {
    expect(dispatchable(card('T-0001'), new Set())).toBe(true);
  });

  it('skips busy, claimed and run-stamped tickets', () => {
    expect(dispatchable(card('T-0002'), new Set(['T-0002']))).toBe(false);
    expect(dispatchable(card('T-0003', { claimedBy: 'agent-r1@host' }), new Set())).toBe(false);
    expect(dispatchable(card('T-0004', { run: 'r1' }), new Set())).toBe(false);
  });

  it('never takes a ticket the owner reserved for an interactive dialog (req-65)', () => {
    expect(dispatchable(card('T-0005', { interactive: true }), new Set())).toBe(false);
  });

  it('never takes a ticket parked at a manual step (E10-6)', () => {
    expect(dispatchable(card('T-0300', { awaiting: 'you' }), new Set())).toBe(false);
  });

  it('never takes a blocked ticket (T-0050) or one with an error issue', () => {
    expect(dispatchable(card('T-0006', {}, { blocked: ['T-0001'] }), new Set())).toBe(false);
    expect(dispatchable(card('T-0007', {}, { issues: [{ level: 'error', message: 'broken' }] as TicketCard['issues'] }), new Set())).toBe(false);
  });
});

describe('priorityClass (req-63)', () => {
  it('groups urgent with high and normal with low', () => {
    expect([priorityClass('urgent'), priorityClass('high'), priorityClass('normal'), priorityClass('low')]).toEqual([0, 0, 1, 1]);
  });

  it('follows the handed vocabulary — the middle is the default class, unknown ids wait', () => {
    const vocab: PriorityConfig = { order: ['p0', 'p1', 'p2'], default: 'p1' };
    expect([priorityClass('p0', vocab), priorityClass('p1', vocab), priorityClass('p2', vocab)]).toEqual([0, 1, 1]);
    expect(priorityClass('p9', vocab)).toBe(1);
  });
});
