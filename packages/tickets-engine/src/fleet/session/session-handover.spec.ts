import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RunRequest, RunState } from '../protocol';
import { settled, waitFor } from '../runner/run-spec-support';
import { harness, runInfo, runRequest, startRun, storedRecord, streamText, useTempDirs, writeRecord } from '../runner/supervisor-harness.fake';

/** The session handover's resolution (T-0049) and the resume it leads to, driven through the supervisor. */
describe('SessionHandover — which session a start resumes (T-0049)', () => {
  const dirs = useTempDirs();
  const request = (over: Partial<RunRequest> = {}): RunRequest => runRequest(dirs.vault, over);

  /** A settled record the next start may resume — seeded as a runner boot would adopt it (the supervisor's `now` is fixed at 12:00). */
  async function seedRun(
    id: string,
    over: { ticket?: string; model?: string | null; phase?: string; state?: RunState; sessionRef?: string | null; endedAt?: string | null; startedAt?: string; lastTurnContext?: number | null } = {},
  ): Promise<void> {
    const ticket = over.ticket ?? 'T-0001';
    const info = runInfo({
      id,
      ticketId: ticket,
      state: over.state ?? 'failed',
      startedAt: over.startedAt ?? '2026-10-17T10:00:00Z',
      endedAt: over.endedAt === undefined ? '2026-10-17T11:57:00Z' : over.endedAt,
      sessionRef: over.sessionRef ?? `ses_${id}`,
      worktreePath: 'W:/gone',
      branch: `t/${ticket}`,
      ...(over.model !== undefined ? { model: over.model } : {}),
      ...(over.phase !== undefined ? { phase: over.phase } : {}),
      ...(over.lastTurnContext !== undefined ? { lastTurnContext: over.lastTurnContext } : {}),
    });
    const seeded = request({
      ...(ticket !== 'T-0001' ? { ticketId: ticket, branch: `t/${ticket}`, ticketRelPath: `tickets/plan/${ticket}.md` } : {}),
      ...(over.model !== undefined ? { model: over.model } : {}),
      ...(over.phase !== undefined ? { phase: over.phase, ticketRelPath: `tickets/${over.phase}/T-0001.md` } : {}),
    });
    await writeRecord(dirs.fleet, { request: seeded, info });
  }

  it('an auto handover resumes a warm same-phase retry and stamps mode and lineage (T-0049)', async () => {
    await seedRun('R-old', { endedAt: '2026-10-17T11:57:00Z' }); // 3 min before the fixed now
    const { sup, adapter, logs } = harness(dirs.fleet);
    await sup.adopt();

    const id = await startRun(sup, request({ handover: 'auto' }));
    expect(adapter.starts[0]!.resumeRef).toBe('ses_R-old');
    expect(adapter.starts[0]!.compactFirst).not.toBe(true);

    const info = sup.get(id)!;
    expect(info.handoverMode).toBe('resume');
    expect(info.resumedFrom).toBe('ses_R-old');
    expect(info.sessionRef).toBe('ses_R-old');
    // The stamps are durable and the decision is on the record's trail.
    const stored = await storedRecord(dirs.fleet, id);
    expect(stored.info.handoverMode).toBe('resume');
    expect(stored.info.resumedFrom).toBe('ses_R-old');
    expect(await streamText(dirs.fleet, id)).toContain('handover: resume');
    // req-176: the decision is the runner log's line (it was the ticket Log's).
    expect(logs.some((line) => line.includes(`run ${id} (T-0001): handover resume`))).toBe(true);
  });

  it('a resume is prompted with the continuation while the brief is unchanged — the full brief otherwise (req-80)', async () => {
    await seedRun('R-old', { endedAt: '2026-10-17T11:57:00Z' });
    const file = path.join(dirs.fleet, 'runs', 'R-old', 'run.json');
    const seeded = JSON.parse(await fsp.readFile(file, 'utf8')) as { request: Record<string, unknown> };
    seeded.request['briefDigest'] = 'd1';
    await fsp.writeFile(file, JSON.stringify(seeded), 'utf8');

    const same = harness(dirs.fleet);
    await same.sup.adopt();
    const id = await startRun(same.sup, request({ handover: 'auto', briefDigest: 'd1', continuationInstruction: 'Only what changed.' }));
    expect(same.adapter.starts[0]!.resumeRef).toBe('ses_R-old');
    expect(same.adapter.starts[0]!.instruction).toBe('Only what changed.');
    expect(await streamText(dirs.fleet, id)).toContain('brief: continuation');

    await same.sup.stop(id, null);
    await settled(same.sup, id, 'stopped');
    await same.sup.idle();
    await fsp.rm(path.join(dirs.fleet, 'runs', id), { recursive: true, force: true });
    const changed = harness(dirs.fleet);
    await changed.sup.adopt();
    await changed.sup.start(request({ handover: 'auto', briefDigest: 'd2', continuationInstruction: 'Only what changed.' }));
    expect(changed.adapter.starts[0]!.resumeRef).toBe('ses_R-old');
    expect(changed.adapter.starts[0]!.instruction).not.toBe('Only what changed.');
  });

  it('the resolution picks the newest terminal run of the same ticket and model — other tickets and models never', async () => {
    await seedRun('R-match', { startedAt: '2026-10-17T10:00:00Z', endedAt: '2026-10-17T11:57:00Z' });
    await seedRun('R-newer-match', { startedAt: '2026-10-17T10:30:00Z', endedAt: '2026-10-17T11:58:00Z' });
    await seedRun('R-other-ticket', { ticket: 'T-0002', startedAt: '2026-10-17T11:00:00Z' });
    await seedRun('R-other-model', { model: 'glm-x', startedAt: '2026-10-17T11:30:00Z' });
    const { sup, adapter } = harness(dirs.fleet);
    await sup.adopt();

    await sup.start(request({ handover: 'auto' }));
    expect(adapter.starts[0]!.resumeRef).toBe('ses_R-newer-match');
  });

  it('a candidate of another phase (build after plan) resolves fresh (T-0049)', async () => {
    await seedRun('R-plan', { phase: 'plan', endedAt: '2026-10-17T11:57:00Z' });
    const { sup, adapter } = harness(dirs.fleet);
    await sup.adopt();

    const started = await sup.start(request({ ticketRelPath: 'tickets/build/T-0001.md', phase: 'build', handover: 'auto' }));
    expect(started.ok && started.run.handoverMode).toBe('fresh');
    expect(adapter.starts[0]!.resumeRef).toBeNull();
    expect(await streamText(dirs.fleet, started.ok ? started.run.id : '')).toContain('worked the plan phase');
  });

  it('a recreated or moved-aside worktree resolves fresh — the session is stale (T-0049)', async () => {
    await seedRun('R-stale', { endedAt: '2026-10-17T11:57:00Z' });
    const { sup, adapter } = harness(dirs.fleet, {
      prepareWorktree: async () => ({ outcome: 'recreated', sessionInvalidated: true, movedTo: null }),
    });
    await sup.adopt();

    const id = await startRun(sup, request({ handover: 'auto' }));
    expect(sup.get(id)?.handoverMode).toBe('fresh');
    expect(adapter.starts[0]!.resumeRef).toBeNull();
    expect(await streamText(dirs.fleet, id)).toContain('stale');
  });

  it('a session another non-terminal run holds resolves fresh — never double-resumed (T-0049)', async () => {
    // The ticket's candidate session…
    await seedRun('R-held', { endedAt: '2026-10-17T11:57:00Z', sessionRef: 'ses_busy' });
    // …is held by another ticket's live worker (adopted as running).
    await seedRun('R-live2', { ticket: 'T-0002', state: 'running', endedAt: null, sessionRef: 'ses_busy', startedAt: '2026-10-17T11:00:00Z' });
    const { sup, adapter } = harness(dirs.fleet);
    await sup.adopt();

    const id = await startRun(sup, request({ handover: 'auto' }));
    expect(sup.get(id)?.handoverMode).toBe('fresh');
    expect(adapter.starts[0]!.resumeRef).toBeNull();
    expect(await streamText(dirs.fleet, id)).toContain('twice');
  });

  it('a cold pause above the configured threshold resumes with a native compact first (T-0049)', async () => {
    await seedRun('R-big', { endedAt: '2026-10-17T10:00:00Z', sessionRef: 'ses_big', lastTurnContext: 30_000 }); // two hours before the fixed now: cold
    const { sup, adapter } = harness(dirs.fleet);
    await sup.adopt();
    sup.setHandoverConfig({ compactAboveTokens: 20_000, resumePauseTtlMin: 15, contextCapTokens: 160_000 });
    const id = await startRun(sup, request({ handover: 'auto' }));
    expect(adapter.starts[0]!.compactFirst).toBe(true);
    expect(sup.get(id)?.handoverMode).toBe('resume-compact');

    // The same record with the default threshold is below the bar: a plain resume.
    const plain = harness(dirs.fleet);
    await plain.sup.adopt();
    await plain.sup.start(request({ handover: 'auto' }));
    expect(plain.adapter.starts[0]!.compactFirst).not.toBe(true);
  });

  it('a resume the adapter cannot establish respawns fresh under the same run id (T-0049)', async () => {
    await seedRun('R-gone', { sessionRef: 'ses_gone', endedAt: '2026-10-17T11:57:00Z' });
    const { sup, adapter } = harness(dirs.fleet);
    await sup.adopt();

    const id = await startRun(sup, request({ handover: 'resume' }));
    expect(adapter.starts[0]!.resumeRef).toBe('ses_gone');

    adapter.starts[0]!.onResumeFailed!('the session answered HTTP 404');
    await waitFor(() => expect(adapter.starts.length).toBe(2));
    expect(adapter.handles[0]!.stop).toHaveBeenCalled();
    expect(adapter.starts[1]!.resumeRef).toBeNull();
    expect(adapter.starts[1]!.instruction).toBe('Do the ticket.');

    // One run id, fresh stamps, the note on the stream — and the run is alive.
    await waitFor(async () => expect(await streamText(dirs.fleet, id)).toContain('the run starts fresh'));
    const info = sup.get(id)!;
    expect(sup.list().filter((r) => !['done', 'stopped', 'failed'].includes(r.state))).toHaveLength(1);
    expect(info.handoverMode).toBe('fresh');
    expect(info.resumedFrom).toBeNull();

    // The replacement worker's turn decides the run as usual.
    adapter.handles[1]!.result();
    adapter.handles[1]!.fail(0);
    await settled(sup, id, 'done');
  });
});
