import { describe, expect, it, vi } from 'vitest';
import type { RunSupervisorDeps } from '../runner/compose-supervisor';
import type { RunRequest } from '../protocol';
import { FakeTicketStore } from './ticket-store.fake';
import { settled } from '../runner/run-spec-support';
import { buildRequest, DK_TARGET, endTurn, harness, startRun, useTempDirs, type Harness } from '../runner/supervisor-harness.fake';

/** The run's claim (E14-5, ADR-0090): kept alive, lost on exit 13, and the epoch the commit trailers carry. */
describe('RunClaims — the lease of a run', () => {
  const dirs = useTempDirs();
  const request = (over: Partial<RunRequest> = {}): RunRequest => buildRequest(dirs.vault, over);
  const setup = (deps: Partial<RunSupervisorDeps> = {}): Harness => harness(dirs.fleet, deps, new FakeTicketStore());

  it('exit 13 on an extension stops the worker, fails the run and writes nothing more', async () => {
    const t = setup();
    const id = await startRun(t.sup, request());
    t.store.loseClaim();
    await t.timers.fire();
    await settled(t.sup, id, 'failed');
    expect(t.adapter.handles[0]!.stop).toHaveBeenCalled();
    expect(t.store.of('release')).toHaveLength(0);
    expect(t.store.of('comment')).toHaveLength(0);
    expect(t.sup.get(id)?.gateFailure).toContain('claim lost');
  });

  it('exit 13 on the release (taken over during the gate) is a failed move, never a second write', async () => {
    const t = setup();
    const id = await startRun(t.sup, request({ cursor: { at: 1, length: 2 } })); // the green end hands on by the cursor — the move that fails
    t.adapter.handles[0]!.result();
    t.store.loseClaim();
    t.adapter.handles[0]!.fail(0);
    await settled(t.sup, id, 'failed');
    expect(t.store.of('release')).toHaveLength(0);
  });

  it('trailers: the worker is told the epoch and a trailer-less branch is a red gate', async () => {
    const validate = vi.fn(async () => 'commit abc123 has no Dricket-Epoch trailer');
    const t = setup({ validateTrailers: validate });
    const id = await startRun(t.sup, request({ baseRef: 'main', dk: { ...DK_TARGET, trailers: true } }));
    const instruction = t.adapter.starts[0]!.instruction;
    expect(instruction).toContain('Dricket-Ticket: t-1');
    expect(instruction).toContain('Dricket-Epoch: 1');
    expect(instruction).toContain('Dricket-Actor: agent-r-');
    endTurn(t.adapter.handles[0]!);
    await settled(t.sup, id, 'failed');
    expect(validate).toHaveBeenCalledWith(expect.objectContaining({ trailers: true }), 'W:/fleet-worktrees/T-0001', 'main..HEAD');
    expect(t.sup.get(id)?.gateFailure).toContain('no Dricket-Epoch trailer');
    expect(t.store.of('release').map((c) => c.stage)).toEqual(['prioritized']);
  });
});
