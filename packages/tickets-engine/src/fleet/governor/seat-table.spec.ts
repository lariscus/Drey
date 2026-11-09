import { describe, expect, it } from 'vitest';
import { SeatTable } from './seat-table';

const holder = (runId: string) => ({ runId, ticket: runId, task: 'tests' as const, since: '2026-11-09T12:00:00.000Z', pid: null });

describe('SeatTable', () => {
  it('counts seats per class and records who holds them', () => {
    const table = new SeatTable();
    const a = table.take('heavy', holder('r1'));
    table.take('light', holder('r2'));
    table.setPid(a, 42);
    expect(table.busy('heavy')).toBe(1);
    expect(table.busy('light')).toBe(1);
    expect(table.holders('heavy')).toMatchObject([{ runId: 'r1', pid: 42 }]);
  });

  it('releases once', () => {
    const table = new SeatTable();
    const a = table.take('heavy', holder('r1'));
    expect(table.release(a)?.holder.runId).toBe('r1');
    expect(table.release(a)).toBeNull();
    expect(table.has(a)).toBe(false);
  });
});
