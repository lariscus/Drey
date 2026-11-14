import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ClosingRoundWrite, ClosingRoundWritten } from '../../contracts/persona-run-records';
import { parseJournal } from '../../core/persona-journal-file';
import type { RunRequest } from '../protocol';
import type { PersonaRecordsChannel } from './engine-round-records';
import { settled, waitFor } from './run-spec-support';
import { harness, runnerNotes, runRequest, startRun, useTempDirs, type Harness } from './supervisor-harness.fake';

/** req-225 / req-226 on the runner's side: the round's records go to the engine as one write, and a run that saved its lesson gets none. */

const ANSWER = JSON.stringify({ finding: { cause: 'prompt', text: 'no test command' }, friction: null, lesson: "run the repo's verify script", proposal: null });

const redShell = async (): Promise<void> => {
  throw new Error('exit 1');
};

async function answerRound(h: Harness, text: string): Promise<void> {
  await waitFor(() => expect(h.adapter.handles).toHaveLength(2));
  h.adapter.handles[1]!.emit({ kind: 'result', text, tokensIn: 10, tokensOut: 5 });
  h.adapter.handles[1]!.fail(0);
}

/** A channel that records what it was handed and answers as told. */
function channel(reply: (write: ClosingRoundWrite) => ClosingRoundWritten | null): PersonaRecordsChannel & { writes: ClosingRoundWrite[] } {
  const writes: ClosingRoundWrite[] = [];
  return {
    writes,
    closingRound: (write) => {
      writes.push(write);
      return Promise.resolve(reply(write));
    },
  };
}

/** The vault MCP's audit line of a memory_write that went through (req-226). */
function lessonSaved(h: Harness): void {
  h.adapter.handles[0]!.emit({ kind: 'tool', tool: 'mcp__drey__memory_write', detail: 'audit', text: 'vault › memory_write', audit: { persona: 'pia', vault: null, path: 'tickets/_meta/personas/pia/memory.md', verdict: 'allowed', ms: 3 } });
}

describe("the closing round's records (req-225, req-226)", () => {
  const dirs = useTempDirs();
  const request = (over: Partial<RunRequest> = {}): RunRequest => runRequest(dirs.vault, over);
  const read = (name: string): Promise<string | null> => fsp.readFile(path.join(dirs.vault, 'tickets', '_meta', 'personas', 'pia', name), 'utf8').catch(() => null);

  it('with the engine wired, the round is ONE write to it — journal entry, lesson line, run start — and nothing plain on disk', async () => {
    const engine = channel(() => ({ ok: true, lesson: 'the line', proposal: null }));
    const h = harness(dirs.fleet, { execShell: redShell, personaRecords: engine });
    const id = await startRun(h.sup, request({ model: 'sonnet' }), 'pia');
    h.adapter.starts[0]!.onSessionRef('sess-1');
    h.adapter.handles[0]!.result();
    h.adapter.handles[0]!.fail(1);
    await answerRound(h, ANSWER);
    await settled(h.sup, id, 'failed');
    expect(engine.writes).toHaveLength(1);
    expect(engine.writes[0]).toMatchObject({ vaultPath: dirs.vault, persona: 'pia', ticket: 'T-0001', lesson: "- 2026-10-17 · T-0001 · pia/sonnet · run the repo's verify script", proposal: null });
    expect(engine.writes[0]!.journal).toMatchObject({ gate: 'red', finding: { cause: 'prompt', text: 'no test command' } });
    expect(engine.writes[0]!.runStartedAt).toBe(h.sup.get(id)?.startedAt);
    expect(await read('reviews.md')).toBeNull();
    expect(await runnerNotes(dirs.fleet, id)).toContain('closing round done — journal entry written, one memory lesson (one commit)');
  });

  it('an engine that is down, or holds another vault, leaves the round to the plain writes', async () => {
    for (const reply of [null, { ok: false as const, error: 'another vault', foreign: true as const }]) {
      const h = harness(dirs.fleet, { execShell: redShell, personaRecords: channel(() => reply) });
      const id = await startRun(h.sup, request(), 'pia');
      h.adapter.starts[0]!.onSessionRef('sess-2');
      h.adapter.handles[0]!.result();
      h.adapter.handles[0]!.fail(1);
      await answerRound(h, ANSWER);
      await settled(h.sup, id, 'failed');
    }
    expect(parseJournal((await read('reviews.md')) ?? '')).toHaveLength(2);
    expect((await read('memory.md'))?.match(/verify script/g)).toHaveLength(1); // the second round's same lesson is not written twice
  });

  it("a run whose worker saved its lesson through memory_write: the round's prompt says so and no lesson is written", async () => {
    const engine = channel(() => ({ ok: true, lesson: null, proposal: null }));
    const h = harness(dirs.fleet, { execShell: redShell, personaRecords: engine });
    const id = await startRun(h.sup, request(), 'pia');
    h.adapter.starts[0]!.onSessionRef('sess-3');
    lessonSaved(h);
    h.adapter.handles[0]!.result();
    h.adapter.handles[0]!.fail(1);
    await answerRound(h, ANSWER);
    await settled(h.sup, id, 'failed');
    expect(h.adapter.starts[1]!.instruction).toContain('you already saved this run\'s one lesson with memory_write');
    expect(engine.writes[0]!.lesson).toBeNull();
    expect(await runnerNotes(dirs.fleet, id)).toContain('closing round done — journal entry written, the run saved its lesson itself (one commit)');
  });
});
