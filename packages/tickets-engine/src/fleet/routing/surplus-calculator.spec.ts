import { describe, expect, it } from 'vitest';
import { FIVE_HOURS_MS, WEEK_MS } from './quota-source';
import { window } from './routing.fake';
import { SurplusCalculator } from './surplus-calculator';

const NOW = new Date('2026-11-09T12:00:00Z');
const at = (hoursFromNow: number): string => new Date(NOW.getTime() + hoursFromNow * 3_600_000).toISOString();
const calc = new SurplusCalculator();

describe('SurplusCalculator — q = R / T, the minimum over the windows', () => {
  it('a window half spent with half its time left is even (q 1)', () => {
    expect(calc.windowQ(window({ spanMs: FIVE_HOURS_MS, remaining: 0.5, resetsAt: at(2.5) }), NOW)).toBeCloseTo(1);
  });

  it('more left than time left is a surplus (q > 1), less is a deficit', () => {
    expect(calc.windowQ(window({ spanMs: WEEK_MS, remaining: 0.62, resetsAt: at(84) }), NOW)).toBeCloseTo(1.24);
    expect(calc.windowQ(window({ spanMs: WEEK_MS, remaining: 0.2, resetsAt: at(84) }), NOW)).toBeCloseTo(0.4);
  });

  it("takes the slot's minimum and rounds it to two places (board 7l: q 1.4 · q 0.8)", () => {
    const windows = [window({ name: '5h', spanMs: FIVE_HOURS_MS, remaining: 0.78, resetsAt: at(2.5) }), window({ name: '7d', spanMs: WEEK_MS, remaining: 0.62, resetsAt: at(84) })];
    expect(calc.q(windows, NOW)).toBe(1.24);
  });

  it('cannot tell without a share, a reset or a span, or once the window reset', () => {
    expect(calc.windowQ(window({ remaining: null, resetsAt: at(1) }), NOW)).toBeNull();
    expect(calc.windowQ(window({ resetsAt: null }), NOW)).toBeNull();
    expect(calc.windowQ(window({ spanMs: null, resetsAt: at(1) }), NOW)).toBeNull();
    expect(calc.windowQ(window({ resetsAt: at(-1) }), NOW)).toBeNull();
    expect(calc.q([window({ resetsAt: null })], NOW)).toBeNull();
  });

  it('holds the time share at 1 % right before a reset, so q stays finite', () => {
    expect(calc.windowQ(window({ spanMs: WEEK_MS, remaining: 0.3, resetsAt: new Date(NOW.getTime() + 1_000).toISOString() }), NOW)).toBeCloseTo(30);
  });

  it('a reset further away than the span counts as a full time share', () => {
    expect(calc.windowQ(window({ spanMs: FIVE_HOURS_MS, remaining: 0.9, resetsAt: at(10) }), NOW)).toBeCloseTo(0.9);
  });
});
