import { describe, expect, it } from 'vitest';
import { BurnRateRig, MemoryDayFile, runOn, slotView, week } from './burn-rate.fake';

const MORNING = new Date('2026-11-09T06:00:00Z');
const HOUR = 3_600_000;

describe('BurnRateMeter — the share of the weekly quota spent today over all slots (req-181)', () => {
  it('measured: every drop of a slot\'s weekly window since the day\'s first reading', () => {
    const rig = new BurnRateRig(MORNING);
    rig.see([slotView('claude-a', [week(0.8)])]);
    rig.clock.advance(HOUR);
    rig.see([slotView('claude-a', [week(0.7)])]);
    rig.clock.advance(HOUR);
    rig.see([slotView('claude-a', [week(0.62)])]);
    expect(rig.meter.reading()).toEqual({ day: '2026-11-09', spent: 0.18, basis: 'measured', slots: [{ slot: 'claude-a', spent: 0.18, basis: 'measured' }] });
  });

  it('a rise is not spending (a rolling window lets go of old use); the next drop counts from the higher value', () => {
    const rig = new BurnRateRig(MORNING);
    rig.see([slotView('claude-a', [week(0.5)])]);
    rig.see([slotView('claude-a', [week(0.4)])]);
    rig.see([slotView('claude-a', [week(0.45)])]);
    rig.see([slotView('claude-a', [week(0.4)])]);
    expect(rig.meter.reading().spent).toBe(0.15);
  });

  it('a window past its reset starts again from its new reading', () => {
    const rig = new BurnRateRig(MORNING);
    rig.see([slotView('claude-a', [week(0.3, { resetsAt: '2026-11-09T08:00:00.000Z' })])]);
    rig.see([slotView('claude-a', [week(0.1, { resetsAt: '2026-11-09T08:00:00.000Z' })])]);
    expect(rig.meter.reading().spent).toBe(0.2);
    rig.clock.advance(3 * HOUR);
    rig.see([slotView('claude-a', [week(1, { resetsAt: '2026-11-16T08:00:00.000Z' })])]);
    rig.see([slotView('claude-a', [week(0.97, { resetsAt: '2026-11-16T08:00:00.000Z' })])]);
    expect(rig.meter.reading().spent).toBe(0.03);
  });

  it('estimated: a counted weekly window reads as estimated', () => {
    const rig = new BurnRateRig(MORNING);
    rig.see([slotView('zai', [week(0.9, { reliability: 'estimated' })])]);
    rig.see([slotView('zai', [week(0.8, { reliability: 'estimated' })])]);
    expect(rig.meter.reading()).toMatchObject({ spent: 0.1, basis: 'estimated' });
  });

  it('a slot without a weekly window: today\'s runs at the share a run takes of its week', () => {
    const rig = new BurnRateRig(MORNING);
    rig.share = 0.04;
    rig.see([slotView('kimi', [week(null, { name: '5h' })], { quota: 'kimi', provider: 'kimi' })]);
    rig.ran(runOn('kimi', '2026-11-09T05:00:00.000Z', 'T-0001'));
    rig.ran(runOn('kimi', '2026-11-09T05:30:00.000Z', 'T-0002'));
    rig.ran(runOn('kimi', '2026-11-08T23:30:00.000Z', 'T-0003')); // yesterday's
    rig.ran(runOn('claude-a', '2026-11-09T05:30:00.000Z', 'T-0004')); // another slot's
    expect(rig.meter.reading()).toEqual({ day: '2026-11-09', spent: 0.08, basis: 'estimated', slots: [{ slot: 'kimi', spent: 0.08, basis: 'estimated' }] });
  });

  it('a weekly window whose remaining share is unknown counts the runs too', () => {
    const rig = new BurnRateRig(MORNING);
    rig.see([slotView('copilot', [week(null, { reliability: 'unknown' })])]);
    rig.ran(runOn('copilot', '2026-11-09T05:00:00.000Z'));
    expect(rig.meter.reading()).toMatchObject({ spent: 0.05, basis: 'estimated' });
  });

  it('mixed: the mean over the slots, each slot\'s week weighing the same', () => {
    const rig = new BurnRateRig(MORNING);
    rig.share = 0.1;
    rig.see([slotView('claude-a', [week(0.9)]), slotView('kimi', [], { provider: 'kimi' })]);
    rig.see([slotView('claude-a', [week(0.6)]), slotView('kimi', [], { provider: 'kimi' })]);
    rig.ran(runOn('kimi', '2026-11-09T05:00:00.000Z'));
    expect(rig.meter.reading()).toEqual({
      day: '2026-11-09',
      spent: 0.2,
      basis: 'mixed',
      slots: [
        { slot: 'claude-a', spent: 0.3, basis: 'measured' },
        { slot: 'kimi', spent: 0.1, basis: 'estimated' },
      ],
    });
  });

  it('an implied slot counts only once it ran today; with no slot to count there is no basis', () => {
    const rig = new BurnRateRig(MORNING);
    rig.see([slotView('opencode', [week(null)], { implied: true, provider: 'opencode' })]);
    expect(rig.meter.reading()).toEqual({ day: '2026-11-09', spent: 0, basis: null, slots: [] });
    rig.ran(runOn('opencode', '2026-11-09T05:00:00.000Z'));
    expect(rig.meter.reading()).toMatchObject({ spent: 0.05, basis: 'estimated' });
  });

  it('the day turns at UTC midnight: the spend starts again from the new day\'s first reading', () => {
    const rig = new BurnRateRig(new Date('2026-11-09T23:00:00Z'));
    rig.see([slotView('claude-a', [week(0.8)])]);
    rig.see([slotView('claude-a', [week(0.5)])]);
    expect(rig.meter.reading().spent).toBe(0.3);
    rig.clock.advance(2 * HOUR);
    expect(rig.meter.reading()).toMatchObject({ day: '2026-11-10', spent: 0 });
    rig.see([slotView('claude-a', [week(0.45)])]);
    expect(rig.meter.reading().spent).toBe(0.05);
  });

  it('a restart mid-day keeps the morning\'s spend (the day book is stored)', async () => {
    const file = new MemoryDayFile();
    const before = new BurnRateRig(MORNING, file);
    before.see([slotView('claude-a', [week(0.8)])]);
    before.see([slotView('claude-a', [week(0.7)])]);
    await before.book.idle();
    const after = new BurnRateRig(new Date(MORNING.getTime() + HOUR), file);
    await after.book.load();
    after.see([slotView('claude-a', [week(0.65)])]);
    expect(after.meter.reading().spent).toBe(0.15);
  });

  it('a broken day file is an empty day', async () => {
    const rig = new BurnRateRig(MORNING, new MemoryDayFile({ day: 7, slots: 'x' }));
    await rig.book.load();
    rig.see([slotView('claude-a', [week(0.8)])]);
    expect(rig.meter.reading().spent).toBe(0);
  });
});
