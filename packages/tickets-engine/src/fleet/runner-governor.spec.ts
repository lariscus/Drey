import { describe, expect, it } from 'vitest';
import type { RunInfo, SlotView } from './protocol';
import { lightTotalOf, seedsOf } from './runner-governor';

const slot = (total: number | null): SlotView => ({ total }) as unknown as SlotView;
const run = (over: Partial<RunInfo>): RunInfo => ({ id: 'R-1', ticketId: 'T-1', worktreePath: '/wt/a', pid: 7, state: 'running', ...over }) as unknown as RunInfo;

describe('runner-governor', () => {
  it('sums the slots sessions as the light total, null when a slot has no cap or none exist', () => {
    expect(lightTotalOf([slot(2), slot(3), slot(1)])).toBe(6);
    expect(lightTotalOf([slot(2), slot(null)])).toBeNull();
    expect(lightTotalOf([])).toBeNull();
  });

  it('seeds the live runs a restart found, with their recorded dev port', () => {
    expect(seedsOf([run({ devPort: 4302 }), run({ id: 'R-2', state: 'done' }), run({ id: 'R-3', pid: null })])).toEqual([
      { runId: 'R-1', ticket: 'T-1', worktree: '/wt/a', pid: 7, devPort: 4302 },
      { runId: 'R-3', ticket: 'T-1', worktree: '/wt/a', pid: null, devPort: null },
    ]);
  });
});
