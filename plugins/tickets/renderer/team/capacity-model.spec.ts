import { describe, expect, it } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- the spec stands in for the host, which owns the catalog at runtime
import { i18n } from '../../../../shared/i18n';
import type { ChainStatus, RunInfo, SlotSummary } from '../../../../packages/tickets-engine/src/fleet/protocol';
import type { BoardSnapshot, TicketCard } from '../../shared/tickets';
import {
  UPGRADE_Q,
  bandHeaderStatusOf,
  queueHeadOf,
  queuedIdsOf,
  resetTextOf,
  sessionCapacityOf,
  slotChipsOf,
  trancheOf,
} from './capacity-model';

const slot = (patch: Partial<SlotSummary>): SlotSummary => ({
  id: 'a',
  label: 'Claude A',
  profile: 'private',
  state: 'ready',
  busy: 0,
  total: 1,
  remaining: 0.62,
  reliability: 'measured',
  q: 1,
  resetsAt: '2026-11-16T09:00:00',
  ...patch,
});

const live = (id: string): RunInfo => ({ id, ticketId: 'T-1', provider: 'opencode', state: 'running' }) as unknown as RunInfo;

describe('slotChipsOf', () => {
  it('draws one dot per session, busy ones first, at least one', () => {
    expect(slotChipsOf([slot({ busy: 1, total: 3 })])[0]!.dots).toEqual([true, false, false]);
    expect(slotChipsOf([slot({ busy: 2, total: null })])[0]!.dots).toEqual([true, true]);
    expect(slotChipsOf([slot({ busy: 0, total: null })])[0]!.dots).toEqual([false]);
    expect(slotChipsOf([slot({ busy: 3, total: 2 })])[0]!.dots).toEqual([true, true, true]);
  });

  it('turns the remaining share into a whole-percent bar, amber while estimated', () => {
    expect(slotChipsOf([slot({ remaining: 0.62 })])[0]!.bar).toEqual({ share: 62, estimated: false });
    expect(slotChipsOf([slot({ remaining: 0.7, reliability: 'estimated' })])[0]!.bar).toEqual({ share: 70, estimated: true });
    expect(slotChipsOf([slot({ remaining: 1.4 })])[0]!.bar?.share).toBe(100);
    expect(slotChipsOf([slot({ remaining: -0.2 })])[0]!.bar?.share).toBe(0);
  });

  it('draws no bar, no q and no reset for a slot whose quota is unknown', () => {
    const [kimi] = slotChipsOf([slot({ label: 'Kimi', remaining: null, reliability: 'unknown', q: null, resetsAt: null })]);
    expect(kimi).toMatchObject({ bar: null, q: null, upgrade: false, resetsAt: null, note: 'unknown' });
    expect(slotChipsOf([slot({ reliability: 'unknown', remaining: 0.4 })])[0]!.bar).toBeNull();
  });

  it('shows q to one decimal and the upgrade mark only above 1.3', () => {
    expect(UPGRADE_Q).toBe(1.3);
    expect(slotChipsOf([slot({ q: 1.4 })])[0]).toMatchObject({ q: 1.4, upgrade: true });
    expect(slotChipsOf([slot({ q: 1.3 })])[0]).toMatchObject({ q: 1.3, upgrade: false });
    expect(slotChipsOf([slot({ q: 1.2 })])[0]).toMatchObject({ q: 1.2, upgrade: false });
    expect(slotChipsOf([slot({ q: 1.34 })])[0]).toMatchObject({ q: 1.3, upgrade: false });
    expect(slotChipsOf([slot({ q: 1.36 })])[0]).toMatchObject({ q: 1.4, upgrade: true });
    expect(slotChipsOf([slot({ q: null })])[0]!.q).toBeNull();
  });

  it('puts the state word in place of the share for a slot that needs a login or is exhausted', () => {
    expect(slotChipsOf([slot({ state: 'needs-login' })])[0]).toMatchObject({ note: 'needs-login', bar: null, q: null, resetsAt: null });
    expect(slotChipsOf([slot({ state: 'exhausted', remaining: 0 })])[0]).toMatchObject({ note: 'exhausted', bar: null });
  });

  it('reads an absent or unreadable reset as none', () => {
    expect(slotChipsOf([slot({ resetsAt: null })])[0]!.resetsAt).toBeNull();
    expect(slotChipsOf([slot({ resetsAt: 'soon' })])[0]!.resetsAt).toBeNull();
    expect(slotChipsOf(undefined)).toEqual([]);
  });
});

describe('resetTextOf', () => {
  const now = new Date(2026, 10, 12, 10, 0, 0); // a Thursday
  it('writes the weekday and the 24-hour time within the week, in the locale', () => {
    expect(resetTextOf(new Date(2026, 10, 16, 9, 0, 0), now, 'en')).toBe('Mon 09:00');
    expect(resetTextOf(new Date(2026, 10, 16, 21, 5, 0), now, 'en')).toBe('Mon 21:05');
    expect(resetTextOf(new Date(2026, 10, 16, 9, 0, 0), now, 'de')).toBe('Mo., 09:00');
  });
  it('writes the time alone for today, the weekday through the seventh day and the date beyond', () => {
    expect(resetTextOf(new Date(2026, 10, 19, 9, 0, 0), now, 'en')).toBe('Thu 09:00');
    expect(resetTextOf(new Date(2026, 10, 12, 18, 30, 0), now, 'en')).toBe('18:30');
    expect(resetTextOf(new Date(2026, 10, 20, 9, 0, 0), now, 'en')).toBe('Nov 20, 09:00');
  });
});

