import { describe, expect, it } from 'vitest';
import { DEFAULT_ROUTING } from '../protocol';
import { BurnRateRig, slotView, week } from './burn-rate.fake';
import { nextDayOf } from './burn-rate-guard';

const NOON = new Date('2026-11-09T12:00:00Z');

/** A rig whose one slot spent `spent` of its week today. */
function spent(share: number, rig = new BurnRateRig(NOON)): BurnRateRig {
  rig.see([slotView('claude-a', [week(0.9)])]);
  rig.see([slotView('claude-a', [week(0.9 - share)])]);
  return rig;
}

describe('BurnRateGuard — at most a share of the weekly quota per day (req-181)', () => {
  it.each<[string, number, number, boolean]>([
    ['under the limit', 0.15, 0.2, false],
    ['at the limit holds', 0.2, 0.2, true],
    ['over the limit holds', 0.21, 0.2, true],
    ['0 is off', 0.5, 0, false],
  ])('%s', (_name, share, limit, holds) => {
    const rig = spent(share);
    rig.settings = { ...DEFAULT_ROUTING, burnRate: limit };
    const hold = rig.guard.hold();
    expect(hold !== null).toBe(holds);
    if (hold !== null) {
      expect(hold).toEqual({ reason: 'burn-rate', spent: share, limit, resumesAt: '2026-11-10T00:00:00.000Z', basis: 'measured' });
    }
  });

  it('nothing to count holds nothing', () => {
    const rig = new BurnRateRig(NOON);
    rig.settings = { ...DEFAULT_ROUTING, burnRate: 0.01 };
    expect(rig.guard.hold()).toBeNull();
  });

  it('the day turning clears the hold', () => {
    const rig = spent(0.25);
    expect(rig.guard.hold()).not.toBeNull();
    rig.clock.advance(12 * 3_600_000);
    expect(rig.guard.hold()).toBeNull();
  });

  it('the windows resetting clears the hold once the meter drops below the limit', () => {
    const rig = new BurnRateRig(NOON);
    rig.see([slotView('claude-a', [week(0.4, { resetsAt: '2026-11-09T13:00:00.000Z' })])]);
    rig.see([slotView('claude-a', [week(0.15, { resetsAt: '2026-11-09T13:00:00.000Z' })])]);
    expect(rig.guard.hold()).not.toBeNull();
    rig.clock.advance(2 * 3_600_000);
    rig.see([slotView('claude-a', [week(1, { resetsAt: '2026-11-16T13:00:00.000Z' })])]);
    expect(rig.guard.hold()).toBeNull();
  });

  it('Allow today once lifts the hold for the rest of the day, not the next', async () => {
    const rig = spent(0.3);
    await rig.guard.lift();
    expect(rig.guard.hold()).toBeNull();
    rig.see([slotView('claude-a', [week(0.4)])]); // spending goes on
    expect(rig.guard.hold()).toBeNull();
    rig.clock.advance(12 * 3_600_000);
    spent(0.25, rig);
    expect(rig.guard.hold()).not.toBeNull();
  });

  it('the lift is stored with the day, after every earlier write', async () => {
    const rig = spent(0.3);
    await rig.guard.lift();
    expect(rig.file.stored).toMatchObject({ day: '2026-11-09', lifted: true });
  });

  it('the next day is the next UTC midnight', () => {
    expect(nextDayOf(new Date('2026-12-31T23:59:00Z'))).toBe('2027-01-01T00:00:00.000Z');
    expect(nextDayOf(new Date('2026-11-09T00:00:00Z'))).toBe('2026-11-10T00:00:00.000Z');
  });
});

describe('BurnRateHoldSource — the hold the chain asks, told in the runner log (req-181)', () => {
  it('logs the refusal once when the hold rises and once when it clears; the hold keeps the time it rose', () => {
    const rig = spent(0.21);
    expect(rig.source.current()).toMatchObject({ reason: 'burn-rate', spent: 0.21, limit: 0.2, since: '2026-11-09T12:00:00.000Z' });
    rig.clock.advance(60_000);
    expect(rig.source.current()?.since).toBe('2026-11-09T12:00:00.000Z');
    expect(rig.logs).toEqual(['route refused · burn rate 21 % of 20 % today · resumes 00:00']);
    rig.clock.advance(12 * 3_600_000);
    expect(rig.source.current()).toBeNull();
    expect(rig.logs).toEqual(['route refused · burn rate 21 % of 20 % today · resumes 00:00', 'burn rate: the hold cleared — new runs start again']);
  });

  it('an estimated figure says so in the line', () => {
    const rig = new BurnRateRig(NOON);
    rig.share = 0.25;
    rig.see([slotView('kimi', [])]);
    rig.ran({ id: 'R-1', ticketId: 'T-0001', persona: null, startedAt: '2026-11-09T11:00:00.000Z', slot: { id: 'kimi', label: 'Kimi' }, costUsd: null, state: 'running' } as never);
    rig.source.current();
    expect(rig.logs).toEqual(['route refused · burn rate 25 % of 20 % today · resumes 00:00 · estimated']);
  });

  it('the lift is logged as the owner\'s, without a second "cleared" line', async () => {
    const rig = spent(0.3);
    rig.source.current();
    await rig.source.lift();
    expect(rig.source.current()).toBeNull();
    expect(rig.logs.slice(1)).toEqual(['burn rate: allowed for the rest of today by the owner']);
  });
});
