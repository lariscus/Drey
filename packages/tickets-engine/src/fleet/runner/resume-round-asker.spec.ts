import { describe, expect, it } from 'vitest';
import type { NormalizedEvent } from '../harness/contract';
import { newLiveRun, type LiveRun } from './live-run';
import type { RoundSpawnPlan } from './process-supervisor';
import { ResumeRoundAsker, type RoundSpawner } from './resume-round-asker';
import { fakeAdapter, runInfo, runRequest, type FakeHandle } from './supervisor-harness.fake';

function run(sessionRef: string | null): LiveRun {
  return newLiveRun({ info: runInfo({ id: 'r-1', sessionRef }), request: runRequest('V:/vault'), dir: 'F:/runs/r-1' });
}

/** A spawner over the fake adapter's handles; `plans` records each round. */
function spawner(): RoundSpawner & { plans: RoundSpawnPlan[]; handles: FakeHandle[] } {
  const fake = fakeAdapter();
  const plans: RoundSpawnPlan[] = [];
  return {
    plans,
    handles: fake.handles,
    spawnRound: (_run, round) => {
      plans.push(round);
      return fake.adapter.spawn({ cwd: '.', instruction: round.instruction, model: null, permissionMode: 'read-only', resumeRef: round.resumeRef, ticketId: 'T-0001', onEvent: round.onEvent, onSessionRef: () => undefined, onResumeFailed: round.onResumeFailed });
    },
  };
}

const never = (): Promise<void> => new Promise(() => undefined);
const now = (): Promise<void> => Promise.resolve();

describe('ResumeRoundAsker (req-169)', () => {
  it('no session ref: no spawn, the round is skipped with its reason', async () => {
    const spawn = spawner();
    const reply = await new ResumeRoundAsker({ spawner: spawn, stream: () => undefined, delay: never }).ask(run(null), 'p');
    expect(reply).toEqual({ kind: 'skipped', reason: 'the worker reported no session to resume' });
    expect(spawn.plans).toHaveLength(0);
  });

  it("resumes the run's session; the result text is the answer, its events reach the run's stream", async () => {
    const spawn = spawner();
    const streamed: NormalizedEvent[] = [];
    const asked = new ResumeRoundAsker({ spawner: spawn, stream: (_r, e) => streamed.push(e), delay: never }).ask(run('sess-1'), 'the prompt');
    await Promise.resolve();
    spawn.handles[0]!.emit({ kind: 'result', text: '{"lesson":"x"}', tokensIn: 10, tokensOut: 2, costUsd: 0.01 });
    spawn.handles[0]!.fail(0);
    expect(await asked).toEqual({ kind: 'answered', text: '{"lesson":"x"}', usage: { tokensIn: 10, tokensOut: 2, costUsd: 0.01 } });
    expect(spawn.plans[0]).toMatchObject({ instruction: 'the prompt', resumeRef: 'sess-1' });
    expect(streamed.map((e) => e.kind)).toEqual(['result']);
  });

  it('a harness that cannot resume the session: skipped, the worker stopped', async () => {
    const spawn = spawner();
    const asked = new ResumeRoundAsker({ spawner: spawn, stream: () => undefined, delay: never }).ask(run('sess-1'), 'p');
    await Promise.resolve();
    spawn.plans[0]!.onResumeFailed('session/load is not offered');
    expect(await asked).toEqual({ kind: 'skipped', reason: 'the session could not be resumed — session/load is not offered' });
    expect(spawn.handles[0]!.stop).toHaveBeenCalled();
  });

  it('past its bound the round is cut and skipped', async () => {
    const spawn = spawner();
    const reply = await new ResumeRoundAsker({ spawner: spawn, stream: () => undefined, delay: now, boundMs: 60_000 }).ask(run('sess-1'), 'p');
    expect(reply).toEqual({ kind: 'skipped', reason: 'the round passed its 1-minute bound' });
    expect(spawn.handles[0]!.stop).toHaveBeenCalled();
  });
});
