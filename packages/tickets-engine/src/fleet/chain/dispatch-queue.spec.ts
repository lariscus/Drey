import { describe, expect, it } from 'vitest';
import { dispatchQueueOf } from './dispatch-queue';
import type { QueueEntry } from '../protocol-pool';

const poolEntry = (ticket: string, persona: string | null): QueueEntry => ({
  ticket,
  persona,
  class: 'B',
  reason: 'capacity',
  line: 'waits for a B slot',
  detail: 'no B slot free',
  position: 1,
  since: '2026-11-14T08:00:00Z',
});

describe('dispatchQueueOf (req-148)', () => {
  it('orders the pool queue and the holder waits by the dispatch order', () => {
    const queued = dispatchQueueOf({
      order: ['T-0003', 'T-0001', 'T-0002', 'T-0009'],
      pool: [poolEntry('T-0002', 'ben')],
      waits: new Map([
        ['T-0003', { persona: 'ralf', why: 'persona-full' as const }],
        ['T-0001', { persona: 'ben', why: 'pool-full' as const }],
      ]),
      previous: [],
      now: '2026-11-14T09:00:00Z',
    });
    expect(queued).toEqual([
      { ticket: 'T-0003', persona: 'ralf', why: 'persona', position: 1, since: '2026-11-14T09:00:00Z' },
      { ticket: 'T-0001', persona: 'ben', why: 'slot', position: 2, since: '2026-11-14T09:00:00Z' },
      { ticket: 'T-0002', persona: 'ben', why: 'slot', position: 3, since: '2026-11-14T09:00:00Z' },
    ]);
  });

  it('serves the pool entries outside the order after it (the phase board) and keeps a known wait its since', () => {
    const queued = dispatchQueueOf({
      order: [],
      pool: [poolEntry('T-0005', null), poolEntry('T-0004', 'tessa')],
      waits: new Map(),
      previous: [{ ticket: 'T-0004', persona: 'tessa', why: 'slot', position: 1, since: '2026-11-14T07:00:00Z' }],
      now: '2026-11-14T09:00:00Z',
    });
    expect(queued.map((entry) => [entry.ticket, entry.position, entry.since])).toEqual([
      ['T-0005', 1, '2026-11-14T09:00:00Z'],
      ['T-0004', 2, '2026-11-14T07:00:00Z'],
    ]);
  });

  it('starts a new since when the reason changes', () => {
    const queued = dispatchQueueOf({
      order: ['T-0004'],
      pool: [],
      waits: new Map([['T-0004', { persona: 'tessa', why: 'persona-full' as const }]]),
      previous: [{ ticket: 'T-0004', persona: 'tessa', why: 'slot', position: 1, since: '2026-11-14T07:00:00Z' }],
      now: '2026-11-14T09:00:00Z',
    });
    expect(queued[0]!.since).toBe('2026-11-14T09:00:00Z');
  });
});
