import { describe, expect, it } from 'vitest';
import { DEFAULT_ROUTING, type QuotaWindow, type RoutingSettings, type SlotView } from '../protocol';
import { ReserveGuard, type ShareEstimates } from './reserve-guard';
import { window } from './routing.fake';

const view = (windows: QuotaWindow[]): SlotView => ({ id: 'claude-a', label: 'Claude A', windows }) as unknown as SlotView;
const shares = (share: number): ShareEstimates => ({ shareOf: () => share });
const guard = (share: number, routing: RoutingSettings = DEFAULT_ROUTING): ReserveGuard => new ReserveGuard({ routing: () => routing }, shares(share));
const SUBJECT = { ticket: 'T-0001', persona: 'ben' };

describe('ReserveGuard — a share of every window is kept back (req-178)', () => {
  it.each<[string, QuotaWindow[], number, RoutingSettings, string | null]>([
    ['plenty left', [window({ remaining: 0.5 })], 0.05, DEFAULT_ROUTING, null],
    ['exactly down to the reserve still runs', [window({ remaining: 0.15 })], 0.05, DEFAULT_ROUTING, null],
    ['below the reserve waits', [window({ remaining: 0.12 })], 0.05, DEFAULT_ROUTING, 'Claude A: 7d window 12 % left, a run takes about 5 %, 10 % is kept in reserve'],
    ['any window counts', [window({ remaining: 0.9 }), window({ name: '5h', remaining: 0.11 })], 0.05, DEFAULT_ROUTING, 'Claude A: 5h window 11 % left, a run takes about 5 %, 10 % is kept in reserve'],
    ['a learned large share waits earlier', [window({ remaining: 0.3 })], 0.25, DEFAULT_ROUTING, 'Claude A: 7d window 30 % left, a run takes about 25 %, 10 % is kept in reserve'],
    ['an unknown remaining share is not guarded', [window({ remaining: null })], 0.05, DEFAULT_ROUTING, null],
    ['a reserve of 0 guards nothing', [window({ remaining: 0.01 })], 0.05, { upgradeAboveQ: 1.3, reservePerWindow: 0 }, null],
  ])('%s', (_name, windows, share, routing, expected) => {
    expect(guard(share, routing).refusal(view(windows), SUBJECT)).toBe(expected);
  });
});
