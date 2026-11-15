import { describe, expect, it } from 'vitest';
import type { RunRequest } from '../protocol';
import { settled, waitFor } from './run-spec-support';
import { HANDBACK_CONTINUE } from './steer-service';
import { harness, runnerNotes, runRequest, startRun, useTempDirs } from './supervisor-harness.fake';

describe('RunTakeover — the owner takes a live run over, pauses it and hands it back', () => {
  const dirs = useTempDirs();
  const request = (over: Partial<RunRequest> = {}): RunRequest => runRequest(dirs.vault, over);

  it('takeover holds the run, an interrupt takes over by itself, release hands it back', async () => {
    const { sup, adapter } = harness(dirs.fleet);
    const runId = await startRun(sup, request());
    const handle = adapter.handles[0]!;

    expect((await sup.takeover(runId)).ok).toBe(true);
    expect(handle.setHold).toHaveBeenLastCalledWith(true);
    expect(sup.get(runId)?.held).toBe(true);

    expect((await sup.interrupt(runId)).ok).toBe(true);
    expect(handle.interrupt).toHaveBeenCalledTimes(1);

    expect((await sup.release(runId)).ok).toBe(true);
    expect(handle.setHold).toHaveBeenLastCalledWith(false);
    expect(sup.get(runId)?.held).toBe(false);
  });

  it('handing back a paused worker continues the step instead of ending it for the gate', async () => {
    const { sup, adapter, gate } = harness(dirs.fleet);
    const runId = await startRun(sup, request());
    const handle = adapter.handles[0]!;

    expect((await sup.interrupt(runId)).ok).toBe(true);
    handle.result(); // the interrupted turn's own result — not a completion
    expect((await sup.release(runId)).ok).toBe(true);
    expect(handle.steer).toHaveBeenCalledWith(HANDBACK_CONTINUE);
    expect(sup.get(runId)?.state).toBe('running');

    // The worker exits without a result of its own after the hand-back:
    // no agent-done was ever declared, so the step fails instead of gating.
    handle.fail(0);
    await settled(sup, runId, 'failed');
    expect(gate).toEqual([]);
  });

  it('a plain release without a pause does not prompt the worker', async () => {
    const { sup, adapter } = harness(dirs.fleet);
    const runId = await startRun(sup, request());
    expect((await sup.takeover(runId)).ok).toBe(true);
    expect((await sup.release(runId)).ok).toBe(true);
    expect(adapter.handles[0]!.steer).not.toHaveBeenCalled();
  });

  it('an interrupt of a run nobody holds takes it over first', async () => {
    const { sup, adapter } = harness(dirs.fleet);
    const runId = await startRun(sup, request());
    expect((await sup.interrupt(runId)).ok).toBe(true);
    expect(adapter.handles[0]!.setHold).toHaveBeenCalledWith(true);
    expect(sup.get(runId)?.held).toBe(true);
    expect(await runnerNotes(dirs.fleet, runId)).toContain('taken over by the owner (interrupt)');
  });

  it('a soft pause waits for the end of the current action, then interrupts', async () => {
    const { sup, adapter } = harness(dirs.fleet);
    const runId = await startRun(sup, request());
    const handle = adapter.handles[0]!;

    expect((await sup.pauseAfterAction(runId)).ok).toBe(true);
    expect(handle.interrupt).not.toHaveBeenCalled(); // asked, not yet done
    handle.onEvent('bash npm test'); // a call starting is not the end of an action
    expect(handle.interrupt).not.toHaveBeenCalled();
    handle.onEvent('result › 41 passed');
    await waitFor(() => expect(handle.interrupt).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(sup.get(runId)!.paused).toBe(true));
  });

  it('refuses a takeover for a worker that cannot be held, and for an unknown run', async () => {
    const { sup, adapter } = harness(dirs.fleet);
    const runId = await startRun(sup, request());
    (adapter.handles[0] as { setHold?: unknown }).setHold = undefined;
    const refused = await sup.takeover(runId);
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.error).toContain('cannot be taken over');
    expect((await sup.takeover('R-nope')).ok).toBe(false);
  });
});
