import { describe, expect, it } from 'vitest';
import type { PoolGrantRecord, RunRequest } from '../protocol';
import type { BindContext, SlotBinder } from './slot-binder';
import { settled } from './run-spec-support';
import { harness, runRequest, streamText, useTempDirs } from './supervisor-harness.fake';

/** A slot binder that records what the start asked, and binds or refuses as the spec says. */
class FakeSlots implements SlotBinder {
  readonly binds: { runId: string; prefer: string | null; profile: string | undefined }[] = [];
  readonly released: string[] = [];
  refuse: string | null = null;
  grant: PoolGrantRecord | null = null;
  persona: (string | null)[] = [];

  bind(request: RunRequest, runId: string, context: BindContext): { id: string; label: string; grant?: PoolGrantRecord } | { refused: string } {
    this.binds.push({ runId, prefer: context.prefer, profile: request.profile });
    this.persona.push(context.persona);
    if (this.refuse !== null) {
      return { refused: this.refuse };
    }
    return this.grant === null ? { id: 'claude-b', label: 'Claude B' } : { id: 'claude-b', label: 'Claude B', grant: this.grant };
  }

  release(runId: string): void {
    this.released.push(runId);
  }

  envOf(slotId: string): Readonly<Record<string, string>> | undefined {
    return slotId === 'claude-b' ? { CLAUDE_CONFIG_DIR: '/home/u/.claude-b' } : undefined;
  }
}

describe('RunStarter — the slot a run starts on (req-177)', () => {
  const dirs = useTempDirs();
  const request = (over: Partial<RunRequest> = {}): RunRequest => runRequest(dirs.vault, over);

  it("binds a slot, records it on the run, and spawns the worker as the slot's account", async () => {
    const slots = new FakeSlots();
    const { sup, adapter } = harness(dirs.fleet, { slots });
    const outcome = await sup.start(request({ profile: 'work' }));
    expect(outcome.ok && outcome.run.slot).toEqual({ id: 'claude-b', label: 'Claude B' });
    expect(slots.binds).toEqual([{ runId: outcome.ok ? outcome.run.id : '', prefer: null, profile: 'work' }]);
    expect(adapter.starts[0]?.env).toEqual({ CLAUDE_CONFIG_DIR: '/home/u/.claude-b' });
    expect(await streamText(dirs.fleet, outcome.ok ? outcome.run.id : '')).toContain('slot: Claude B');
  });

  it("req-170: the pool's grant lands on the run record and in its stream, and the binder hears the persona", async () => {
    const slots = new FakeSlots();
    slots.grant = { requested: 'B', class: 'B', model: 'claude-sonnet-4-5', cost: 1, reason: 'claude-sonnet-4-5, class B, cost 1 on Claude B — part M' };
    const { sup } = harness(dirs.fleet, { slots });
    const outcome = await sup.start(request(), { persona: 'ben' });
    expect(outcome.ok && outcome.run.grant).toEqual(slots.grant);
    expect(slots.persona).toEqual(['ben']);
    expect(await streamText(dirs.fleet, outcome.ok ? outcome.run.id : '')).toContain('pool: claude-sonnet-4-5, class B, cost 1 on Claude B — part M');
  });

  it('a refused slot refuses the start: nothing is claimed, nothing spawns', async () => {
    const slots = new FakeSlots();
    slots.refuse = 'no work slot serves claude-code';
    const { sup, adapter, store, logs } = harness(dirs.fleet, { slots });
    const outcome = await sup.start(request({ profile: 'work' }));
    expect(outcome).toEqual({ ok: false, error: 'no work slot serves claude-code' });
    expect(adapter.starts).toHaveLength(0);
    expect(store.calls).toEqual([]);
    expect(logs.some((line) => line.includes('refused — no work slot serves claude-code'))).toBe(true);
  });

  it('a start that fails after the binding frees the slot again', async () => {
    const slots = new FakeSlots();
    const { sup } = harness(dirs.fleet, {
      slots,
      prepareWorktree: () => Promise.reject(new Error('disk full')),
    });
    const outcome = await sup.start(request());
    expect(outcome.ok).toBe(false);
    expect(slots.released).toEqual([slots.binds[0]?.runId]);
  });

  it("prefers the slot of the ticket's latest run (where its session lives)", async () => {
    const slots = new FakeSlots();
    const { sup } = harness(dirs.fleet, { slots });
    const first = await sup.start(request());
    expect(first.ok).toBe(true);
    await sup.stop(first.ok ? first.run.id : '', 'next step');
    await settled(sup, first.ok ? first.run.id : '', 'stopped');
    await sup.start(request());
    expect(slots.binds.map((b) => b.prefer)).toEqual([null, 'claude-b']);
  });

  it('without slots a run binds none and spawns with the inherited environment', async () => {
    const { sup, adapter } = harness(dirs.fleet);
    const outcome = await sup.start(request());
    expect(outcome.ok && outcome.run.slot).toBeUndefined();
    expect(adapter.starts[0]?.env).toBeUndefined();
  });
});