describe('the header value', () => {
  const chain = { poolSize: { opencode: 2, 'claude-code': 3 } } as unknown as ChainStatus;
  it('reads live sessions over the pools, then what is queued', () => {
    expect(bandHeaderStatusOf([live('r1'), live('r2')], chain, 1, i18n)).toBe('2 of 5 sessions · 1 queued');
    expect(bandHeaderStatusOf([live('r1')], chain, 0, i18n)).toBe('1 of 5 sessions');
  });
  it('falls back to the slots, then to what runs, and still says what is queued', () => {
    const bySlots = { slots: [slot({ total: 2 }), slot({ id: 'b', total: 1 })] } as unknown as ChainStatus;
    expect(sessionCapacityOf(bySlots)).toBe(3);
    expect(sessionCapacityOf({ slots: [slot({ total: null })] } as unknown as ChainStatus)).toBe(0);
    expect(bandHeaderStatusOf([live('r1')], bySlots, 0, i18n)).toBe('1 of 3 sessions');
    expect(bandHeaderStatusOf([live('r1')], null, 2, i18n)).toBe('1 running · 2 queued');
    expect(bandHeaderStatusOf([], null, 2, i18n)).toBe('2 queued');
    expect(bandHeaderStatusOf([], null, 0, i18n)).toBeNull();
  });
});

describe('the queue and the tranche', () => {
  const card = (id: string, phase: string): TicketCard =>
    ({ id, path: `${phase}/${id}.md`, phase, meta: { title: id, persona: null, parent: null, entered: {}, priority: 'normal' }, blocked: [], blocks: [], issues: [] }) as unknown as TicketCard;
  const snapshot = {
    vaultId: 'v',
    columns: [
      { phase: { id: 'inbox', title: 'Inbox', persona: null, handover: 'manual' }, unknown: false, tickets: [card('T-0001', 'inbox')] },
      { phase: { id: 'prioritized', title: 'Prioritized', persona: null, handover: 'manual' }, unknown: false, tickets: [card('T-0123', 'prioritized')] },
      { phase: { id: 'build', title: 'Build', persona: 'ben', handover: 'agent build-default' }, unknown: false, tickets: [] },
    ],
    checkpoints: [],
    recentDone: [],
  } as unknown as BoardSnapshot;

  it('counts the ideas the fleet pulls from and names the first', () => {
    expect(queuedIdsOf(snapshot, [])).toEqual(['T-0123']);
    expect(queueHeadOf(['T-0123', 'T-0124'])).toEqual({ ticketId: 'T-0123', position: 1 });
    expect(queueHeadOf([])).toBeNull();
    expect(queuedIdsOf(null, [])).toEqual([]);
  });

  it('orders the queue the way the dispatcher takes it: urgent first, then the rightmost column, then position', () => {
    const urgent = card('T-0125', 'prioritized');
    (urgent.meta as { priority: string }).priority = 'urgent';
    const two = {
      ...snapshot,
      columns: [
        { phase: { id: 'inbox', title: 'Inbox', persona: null, handover: 'manual' }, unknown: false, tickets: [] },
        { phase: { id: 'prioritized', title: 'Prioritized', persona: null, handover: 'manual' }, unknown: false, tickets: [card('T-0123', 'prioritized'), card('T-0124', 'prioritized'), urgent] },
        { phase: { id: 'build', title: 'Build', persona: 'ben', handover: 'agent build-default' }, unknown: false, tickets: [] },
      ],
    } as unknown as BoardSnapshot;
    expect(queuedIdsOf(two, [])).toEqual(['T-0125', 'T-0123', 'T-0124']);
  });

  it('has no tranche until the chain status carries one (req-179)', () => {
    expect(trancheOf(null)).toBeNull();
    expect(trancheOf({ master: 'run' } as unknown as ChainStatus)).toBeNull();
  });

  it('reads the tranche off the chain block, with the limits it has', () => {
    const now = new Date('2026-11-09T12:00:00Z');
    const chain = (tranche: object): ChainStatus => ({ master: 'run', tranche }) as unknown as ChainStatus;
    const block = { index: 1, of: 3, done: 4, total: 10, spent: 4.1, budget: 15, startedAt: '2026-11-09T09:00:00Z', endsAt: '2026-11-09T14:10:00Z', checkpoint: null, report: null };
    expect(trancheOf(chain(block), now)).toMatchObject({ runs: 4, size: 10, cost: 4.1, budget: 15, runsLeft: 6, msLeft: 130 * 60_000 });
    expect(trancheOf(chain({ ...block, total: null, budget: null, endsAt: null }), now)).toMatchObject({ size: null, budget: null, runsLeft: null, msLeft: null });
    expect(trancheOf(chain({ ...block, checkpoint: 'waiting' }), now)).toBeNull();
  });
});
