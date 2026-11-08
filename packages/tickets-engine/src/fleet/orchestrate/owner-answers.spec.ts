import { describe, expect, it } from 'vitest';
import type { RunRequest } from '../protocol';
import { waitFor } from './run-spec-support';
import { harness, runnerNotes, runRequest, startRun, useTempDirs } from './supervisor-harness.fake';

/** What a worker waits for, and the owner's answers to it (req-64). The runner's lines are stream notes since req-176. */
describe('OwnerAnswers — approvals and question forms', () => {
  const dirs = useTempDirs();
  const request = (over: Partial<RunRequest> = {}): RunRequest => runRequest(dirs.vault, over);
  const notesSay = async (runId: string, text: string): Promise<boolean> => (await runnerNotes(dirs.fleet, runId)).some((line) => line.includes(text));

  it('a waiting worker is recorded with its question and logged; the answer is no takeover (req-64)', async () => {
    const { sup, adapter } = harness(dirs.fleet);
    const runId = await startRun(sup, request());
    adapter.starts[0]!.onEvent({ ts: '2026-10-20T10:05:00Z', kind: 'usage', waiting: { kind: 'question', text: 'Which API?' } });
    await waitFor(async () => {
      expect(sup.get(runId)?.waiting).toEqual({ kind: 'question', text: 'Which API?', since: '2026-10-20T10:05:00Z' });
      expect(await notesSay(runId, 'asks the owner — Which API?')).toBe(true);
    });

    expect((await sup.send(runId, 'v2')).ok).toBe(true);
    expect(adapter.handles[0]!.setHold).not.toHaveBeenCalled();
    expect(sup.get(runId)?.held).not.toBe(true);
    expect(await notesSay(runId, 'answered by the owner: v2')).toBe(true);

    adapter.starts[0]!.onEvent({ ts: '2026-10-20T10:06:00Z', kind: 'usage', waiting: null });
    await waitFor(() => expect(sup.get(runId)?.waiting).toBeNull());
  });

  it("passes the owner's approval to the worker, and refuses when nothing waits for one (req-64)", async () => {
    const { sup, adapter } = harness(dirs.fleet);
    const runId = await startRun(sup, request());
    expect((await sup.answerPermission(runId, 'once')).ok).toBe(false);

    adapter.starts[0]!.onEvent({ ts: '2026-10-20T10:05:00Z', kind: 'usage', waiting: { kind: 'permission', text: 'bash rm -rf dist', requestId: 'per_1' } });
    await waitFor(() => expect(sup.get(runId)?.waiting?.kind).toBe('permission'));
    expect((await sup.answerPermission(runId, 'reject')).ok).toBe(true);
    expect(adapter.handles[0]!.answerPermission).toHaveBeenCalledWith('per_1', 'reject');
    expect(await notesSay(runId, 'rejected by the owner — bash rm -rf dist')).toBe(true);
  });

  it("answers a question form with the owner's choices or typed words — no takeover, no prompt", async () => {
    const { sup, adapter } = harness(dirs.fleet);
    const runId = await startRun(sup, request());
    expect((await sup.answerQuestion(runId, { q0: 'Rebase' })).ok).toBe(false);

    const questions = [{ key: 'q0', header: 'Merge', question: 'How should I merge?', options: [{ label: 'Rebase' }, { label: 'Merge' }], multiple: false }];
    adapter.starts[0]!.onEvent({ ts: '2026-10-20T10:05:00Z', kind: 'usage', waiting: { kind: 'question', text: 'How should I merge?', requestId: 'frm_1', questions } });
    await waitFor(() => expect(sup.get(runId)?.waiting?.requestId).toBe('frm_1'));
    expect((await sup.answerQuestion(runId, { q0: 'Rebase' })).ok).toBe(true);
    expect(adapter.handles[0]!.answerQuestion).toHaveBeenLastCalledWith('frm_1', { q0: 'Rebase' });

    expect((await sup.send(runId, '2')).ok).toBe(true);
    expect(adapter.handles[0]!.answerQuestion).toHaveBeenLastCalledWith('frm_1', { q0: 'Merge' });
    expect(adapter.handles[0]!.steer).not.toHaveBeenCalled();
    expect(adapter.handles[0]!.setHold).not.toHaveBeenCalled();
    expect(await notesSay(runId, 'answered by the owner: Merge')).toBe(true);
  });
});
