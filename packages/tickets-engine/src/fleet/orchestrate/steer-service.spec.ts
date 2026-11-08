import { describe, expect, it } from 'vitest';
import type { RunRequest } from '../protocol';
import { settled, waitFor } from './run-spec-support';
import { harness, liveRun, runnerNotes, runRequest, startRun, storedRecord, streamText, useTempDirs } from './supervisor-harness.fake';

describe('SteerService — the owner prompts a run', () => {
  const dirs = useTempDirs();
  const request = (over: Partial<RunRequest> = {}): RunRequest => runRequest(dirs.vault, over);
  const dialog = (): RunRequest => request({ acceptance: [], gate: 'structural', nextPhase: null, nextPhaseDir: null, interactive: 'plan' });

  it('the first prompt takes the run over by itself; opening and watching never do', async () => {
    const { sup, adapter } = harness(dirs.fleet);
    const runId = await startRun(sup, request());
    expect(sup.get(runId)?.held).not.toBe(true);

    expect((await sup.send(runId, 'look at the spec')).ok).toBe(true);
    expect(adapter.handles[0]!.setHold).toHaveBeenLastCalledWith(true);
    expect(sup.get(runId)?.held).toBe(true);
  });

  it('steer reaches the worker and lands in the runner notes', async () => {
    const { sup, adapter } = harness(dirs.fleet);
    const id = await startRun(sup, request());
    // A dispatched run posts its brief at spawn, as before (req-75).
    expect(adapter.starts[0]!.holdAtSpawn).not.toBe(true);

    const sent = await sup.send(id, 'Focus on the parser first');
    expect(sent.ok).toBe(true);
    expect(sent.rung).toBe('inject');
    expect(adapter.handles[0]!.steer).toHaveBeenCalledWith('Focus on the parser first');
    // req-176: the runner's line is a stream note (it was a ticket Log line).
    expect(await runnerNotes(dirs.fleet, id)).toContain('steer (inject): Focus on the parser first');
  });

  it("the owner's first message wraps the quiet brief once; every later send goes bare (req-75)", async () => {
    const { sup, adapter } = harness(dirs.fleet);
    const id = await startRun(sup, dialog());

    expect((await sup.send(id, 'Where does the parser live?')).ok).toBe(true);
    expect(adapter.handles[0]!.steer).toHaveBeenCalledWith('Do the ticket.\n\n---\n\nThe owner starts the dialog:\nWhere does the parser live?');
    // Once, and persisted: quietStart is cleared with the send.
    expect(sup.get(id)?.quietStart).toBeUndefined();
    await waitFor(async () => expect((await storedRecord(dirs.fleet, id)).info.quietStart).toBeUndefined());

    expect((await sup.send(id, 'Start with the lexer')).ok).toBe(true);
    expect(adapter.handles[0]!.steer).toHaveBeenLastCalledWith('Start with the lexer');
  });

  it('a prompt to an ended run reopens its session with the prompt as the first message', async () => {
    const { sup, adapter } = harness(dirs.fleet);
    const id = await startRun(sup, request());
    adapter.handles[0]!.onEvent('session');
    await sup.stop(id, 'pause');
    await settled(sup, id, 'stopped');
    // The fake worker reported no session; give the record one.
    const live = liveRun(sup, id);
    live.info = { ...live.info, sessionRef: 'ses_1' };

    expect((await sup.send(id, '   ')).ok).toBe(false);
    const sent = await sup.send(id, 'Also fix the header');
    expect(sent.ok).toBe(true);
    expect(sent.rung).toBe('resume');
    expect(sent.runId).toBeDefined();
    expect(sent.runId).not.toBe(id);
    expect(adapter.starts[1]!.resumeRef).toBe('ses_1');
    expect(adapter.starts[1]!.instruction).toBe('Also fix the header');
    expect(sup.get(sent.runId!)?.held).toBe(true);
    expect(await streamText(dirs.fleet, sent.runId!)).toContain('you › Also fix the header');
  });
});
