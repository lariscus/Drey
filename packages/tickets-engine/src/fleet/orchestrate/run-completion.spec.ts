import { promises as fsp } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { RunRequest } from '../protocol';
import type { RunSupervisor } from './run-supervisor';
import { ticketCopyPathFor } from '../worktree-home';
import { hasSettled, settled, waitFor } from './run-spec-support';
import { endTurn, harness, runnerNotes, runRequest, startRun, storedRecord, streamText, useTempDirs } from './supervisor-harness.fake';

/**
 * What a worker's exit does to its run (ADR-0077). Since req-176 the
 * ticket is written only through the claim: a move is the release into the
 * next stage, every other end releases where the ticket sat (in the claim
 * stage `plan`: refused, retreated, written back — R-31).
 */
const STAY_PUT = ['plan', 'prioritized'];

describe('RunCompletion — the gate, the move and the other ends', () => {
  const dirs = useTempDirs();
  const request = (over: Partial<RunRequest> = {}): RunRequest => runRequest(dirs.vault, over);
  const notes = (runId: string): Promise<string[]> => runnerNotes(dirs.fleet, runId);

  it('a green worker passes the gate and moves the ticket on (one release)', async () => {
    const { sup, adapter, gate, store } = harness(dirs.fleet);
    const id = await startRun(sup, request());
    expect(sup.get(id)?.state).toBe('running');
    // The ticket carries the live run now: the run's own claim.
    expect(store.of('claim')[0]?.actor).toContain(id.toLowerCase());

    adapter.handles[0]!.onEvent('working…');
    endTurn(adapter.handles[0]!);
    await settled(sup, id, 'done');

    // The gate ran exactly the ticket's commands, in the worktree.
    expect(gate[0]).toEqual(['npm run verify:unit']);
    // The ticket moved to the next phase, in exactly one release.
    expect(store.of('release').map((c) => c.stage)).toEqual(['build']);
    expect(store.stage).toBe('build');
    expect(store.of('comment').at(-1)?.text).toContain('moving to build');
    expect(await fsp.readdir(dirs.vault).then((names) => names.filter((n) => n !== '_worktrees' && n !== '_workcopy'))).toEqual([]);
  });

  it('a run is `done` in memory before its settle has written the ticket — only onRunSettled marks the end (D-4)', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let holding = 0;
    let runId = '';
    let sup: RunSupervisor | null = null;
    const built = harness(dirs.fleet);
    sup = built.sup;
    const storeRelease = built.store.release.bind(built.store);
    // Every release from the moment the run is `done` belongs to the settle.
    built.store.release = async (ticket, options) => {
      if (sup?.get(runId)?.state === 'done') {
        holding++;
        await held;
      }
      return storeRelease(ticket, options);
    };
    // No next phase: the green run's one ticket write is the settle's release.
    runId = await startRun(sup, request({ nextPhase: null, nextPhaseDir: null }));
    endTurn(built.adapter.handles[0]!);
    await waitFor(() => expect(holding).toBe(1));
    // The settle is inside its release: `state` is terminal, the run is not settled.
    expect(sup.get(runId)?.state).toBe('done');
    expect(hasSettled(sup, runId)).toBe(false);
    release();
    await settled(sup, runId, 'done');
    expect(built.store.of('release').map((c) => c.stage)).toEqual(STAY_PUT);
  });

  it('a manual step after the gate parks the ticket in place: the park comment, no move (E10-6)', async () => {
    const { sup, adapter, store } = harness(dirs.fleet);
    const id = await startRun(sup, request({ nextPhase: null, nextPhaseDir: null, parkFor: 'you' }));
    endTurn(adapter.handles[0]!);
    await settled(sup, id, 'done');
    expect(store.of('release').map((c) => c.stage)).toEqual(STAY_PUT);
    expect(store.stage).toBe('plan');
    expect(store.of('comment').at(-1)?.text).toContain('parked for you (manual step)');
  });

  it('a pulled ticket moves into the working column and parks there (E10-6)', async () => {
    const { sup, adapter, store } = harness(dirs.fleet);
    store.stages = [...store.stages, 'qa'];
    const id = await startRun(sup, request({ nextPhase: 'qa', nextPhaseDir: 'qa', parkFor: 'you' }));
    endTurn(adapter.handles[0]!);
    await settled(sup, id, 'done');
    expect(store.of('release').map((c) => c.stage)).toEqual(['qa']);
    const comment = store.of('comment').at(-1)?.text ?? '';
    expect(comment).toContain('moving to qa');
    expect(comment).toContain('parked for you (manual step)');
  });

  it('a red gate fails the run and the ticket stays put', async () => {
    const { sup, adapter, store } = harness(dirs.fleet, { execShell: async () => Promise.reject(new Error('exit 1\nTests failed')) });
    const id = await startRun(sup, request());
    endTurn(adapter.handles[0]!);
    await settled(sup, id, 'failed');
    expect(sup.get(id)?.gateFailure).toContain('exit 1');
    expect(store.of('release').map((c) => c.stage)).toEqual(STAY_PUT); // the slot is free again
    expect(store.of('comment').at(-1)?.text).toMatch(/^failed: /);
    expect((await notes(id)).some((line) => line.startsWith('machine gate failed'))).toBe(true);
  });

  it('a red gate records its verdict, a bounded multi-line failure and a one-line runner note', async () => {
    const { sup, adapter } = harness(dirs.fleet, {
      execShell: async () => {
        const err = new Error('command failed');
        // What promisify(exec) rejects with: stdout and stderr ride the error.
        Object.assign(err, { stdout: 'running tests…', stderr: `${'detail\n'.repeat(600)}FAIL src/a.spec.ts` });
        throw err;
      },
    });
    const id = await startRun(sup, request());
    endTurn(adapter.handles[0]!);
    await settled(sup, id, 'failed');
    const info = sup.get(id)!;
    expect(info.gateResult).toBe('red');
    expect(info.gateFailure).toContain('\n'); // multi-line: the command line, then the output
    expect(info.gateFailure).toContain('FAIL src/a.spec.ts');
    expect(info.gateFailure!.split('\n').length).toBeLessThanOrEqual(400 + 2); // SANITY_CAP + the two heading lines

    // The runner's note keeps the single-line discipline: the failure's first line only.
    const gateLines = (await notes(id)).filter((line) => line.includes('machine gate failed'));
    expect(gateLines).toHaveLength(1);
    expect(gateLines[0]).toContain('machine gate failed — `npm run verify:unit` failed');
    expect(gateLines[0]).not.toContain('detail');
  });

  it('a green gate records its verdict (gateResult on the record)', async () => {
    const { sup, adapter } = harness(dirs.fleet);
    const id = await startRun(sup, request());
    endTurn(adapter.handles[0]!);
    await settled(sup, id, 'done');
    expect(sup.get(id)?.gateResult).toBe('green');
  });

  it('a result that ends BLOCKED: runs no gate and moves nothing — the ticket waits (the refusal half of ADR-0077)', async () => {
    const { sup, adapter, gate, store } = harness(dirs.fleet);
    const id = await startRun(sup, request());
    endTurn(adapter.handles[0]!, 'merge conflict in specs/changelog.md — not resolvable');
    await settled(sup, id, 'done');
    // No gate ran — a green one over the branch would say nothing about the step's own report.
    expect(gate).toHaveLength(0);
    expect(sup.get(id)?.gateResult).toBeNull();
    expect(sup.get(id)?.blocked).toBe('merge conflict in specs/changelog.md — not resolvable');
    // The ticket stays where it sat; no move was performed.
    expect(store.of('release').map((c) => c.stage)).not.toContain('build');
    expect(store.of('comment').at(-1)?.text).toMatch(/^blocked: /);
    // The record is durable: run.json carries the reason.
    expect((await storedRecord(dirs.fleet, id)).info.blocked).toBe('merge conflict in specs/changelog.md — not resolvable');
  });

  it('a worker that ends without a result fails red — the gate never runs', async () => {
    const { sup, adapter, gate, store } = harness(dirs.fleet);
    const id = await startRun(sup, request());
    // A crash (or a spawn that never came up): the turn never finished,
    // so there is no agent-done for the gate to judge.
    adapter.handles[0]!.fail(-1);
    await settled(sup, id, 'failed');

    expect(gate).toEqual([]); // the safety net judges claimed-done work only
    expect(store.of('release').map((c) => c.stage)).toEqual(STAY_PUT); // the slot is free again, the ticket did not move
    expect((await notes(id)).some((line) => line.includes('no agent-done, the step fails'))).toBe(true);
  });

  describe('the structural gate of the plan phase', () => {
    it('a structural run fails red when no acceptance criteria came into existence', async () => {
      const { sup, adapter, gate, store } = harness(dirs.fleet);
      const id = await startRun(sup, request({ acceptance: [], gate: 'structural' }));
      endTurn(adapter.handles[0]!);
      await settled(sup, id, 'failed');

      expect(gate).toEqual([]); // no commands to run — the gate reads instead
      expect(sup.get(id)?.gateFailure).toContain('no executable acceptance criteria');
      expect(store.of('release').map((c) => c.stage)).toEqual(STAY_PUT);
    });

    it('a structural run passes when the plan produced acceptance criteria', async () => {
      const { sup, adapter, gate, store } = harness(dirs.fleet);
      const id = await startRun(sup, request({ acceptance: [], gate: 'structural' }));

      // The plan's deliverable: acceptance criteria appear in the worker's copy of the ticket…
      const copy = ticketCopyPathFor(dirs.vault, 'T-0001');
      const given = await fsp.readFile(copy, 'utf8');
      await fsp.writeFile(copy, given.replace('## Log', '## Plan\n\n### Acceptance criteria\n\n- [ ] `node -e "process.exit(0)"` — exits 0\n\n## Log'), 'utf8');

      // …and the gate reads them as green (no commands to run).
      endTurn(adapter.handles[0]!);
      await settled(sup, id, 'done');
      expect(gate).toEqual([]);
      expect(store.of('release').map((c) => c.stage)).toEqual(['build']);
    });
  });

  describe('the second opinion (M85 quality rungs)', () => {
    it('a second opinion re-runs the step before it moves — once', async () => {
      let opinions = 0;
      const { sup, adapter, store } = harness(dirs.fleet, {
        secondOpinion: async () => {
          opinions += 1;
          return 'You are the sampling auditor — review the step.';
        },
      });
      const id = await startRun(sup, request());

      // The first worker's green gate hands the step to the auditor.
      endTurn(adapter.handles[0]!);
      await waitFor(() => expect(adapter.handles.length).toBe(2));
      // The ticket has not moved yet — the audit round runs first.
      expect(store.of('release')).toHaveLength(0);

      // The auditor's green gate moves the ticket, and no third round starts.
      endTurn(adapter.handles[1]!);
      await settled(sup, id, 'done');
      expect(store.of('release').map((c) => c.stage)).toEqual(['build']);
      expect(opinions).toBe(1);
      expect(adapter.handles).toHaveLength(2);
      expect(await streamText(dirs.fleet, id)).toContain('second opinion');
    });

    it('a red gate in the audit round parks the ticket', async () => {
      let gateCalls = 0;
      const { sup, adapter, store } = harness(dirs.fleet, {
        secondOpinion: async () => 'audit brief',
        execShell: async () => {
          // The first gate is green, the auditor's gate runs the same
          // commands — fail from the second round on via the call count.
          gateCalls += 1;
          if (gateCalls > 1) {
            throw new Error('exit 1\naudit gate red');
          }
        },
      });
      const id = await startRun(sup, request());
      endTurn(adapter.handles[0]!);
      await waitFor(() => expect(adapter.handles.length).toBe(2));
      endTurn(adapter.handles[1]!);
      await settled(sup, id, 'failed');
      expect(store.of('release').map((c) => c.stage)).toEqual(STAY_PUT);
      expect(sup.get(id)?.gateFailure).toContain('exit 1');
      expect(sup.get(id)?.gateResult).toBe('red');
    });
  });
});
