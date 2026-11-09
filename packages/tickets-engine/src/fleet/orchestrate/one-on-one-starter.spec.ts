import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RunRequest } from '../protocol';
import { ONE_ON_ONE_IDLE_MS, ONE_ON_ONE_TICKET } from '../protocol-session';
import { settled, waitFor } from './run-spec-support';
import type { SlotBinder } from './slot-binder';
import { aliveProbe, harness, runnerNotes, runRequest, startRun, useTempDirs } from './supervisor-harness.fake';

/** A 1:1 request as the engine's builder composes it (req-168). */
function oneOnOne(vault: string, over: Partial<RunRequest> = {}): RunRequest {
  const { dk: _dk, ...base } = runRequest(vault, {
    origin: 'drey:1:1',
    ticketId: ONE_ON_ONE_TICKET,
    ticketRelPath: '',
    phase: '',
    worktreePath: vault,
    branch: '',
    acceptance: [],
    gate: 'none',
    nextPhase: null,
    nextPhaseDir: null,
    permissionMode: 'read-only',
    instruction: 'You are Ben. The 1:1 brief.',
    column: null,
    session: { kind: '1:1', persona: 'ben', workingDirectory: vault, chatFile: 'tickets/_meta/chat/20261109-100000-1-1-ben.md' },
    ...over,
  });
  return base;
}

/** A pool door that grants every start and records what is held. */
function recordingSlots(): SlotBinder & { readonly held: Set<string>; readonly personas: (string | null)[] } {
  const held = new Set<string>();
  const personas: (string | null)[] = [];
  return {
    held,
    personas,
    bind: (_request, runId, context) => {
      held.add(runId);
      personas.push(context.persona);
      return { id: 'claude-a', label: 'Claude A' };
    },
    release: (runId) => {
      held.delete(runId);
    },
    envOf: () => undefined,
  };
}

/** A clock the spec moves. */
function movableClock(start: string): { now: () => Date; advance: (ms: number) => void } {
  let at = Date.parse(start);
  return { now: () => new Date(at), advance: (ms) => (at += ms) };
}

describe('OneOnOneStarter — a 1:1 is a quiet, held session of the persona (req-168)', () => {
  const dirs = useTempDirs();

  it('starts the worker quiet and held in the tickets repository, read-only, with no claim and no worktree', async () => {
    let prepared = 0;
    const h = harness(dirs.fleet, { prepareWorktree: async () => ((prepared += 1), { outcome: 'created', sessionInvalidated: false, movedTo: null }) });
    const id = await startRun(h.sup, oneOnOne(dirs.vault));
    const start = h.adapter.starts[0]!;
    expect(start.cwd).toBe(dirs.vault);
    expect(start.permissionMode).toBe('read-only');
    expect(start.holdAtSpawn).toBe(true);
    expect(h.adapter.handles[0]!.setHold).toHaveBeenCalledWith(true);
    expect(prepared).toBe(0);
    expect(h.store.calls).toEqual([]);
    expect(h.sup.get(id)).toMatchObject({ kind: '1:1', persona: 'ben', workingDirectory: dirs.vault, held: true, quietStart: true, column: null, ticketId: ONE_ON_ONE_TICKET });
    expect(await runnerNotes(dirs.fleet, id)).toEqual([expect.stringContaining('1:1 with ben')]);
  });

  it('refuses a second live 1:1 of the same persona, and a request without persona or origin', async () => {
    const h = harness(dirs.fleet);
    await startRun(h.sup, oneOnOne(dirs.vault));
    const second = await h.sup.start(oneOnOne(dirs.vault));
    expect(second).toMatchObject({ ok: false, error: expect.stringContaining('ben already has a live 1:1') });
    const nameless = await h.sup.start(oneOnOne(dirs.vault, { session: { kind: '1:1', persona: ' ', workingDirectory: dirs.vault, chatFile: 'x.md' } }));
    expect(nameless).toMatchObject({ ok: false, error: 'a 1:1 names its persona' });
    const { origin: _o, ...noOrigin } = oneOnOne(dirs.vault, { session: { kind: '1:1', persona: 'paul', workingDirectory: dirs.vault, chatFile: 'x.md' } });
    expect(await h.sup.start(noOrigin)).toMatchObject({ ok: false, error: expect.stringContaining('names no origin') });
    expect(h.adapter.starts).toHaveLength(1);
  });

  it("the owner's first line rides with the brief once, the next one alone", async () => {
    const h = harness(dirs.fleet);
    const id = await startRun(h.sup, oneOnOne(dirs.vault));
    await h.sup.send(id, 'Why did T-0007 fail?');
    await h.sup.send(id, 'And T-0008?');
    const steer = h.adapter.handles[0]!.steer;
    expect(steer).toHaveBeenNthCalledWith(1, expect.stringContaining('You are Ben. The 1:1 brief.'));
    expect(steer).toHaveBeenNthCalledWith(1, expect.stringContaining('Why did T-0007 fail?'));
    expect(steer).toHaveBeenNthCalledWith(2, 'And T-0008?');
    expect(h.sup.get(id)?.quietStart).toBeUndefined();
  });

  it('holds a slot while held and frees it on the idle release; the memory stays unwritten', async () => {
    const clock = movableClock('2026-11-09T10:00:00Z');
    const slots = recordingSlots();
    // The runner's slot listener frees a settled session's reservation (routing/slot-run-listener.ts); the settle hook stands in for it.
    const h = harness(dirs.fleet, { slots, now: clock.now, exec: aliveProbe, onRunSettled: (info) => slots.release(info.id) });
    const id = await startRun(h.sup, oneOnOne(dirs.vault));
    expect(slots.held.has(id)).toBe(true);
    expect(slots.personas).toEqual(['ben']);
    clock.advance(ONE_ON_ONE_IDLE_MS - 1_000);
    await h.sup.reap();
    expect(h.sup.get(id)?.state).toBe('running');
    clock.advance(2_000);
    await h.sup.reap();
    await settled(h.sup, id, 'done');
    expect(h.adapter.handles[0]!.stop).toHaveBeenCalled();
    await waitFor(() => expect(slots.held.has(id)).toBe(false));
    expect(await runnerNotes(dirs.fleet, id)).toContainEqual(expect.stringContaining('released after 15 min idle'));
    await expect(fsp.access(path.join(dirs.vault, 'tickets/_meta/personas/ben/memory.md'))).rejects.toThrow();
  });

  it('never releases in the middle of a turn', async () => {
    const clock = movableClock('2026-11-09T10:00:00Z');
    const h = harness(dirs.fleet, { now: clock.now, oneOnOneIdleMs: 60_000, exec: aliveProbe });
    const id = await startRun(h.sup, oneOnOne(dirs.vault));
    h.adapter.handles[0]!.emit({ kind: 'note', text: 'thinking', turn: 'busy' });
    await waitFor(() => expect(h.sup.get(id)?.turn).toBe('busy'));
    clock.advance(10 * 60_000);
    await h.sup.reap();
    expect(h.sup.get(id)?.state).toBe('running');
  });

  it("the worker's own end ends the session done, without a gate", async () => {
    const h = harness(dirs.fleet);
    const id = await startRun(h.sup, oneOnOne(dirs.vault));
    h.adapter.handles[0]!.result();
    h.adapter.handles[0]!.fail(0);
    await settled(h.sup, id, 'done');
    expect(h.gate).toEqual([]);
    expect(await runnerNotes(dirs.fleet, id)).toContainEqual(expect.stringContaining('1:1 session ended'));
  });
});
