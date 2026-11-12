import { describe, expect, it } from 'vitest';
import type { LiveRun } from './live-run';
import { RunCompletion, type RunCompletionDeps } from './run-completion';

/**
 * req-280: a blocked step and a scout run reach the closing round too, so a
 * FRICTION line they reported lands in the persona's journal — before,
 * only the gate path asked (`afterGate`).
 */

function harness(): { completion: RunCompletion; calls: string[] } {
  const calls: string[] = [];
  const deps = {
    bookkeeper: {
      note: async () => undefined,
      parkBlocked: async () => {
        calls.push('park');
      },
      syncedText: async () => '## Report\n\nWritten on 2026-11-12T00:00:00Z by scout.\n\n### Summary\n\nDone.\n',
    },
    settler: {
      finish: async (_run: LiveRun, state: string) => {
        calls.push(`finish ${state}`);
      },
    },
    closing: {
      afterGate: async () => {
        calls.push('closing');
      },
    },
  } as unknown as RunCompletionDeps;
  return { completion: new RunCompletion(deps), calls };
}

function run(over: Partial<LiveRun> & { form?: 'scout' }): LiveRun {
  const { form, ...rest } = over;
  return {
    info: { id: 'r1', state: 'running', ticketId: 'T-0001' },
    request: { ticketId: 'T-0001', ...(form !== undefined ? { form } : {}) },
    agentDone: true,
    gating: false,
    ...rest,
  } as unknown as LiveRun;
}

describe('RunCompletion — the closing round off the gate path (req-280)', () => {
  it('a blocked step asks the round while it still holds the ticket, then parks', async () => {
    const { completion, calls } = harness();
    await completion.onWorkerExit(run({ blocked: 'the merge awaits the owner' }), 0);
    expect(calls).toEqual(['closing', 'park', 'finish done']);
  });

  it('a scout run asks the round before it settles', async () => {
    const { completion, calls } = harness();
    await completion.onWorkerExit(run({ form: 'scout' }), 0);
    expect(calls).toEqual(['closing', 'finish done']);
  });
});
