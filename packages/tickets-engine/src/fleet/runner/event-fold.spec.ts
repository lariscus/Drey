import { describe, expect, it } from 'vitest';
import type { RunRequest } from '../protocol';
import { waitFor } from './run-spec-support';
import { harness, runRequest, startRun, storedRecord, useTempDirs } from './supervisor-harness.fake';

describe('EventFold — the worker events folded into the record', () => {
  const dirs = useTempDirs();
  const request = (over: Partial<RunRequest> = {}): RunRequest => runRequest(dirs.vault, over);

  it('a reported context window survives later events without it (T-0052)', async () => {
    const { sup, adapter } = harness(dirs.fleet);
    const runId = await startRun(sup, request());
    const fire = adapter.starts[0]!.onEvent;
    fire({ ts: '2026-10-17T12:00:00Z', kind: 'usage', contextWindow: 1_000_000 });
    await waitFor(() => expect(sup.get(runId)?.contextWindow).toBe(1_000_000));
    // A later event without the field must not erase the once-set value.
    fire({ ts: '2026-10-17T12:00:01Z', kind: 'note', text: 'working' });
    await waitFor(() => expect(sup.get(runId)?.lastActivity).toBe('2026-10-17T12:00:01Z'));
    expect(sup.get(runId)?.contextWindow).toBe(1_000_000);
  });

  it('folds the run telemetry into the record as events arrive', async () => {
    const { sup, adapter } = harness(dirs.fleet);
    const id = await startRun(sup, request({ model: 'zai/glm-5.3' }));
    const onEvent = adapter.starts[0]!.onEvent;
    onEvent({ ts: '2026-10-17T12:00:01Z', kind: 'note', text: 'read src/a.ts', tool: 'read' });
    onEvent({ ts: '2026-10-17T12:00:02Z', kind: 'usage', turnUsage: { input: 900, cacheRead: 20_000, cacheCreation: 4_000, output: 210 } });
    onEvent({ ts: '2026-10-17T12:00:03Z', kind: 'note', text: 'edit src/a.ts', tool: 'edit' });
    onEvent({ ts: '2026-10-17T12:00:04Z', kind: 'usage', turnUsage: { input: 1_100, cacheRead: 30_000, cacheCreation: null, output: 300 } });
    await waitFor(() => expect(sup.get(id)?.turns).toBe(2));
    const info = sup.get(id)!;
    expect(info.handoverMode).toBe('fresh');
    expect(info.model).toBe('zai/glm-5.3');
    expect(info.phase).toBe('plan');
    expect(info.turns).toBe(2);
    expect(info.usage).toEqual({ input: 2_000, cacheRead: 50_000, cacheCreation: 4_000, output: 510 });
    expect(info.lastTurnContext).toBe(31_100);
    expect(info.readCalls).toBe(1);
    expect(info.tokensBeforeFirstWrite).toBe(24_900);
    // The record is durable: run.json carries the fields. The write is
    // queued behind the events and truncates before it fills — a read can
    // land on an empty or older file, so it is retried (D-4).
    await waitFor(async () => {
      const stored = await storedRecord(dirs.fleet, id);
      expect(stored.info.turns).toBe(2);
      expect(stored.info.usage).toBeDefined();
    });
  });

  // --- the elapsed clock's busy spans (req-67) -----------------------

  it('the clock presumes working from the start and closes its span when a wait begins', async () => {
    const { sup, adapter } = harness(dirs.fleet);
    const runId = await startRun(sup, request());
    const fire = adapter.starts[0]!.onEvent;
    fire({ ts: '2026-10-17T12:05:00Z', kind: 'usage', turn: 'busy' });
    await waitFor(() => expect(sup.get(runId)?.execSince).toBe('2026-10-17T12:00:00.000Z'));

    fire({ ts: '2026-10-17T12:10:00Z', kind: 'usage', waiting: { kind: 'question', text: 'Which API?' } });
    await waitFor(() => expect(sup.get(runId)).toMatchObject({ execMs: 10 * 60_000, execSince: null }));

    fire({ ts: '2026-10-17T12:15:00Z', kind: 'usage', turn: 'busy', waiting: null });
    await waitFor(() => expect(sup.get(runId)?.execSince).toBe('2026-10-17T12:15:00Z'));
    expect(sup.get(runId)?.execMs).toBe(10 * 60_000);
  });

  it('a standing held worker pauses the clock the same way, and startup counts', async () => {
    const { sup, adapter } = harness(dirs.fleet);
    const runId = await startRun(sup, request());
    const fire = adapter.starts[0]!.onEvent;
    fire({ ts: '2026-10-17T12:10:00Z', kind: 'usage', turn: 'idle' });
    await waitFor(() => expect(sup.get(runId)).toMatchObject({ execMs: 10 * 60_000, execSince: null }));

    fire({ ts: '2026-10-17T12:12:00Z', kind: 'usage', turn: 'busy' });
    await waitFor(() => expect(sup.get(runId)?.execSince).toBe('2026-10-17T12:12:00Z'));
    expect(sup.get(runId)?.execMs).toBe(10 * 60_000);
  });

  it('the clock freezes when the run ends, on the record as well', async () => {
    const { sup, adapter } = harness(dirs.fleet);
    const runId = await startRun(sup, request());
    const fire = adapter.starts[0]!.onEvent;
    // Rapid-fire on purpose: two events, no settling between them — the
    // fold must serialize them in arrival order (the req-67 clock-freeze
    // flake used to let the older idle event land last).
    fire({ ts: '2026-10-17T12:10:00Z', kind: 'usage', turn: 'idle' });
    fire({ ts: '2026-10-17T12:12:00Z', kind: 'usage', turn: 'busy' });
    await waitFor(() => expect(sup.get(runId)?.execSince).toBe('2026-10-17T12:12:00Z'));

    await sup.stop(runId, 'enough');
    await waitFor(async () => {
      expect(sup.get(runId)?.state).toBe('stopped');
      expect((await storedRecord(dirs.fleet, runId)).info).toMatchObject({ execMs: 10 * 60_000, execSince: null });
    });
  });

  // --- req-299: the worker's follow-up proposals ---------------------

  it('a result that ends with FOLLOWUPS: lands the proposals on the record and in run.json; a later result without them clears them', async () => {
    const { sup, adapter } = harness(dirs.fleet);
    const runId = await startRun(sup, request());
    const fire = adapter.starts[0]!.onEvent;
    fire({ ts: '2026-10-17T12:00:00Z', kind: 'note', text: 'working' });
    await waitFor(() => expect(sup.get(runId)?.lastActivity).toBe('2026-10-17T12:00:00Z'));
    expect(sup.get(runId)?.followups).toBeUndefined(); // a run that never proposed keeps the key out of its record

    fire({ ts: '2026-10-17T12:01:00Z', kind: 'result', text: 'Done.\nFOLLOWUPS:\n- Cache the tree\n  why: slow\n  priority: low' });
    await waitFor(() => expect(sup.get(runId)?.followups).toEqual([{ title: 'Cache the tree', why: 'slow', priority: 'low' }]));
    await waitFor(async () => expect((await storedRecord(dirs.fleet, runId)).info.followups).toHaveLength(1));

    fire({ ts: '2026-10-17T12:02:00Z', kind: 'result', text: 'Fixed what the owner asked in the steer.' });
    await waitFor(() => expect(sup.get(runId)?.followups).toEqual([]));
  });
});
