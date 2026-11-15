import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseJournal } from '../../core/persona/persona-journal-file';
import type { RunRequest } from '../protocol';
import { settled, waitFor } from './run-spec-support';
import { endTurn, harness, runRequest, startRun, useTempDirs, type Harness } from './supervisor-harness.fake';

const ANSWER = JSON.stringify({
  finding: { cause: 'prompt', text: 'the brief never said how the repo runs its tests' },
  friction: 'guessed the test command',
  lesson: "run the repo's own verify script, not vitest directly",
  proposal: null,
});

const redShell = async (): Promise<void> => {
  throw new Error('exit 1');
};

/** The closing round's worker: it answers once and exits. */
async function answerRound(h: Harness, text: string): Promise<void> {
  await waitFor(() => expect(h.adapter.handles).toHaveLength(2));
  h.adapter.handles[1]!.emit({ kind: 'result', text, tokensIn: 100, tokensOut: 20 });
  h.adapter.handles[1]!.fail(0);
}

describe('the closing round after the gate verdict (R14, req-169)', () => {
  const dirs = useTempDirs();
  const request = (over: Partial<RunRequest> = {}): RunRequest => runRequest(dirs.vault, over);
  const personaFile = (name: string): string => path.join(dirs.vault, 'tickets', '_meta', 'personas', 'pia', name);
  const read = (name: string): Promise<string | null> => fsp.readFile(personaFile(name), 'utf8').catch(() => null);

  it('a dispatched persona stamps RunInfo.persona at start; a ring run carries null', async () => {
    const { sup } = harness(dirs.fleet);
    const started = await sup.start(request(), { persona: 'pia' });
    expect(started.ok && started.run.persona).toBe('pia');
    const ring = await harness(dirs.fleet).sup.start(request());
    expect(ring.ok ? ring.run.persona : 'refused').toBeNull();
  });

  it('a smooth green run costs no round and writes nothing — no memory line, no journal entry', async () => {
    const h = harness(dirs.fleet);
    const id = await startRun(h.sup, request(), 'pia');
    endTurn(h.adapter.handles[0]!);
    await settled(h.sup, id, 'done');
    expect(h.adapter.handles).toHaveLength(1);
    expect(await read('memory.md')).toBeNull();
    expect(await read('reviews.md')).toBeNull();
  });

  it('a red gate triggers ONE round into the same session: a journal entry and one lesson', async () => {
    const h = harness(dirs.fleet, { execShell: redShell });
    const id = await startRun(h.sup, request({ model: 'sonnet' }), 'pia');
    h.adapter.starts[0]!.onSessionRef('sess-1');
    h.adapter.handles[0]!.result();
    h.adapter.handles[0]!.fail(1);
    await answerRound(h, ANSWER);
    await settled(h.sup, id, 'failed');
    const round = h.adapter.starts[1]!;
    expect(round.resumeRef).toBe('sess-1');
    expect(round.permissionMode).toBe('read-only');
    expect(round.instruction).toContain('the machine gate is red');
    const [entry] = parseJournal((await read('reviews.md')) ?? '');
    expect(entry).toMatchObject({ ticket: 'T-0001', persona: 'pia', harness: 'opencode', model: 'sonnet', gate: 'red', signals: ['red-gate'] });
    expect(entry?.finding).toEqual({ cause: 'prompt', text: 'the brief never said how the repo runs its tests' });
    expect(await read('memory.md')).toContain("- 2026-10-17 · T-0001 · pia/sonnet · run the repo's own verify script, not vitest directly");
    expect(h.sup.get(id)?.tokensIn).toBe(100); // the round's spend is the run's
  });

  it('a run without a session ref still journals its facts and says why; no lesson', async () => {
    const h = harness(dirs.fleet, { execShell: redShell });
    const id = await startRun(h.sup, request(), 'pia');
    h.adapter.handles[0]!.result();
    h.adapter.handles[0]!.fail(1);
    await settled(h.sup, id, 'failed');
    expect(h.adapter.handles).toHaveLength(1);
    const [entry] = parseJournal((await read('reviews.md')) ?? '');
    expect(entry?.note).toBe('round skipped — the worker reported no session to resume');
    expect(await read('memory.md')).toBeNull();
  });

  it("the worker's FRICTION: line on a green run is a signal and lands as the entry's friction", async () => {
    const h = harness(dirs.fleet);
    const id = await startRun(h.sup, request(), 'pia');
    h.adapter.starts[0]!.onSessionRef('sess-2');
    h.adapter.handles[0]!.emit({ kind: 'result', text: 'Done.\nFRICTION: the brief named no test command' });
    h.adapter.handles[0]!.fail(0);
    await answerRound(h, '{"finding":null,"friction":null,"lesson":null,"proposal":null}');
    await settled(h.sup, id, 'done');
    const [entry] = parseJournal((await read('reviews.md')) ?? '');
    expect(entry).toMatchObject({ gate: 'green', signals: ['friction'], friction: 'the brief named no test command', finding: null });
    expect(await read('memory.md')).toBeNull(); // no lesson offered, none written
  });

  it('pipeline.md\'s list narrows the signals: a red gate outside the list costs no round', async () => {
    const h = harness(dirs.fleet, { execShell: redShell });
    const id = await startRun(h.sup, request({ closing: { signals: ['friction'], retry: false } }), 'pia');
    h.adapter.starts[0]!.onSessionRef('sess-3');
    h.adapter.handles[0]!.result();
    h.adapter.handles[0]!.fail(1);
    await settled(h.sup, id, 'failed');
    expect(h.adapter.handles).toHaveLength(1);
    expect(await read('reviews.md')).toBeNull();
  });
});
