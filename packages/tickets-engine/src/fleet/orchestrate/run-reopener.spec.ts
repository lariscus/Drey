import { describe, expect, it } from 'vitest';
import type { RunRequest } from '../protocol';
import { harness, runInfo, runRequest, startRun, storedRecord, useTempDirs, writeRecord } from './supervisor-harness.fake';

describe('RunReopener — a detached run resumed in a new run', () => {
  const dirs = useTempDirs();
  const request = (over: Partial<RunRequest> = {}): RunRequest => runRequest(dirs.vault, over);
  const detached = (id: string, sessionRef: string) => runInfo({ id, state: 'detached', sessionRef });

  it('resume ends a detached run and resumes its session in a new run', async () => {
    await writeRecord(dirs.fleet, { request: request(), info: detached('R-gone', 'ses_gone') });
    const { sup, adapter } = harness(dirs.fleet);
    await sup.adopt();

    const outcome = await sup.resume('R-gone');
    expect(outcome.ok).toBe(true);
    expect(sup.get('R-gone')?.state).toBe('stopped');
    expect(adapter.starts).toHaveLength(1);
    expect(adapter.starts[0]!.resumeRef).toBe('ses_gone');
    expect(adapter.starts[0]!.instruction).toContain('session was resumed');
  });

  it('resume strips the stored handover ask from the copied request (T-0049)', async () => {
    await writeRecord(dirs.fleet, { request: request({ handover: 'auto' }), info: detached('R-det', 'ses_det') });
    const { sup } = harness(dirs.fleet);
    await sup.adopt();

    const outcome = await sup.resume('R-det');
    expect(outcome.ok).toBe(true);
    const id = outcome.ok ? outcome.run.id : '';
    expect((await storedRecord(dirs.fleet, id)).request.handover).toBeUndefined();
  });

  it('resume refuses a run that is not detached or never reported a session', async () => {
    const { sup } = harness(dirs.fleet);
    const runId = await startRun(sup, request());
    expect((await sup.resume(runId)).ok).toBe(false);
    expect((await sup.resume('R-nope')).ok).toBe(false);
  });
});
