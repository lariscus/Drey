import { describe, expect, it } from 'vitest';
import type { QuotaWindow, RunInfo, SlotView } from '../protocol';
import { FakeClock, window } from './routing.fake';
import { DEFAULT_RUN_SHARE, RunShareTracker } from './run-share-tracker';

const NOW = new Date('2026-11-09T12:00:00Z');
const at = (minutes: number): string => new Date(NOW.getTime() + minutes * 60_000).toISOString();
const view = (windows: QuotaWindow[], busy = 1, id = 'claude-a'): SlotView => ({ id, label: id, busy, windows }) as unknown as SlotView;
const ended = (id: string): { kind: 'run'; info: RunInfo } => ({ kind: 'run', info: { id, state: 'done' } as RunInfo });
const slotEvent = (v: SlotView): { kind: 'slot'; slot: SlotView } => ({ kind: 'slot', slot: v });

function tracker(): { shares: RunShareTracker; clock: FakeClock } {
  const clock = new FakeClock(NOW);
  return { shares: new RunShareTracker(clock), clock };
}

describe("RunShareTracker — what a run takes of its slot's windows (req-178)", () => {
  it('knows nothing at first: the default share', () => {
    expect(tracker().shares.shareOf({ ticket: 'T-1', persona: 'ben' }, 'claude-a', '7d')).toBe(DEFAULT_RUN_SHARE);
  });

  it("samples the drop at the first newer reading after the run's end; the ticket's median wins over the persona's", () => {
    const { shares } = tracker();
    shares.begin('R-1', { ticket: 'T-1', persona: 'ben' }, view([window({ remaining: 0.8, fetchedAt: at(0) })]));
    shares.publish(slotEvent(view([window({ remaining: 0.7, fetchedAt: at(5) })]))); // still running: no sample
    expect(shares.shareOf({ ticket: 'T-1', persona: 'ben' }, 'claude-a', '7d')).toBe(DEFAULT_RUN_SHARE);
    shares.publish(ended('R-1'));
    shares.publish(slotEvent(view([window({ remaining: 0.68, fetchedAt: at(10) })])));
    expect(shares.shareOf({ ticket: 'T-1', persona: 'ben' }, 'claude-a', '7d')).toBeCloseTo(0.12);
    expect(shares.shareOf({ ticket: 'T-9', persona: 'ben' }, 'claude-a', '7d')).toBeCloseTo(0.12); // the persona's
    expect(shares.shareOf({ ticket: 'T-9', persona: 'eva' }, 'claude-a', '7d')).toBe(DEFAULT_RUN_SHARE);
    expect(shares.shareOf({ ticket: 'T-1', persona: 'ben' }, 'zai', '7d')).toBe(DEFAULT_RUN_SHARE); // another account
  });

  it('shares the drop among the runs the slot carried at once', () => {
    const { shares } = tracker();
    shares.begin('R-1', { ticket: 'T-1', persona: 'ben' }, view([window({ remaining: 0.8, fetchedAt: at(0) })], 1));
    shares.publish(slotEvent(view([window({ remaining: 0.8, fetchedAt: at(0) })], 2)));
    shares.publish(ended('R-1'));
    shares.publish(slotEvent(view([window({ remaining: 0.6, fetchedAt: at(10) })], 1)));
    expect(shares.shareOf({ ticket: 'T-1', persona: null }, 'claude-a', '7d')).toBeCloseTo(0.1);
  });

  it('a window that went up (it reset) gives no sample; a reading no newer waits for the next', () => {
    const { shares } = tracker();
    shares.begin('R-1', { ticket: 'T-1', persona: null }, view([window({ remaining: 0.2, fetchedAt: at(0) }), window({ name: '5h', remaining: 0.5, fetchedAt: at(0) })]));
    shares.publish(ended('R-1'));
    shares.publish(slotEvent(view([window({ remaining: 0.2, fetchedAt: at(0) })])));
    shares.publish(slotEvent(view([window({ remaining: 0.95, fetchedAt: at(9) }), window({ name: '5h', remaining: 0.4, fetchedAt: at(9) })])));
    expect(shares.shareOf({ ticket: 'T-1', persona: null }, 'claude-a', '7d')).toBe(DEFAULT_RUN_SHARE);
    expect(shares.shareOf({ ticket: 'T-1', persona: null }, 'claude-a', '5h')).toBeCloseTo(0.1);
  });

  it('forgets an ended run whose slot is not read again within half an hour', () => {
    const { shares, clock } = tracker();
    shares.begin('R-1', { ticket: 'T-1', persona: null }, view([window({ remaining: 0.8, fetchedAt: at(0) })]));
    shares.publish(ended('R-1'));
    clock.advance(31 * 60_000);
    shares.publish(slotEvent(view([window({ remaining: 0.8, fetchedAt: at(0) })])));
    shares.publish(slotEvent(view([window({ remaining: 0.5, fetchedAt: at(40) })])));
    expect(shares.shareOf({ ticket: 'T-1', persona: null }, 'claude-a', '7d')).toBe(DEFAULT_RUN_SHARE);
  });
});
