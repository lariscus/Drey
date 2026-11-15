import { describe, expect, it } from 'vitest';
import type { RunInfo } from '../protocol';
import { limitExceeded } from './run-limits';

describe('limitExceeded — the per-run ceilings', () => {
  const info = (over: Partial<RunInfo>): RunInfo => ({ ...({} as RunInfo), ...over });
  const limits = { maxTurns: 100, maxWorkMs: 60 * 60_000 };

  it('lets a run inside both ceilings go on', () => {
    expect(limitExceeded(info({ turns: 40, execMs: 10 * 60_000 }), limits, Date.now())).toBeNull();
  });

  it('stops a run past its turn ceiling', () => {
    expect(limitExceeded(info({ turns: 101 }), limits, Date.now())).toContain('101 turns');
  });

  it('counts closed busy spans plus the open one, not the waits', () => {
    const now = Date.parse('2026-10-31T12:00:00Z');
    const open = info({ execMs: 50 * 60_000, execSince: '2026-10-31T11:45:00Z' });
    expect(limitExceeded(open, limits, now)).toContain('65 min');
    const idle = info({ execMs: 50 * 60_000, execSince: null });
    expect(limitExceeded(idle, limits, now)).toBeNull();
  });

  it('0 means unlimited', () => {
    expect(limitExceeded(info({ turns: 9999, execMs: 9e9 }), { maxTurns: 0, maxWorkMs: 0 }, Date.now())).toBeNull();
  });
});
