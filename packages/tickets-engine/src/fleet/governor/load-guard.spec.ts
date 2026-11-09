import { describe, expect, it } from 'vitest';
import { FakeSystemLoad } from '../ports/system-load.fake';
import { LoadGuard } from './load-guard';

describe('LoadGuard', () => {
  it('refuses nothing before the first sample or with no reserve', () => {
    const load = new FakeSystemLoad();
    const guard = new LoadGuard(load);
    expect(guard.verdict(25)).toEqual({ ok: true });
    load.next = { cpu: 99, memory: 99 };
    guard.sample();
    expect(guard.verdict(0)).toEqual({ ok: true });
  });

  it('refuses when CPU or memory passes 100 minus the reserve', () => {
    const load = new FakeSystemLoad();
    const guard = new LoadGuard(load);
    load.next = { cpu: 75, memory: 75 };
    guard.sample();
    expect(guard.verdict(25)).toEqual({ ok: true });
    load.next = { cpu: 76, memory: 10 };
    guard.sample();
    expect(guard.verdict(25)).toEqual({ ok: false, load: 76 });
    load.next = { cpu: null, memory: 80 };
    guard.sample();
    expect(guard.verdict(25)).toEqual({ ok: false, load: 80 });
  });
});
