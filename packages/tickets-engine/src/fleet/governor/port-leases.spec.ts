import { describe, expect, it } from 'vitest';
import { PortLeases } from './port-leases';

describe('PortLeases', () => {
  it('leases one port per worktree, the lowest free one', () => {
    const ports = new PortLeases({ from: 4300, to: 4399 });
    expect(ports.lease('C:\\wt\\a', 'r1', 'T-1')).toBe(4300);
    expect(ports.lease('C:\\wt\\b', 'r2', 'T-2')).toBe(4301);
    expect(ports.lease('c:/wt/a/', 'r3', 'T-1')).toBe(4300);
    expect(ports.list().map((l) => [l.port, l.runId])).toEqual([
      [4300, 'r3'],
      [4301, 'r2'],
    ]);
  });

  it('returns a port with its run and hands it out again', () => {
    const ports = new PortLeases({ from: 4300, to: 4399 });
    ports.lease('/a', 'r1', 'T-1');
    ports.lease('/b', 'r2', 'T-2');
    expect(ports.returnFor('r1')?.port).toBe(4300);
    expect(ports.returnFor('r1')).toBeNull();
    expect(ports.lease('/c', 'r3', 'T-3')).toBe(4300);
  });

  it('is null once the range is used up', () => {
    const ports = new PortLeases({ from: 4300, to: 4300 });
    expect(ports.lease('/a', 'r1', 'T-1')).toBe(4300);
    expect(ports.lease('/b', 'r2', 'T-2')).toBeNull();
  });

  it('seeds a restart lease unless another worktree holds the port', () => {
    const ports = new PortLeases({ from: 4300, to: 4399 });
    expect(ports.seed({ port: 4305, worktree: '/a', runId: 'r1', ticket: 'T-1' })).toBe(true);
    expect(ports.seed({ port: 4305, worktree: '/b', runId: 'r2', ticket: 'T-2' })).toBe(false);
    expect(ports.lease('/a', 'r1', 'T-1')).toBe(4305);
  });
});
