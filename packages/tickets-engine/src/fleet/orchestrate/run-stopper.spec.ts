import { describe, expect, it } from 'vitest';
import type { RunRequest } from '../protocol';
import { waitFor } from './run-spec-support';
import { harness, runRequest, startRun, useTempDirs } from './supervisor-harness.fake';

/** The owner's stop: the worker dies first, the release note (req-176: the store's comment) comes with the run's end. */
describe('RunStopper — the owner stops a run', () => {
  const dirs = useTempDirs();
  const request = (over: Partial<RunRequest> = {}): RunRequest => runRequest(dirs.vault, over);

  it("stop kills the worker first and the release note comes with the run's end", async () => {
    const { sup, adapter, store } = harness(dirs.fleet);
    const runId = await startRun(sup, request());

    const outcome = await sup.stop(runId, 'because');
    expect(outcome.ok).toBe(true);
    expect(adapter.handles[0]!.stop).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(sup.get(runId)?.state).toBe('stopped');
      expect(store.of('comment').some((c) => (c.text ?? '').includes('stopped by the owner — because'))).toBe(true);
    });
  });

  it('stop kills the worker and frees the run slot', async () => {
    const { sup, adapter, store } = harness(dirs.fleet);
    const id = await startRun(sup, request());

    const stopped = await sup.stop(id, 'wrong direction');
    expect(stopped.ok).toBe(true);
    expect(adapter.handles[0]!.stop).toHaveBeenCalled();
    await waitFor(() => expect(store.of('release').map((c) => c.stage)).toEqual(['plan', 'prioritized']));
    expect(sup.get(id)?.state).toBe('stopped');
    expect(store.of('comment').at(-1)?.text).toContain('stopped by the owner — wrong direction');
  });
});
