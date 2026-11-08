import { describe, expect, it } from 'vitest';
import { CountingQuotaSource } from './counting-quota-source';
import { FallbackQuotaSource } from './fallback-quota-source';
import { FakeClock, FakeQuotaSource, slot, window } from './routing.fake';

const NOW = new Date('2026-11-09T12:00:00Z');
const hoursAgo = (h: number): Date => new Date(NOW.getTime() - h * 3_600_000);

describe('CountingQuotaSource — the runner counts its own runs', () => {
  it('a slot without a counted run is unknown; after its first run, estimated against the budget', async () => {
    const counting = new CountingQuotaSource(new FakeClock(NOW));
    const copilot = slot({ id: 'copilot', provider: 'opencode', limits: [{ window: 'month', budget: 1000, unit: 'runs' }] });
    const before = await counting.read(copilot);
    expect(before.kind === 'windows' && before.windows[0]).toMatchObject({ name: 'month', remaining: null, reliability: 'unknown', used: 0, limit: 1000 });
    counting.record('copilot', { runId: 'R-1', at: hoursAgo(1), tokens: 50_000 });
    const after = await counting.read(copilot);
    expect(after.kind === 'windows' && after.windows[0]).toMatchObject({ remaining: 0.999, reliability: 'estimated', used: 1, resetsAt: '2026-12-01T00:00:00.000Z' });
  });

  it('a rolling window counts only its span, and resets when its oldest run drops out', async () => {
    const counting = new CountingQuotaSource(new FakeClock(NOW));
    const glm = slot({ id: 'glm', limits: [{ window: '5h', budget: 1_000_000, unit: 'tokens' }] });
    counting.record('glm', { runId: 'old', at: hoursAgo(6), tokens: 900_000 });
    counting.record('glm', { runId: 'a', at: hoursAgo(3), tokens: 200_000 });
    counting.record('glm', { runId: 'b', at: hoursAgo(1), tokens: 100_000 });
    counting.record('glm', { runId: 'b', at: hoursAgo(1), tokens: 100_000 });
    const reading = await counting.read(glm);
    expect(reading.kind === 'windows' && reading.windows[0]).toMatchObject({ used: 300_000, remaining: 0.7, resetsAt: '2026-11-09T14:00:00.000Z' });
  });

  it('without a budget it reports what it counted this week, and no share', async () => {
    const counting = new CountingQuotaSource(new FakeClock(NOW));
    counting.record('kimi', { runId: 'R-1', at: hoursAgo(2), tokens: 1234 });
    const reading = await counting.read(slot({ id: 'kimi', provider: 'kimi' }));
    expect(reading.kind === 'windows' && reading.windows[0]).toMatchObject({ name: '7d', remaining: null, reliability: 'unknown', used: 1234, unit: 'tokens' });
    expect(counting.counted('kimi')).toBe(true);
  });
});

describe("FallbackQuotaSource — the provider's readout, the counting behind it", () => {
  const claude = slot({ id: 'claude-a' });

  it("the provider's known windows win; a refused login stays a refused login", async () => {
    const primary = new FakeQuotaSource();
    const fallback = new FakeQuotaSource();
    fallback.readings.set('claude-a', { kind: 'windows', windows: [window({ reliability: 'estimated' })] });
    primary.readings.set('claude-a', { kind: 'windows', windows: [window({ remaining: 0.9 })] });
    expect(await new FallbackQuotaSource(primary, fallback).read(claude)).toEqual({ kind: 'windows', windows: [window({ remaining: 0.9 })] });
    primary.readings.set('claude-a', { kind: 'login', detail: 'refused' });
    expect(await new FallbackQuotaSource(primary, fallback).read(claude)).toEqual({ kind: 'login', detail: 'refused' });
  });

  it("an unavailable readout falls back to the counting and keeps the provider's reason", async () => {
    const primary = new FakeQuotaSource();
    const fallback = new FakeQuotaSource();
    primary.readings.set('claude-a', { kind: 'unavailable', detail: 'no rate-limit event yet' });
    fallback.readings.set('claude-a', { kind: 'windows', windows: [window({ reliability: 'estimated' })] });
    expect(await new FallbackQuotaSource(primary, fallback).read(claude)).toEqual({ kind: 'windows', windows: [window({ reliability: 'estimated' })], detail: 'no rate-limit event yet' });
  });

  it('a readout that throws is unavailable', async () => {
    const throwing = { read: (): Promise<never> => Promise.reject(new Error('socket hang up')) };
    const fallback = new FakeQuotaSource();
    expect(await new FallbackQuotaSource(throwing, fallback).read(claude)).toEqual({ kind: 'unavailable', detail: 'socket hang up' });
  });
});
