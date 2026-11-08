import { describe, expect, it } from 'vitest';
import { IllegalRunTransition } from './illegal-run-transition';
import type { RunEvent } from './run-event';
import type { RunState } from './run-state';
import { BLOCKING_RUN_STATES, INITIAL_RUN_STATE, isLive, isTerminal, LIVE_RUN_STATES, TERMINAL_RUN_STATES } from './run-state';
import { RunStateMachine } from './run-state-machine';

/**
 * The run state machine's table (ADR-0096), one block per event: every
 * state it takes and where that leads, and every state it refuses. A
 * refused event is a programming error — the record keeps its state and
 * the caller learns why.
 */

const ALL: readonly RunState[] = ['starting', 'running', 'stopping', 'done', 'stopped', 'failed', 'detached'];
const machine = new RunStateMachine();

function expectTable(event: RunEvent, leads: Partial<Record<RunState, RunState>>): void {
  for (const from of ALL) {
    const to = leads[from] ?? null;
    expect(machine.next(from, event), `${from} + ${event.kind}`).toBe(to);
    expect(machine.can(from, event)).toBe(to !== null);
  }
}

describe('RunStateMachine', () => {
  it('a new run starts in `starting`', () => {
    expect(INITIAL_RUN_STATE).toBe('starting');
  });

  it('spawned: a starting run runs; a running one takes a replacement worker and keeps running', () => {
    expectTable({ kind: 'spawned' }, { starting: 'running', running: 'running' });
  });

  it('respawning: a failed resume goes back to starting under the same id (T-0049) — never once it is being stopped', () => {
    expectTable({ kind: 'respawning' }, { starting: 'starting', running: 'starting' });
  });

  it('adopted: a restart takes a live or detached worker back as running (req-51)', () => {
    expectTable({ kind: 'adopted' }, { starting: 'running', running: 'running', detached: 'running' });
  });

  it('orphaned: a restart without a supervised worker detaches a live run', () => {
    expectTable({ kind: 'orphaned' }, { starting: 'detached', running: 'detached', stopping: 'detached' });
  });

  it('stop-requested: every run that is not over is stopped, a detached one too (it frees the ticket)', () => {
    expectTable({ kind: 'stop-requested' }, { starting: 'stopping', running: 'stopping', stopping: 'stopping', detached: 'stopping' });
  });

  it('claim-lost: the store took the ticket — the run is stopped from any state that is not over (E14-5)', () => {
    expectTable({ kind: 'claim-lost' }, { starting: 'stopping', running: 'stopping', stopping: 'stopping', detached: 'stopping' });
  });

  it('settled: a run that is not over ends with its outcome; an ended run never settles again', () => {
    for (const outcome of TERMINAL_RUN_STATES) {
      expectTable({ kind: 'settled', outcome }, { starting: outcome, running: outcome, stopping: outcome, detached: outcome });
    }
  });

  it('transition returns the record with its new state and keeps every other field', () => {
    const record = { state: 'starting' as RunState, pid: 42, id: 'R-1' };
    expect(machine.transition(record, { kind: 'spawned' })).toEqual({ state: 'running', pid: 42, id: 'R-1' });
    expect(record.state).toBe('starting');
  });

  it('transition throws for an event the state does not take, naming both', () => {
    const record = { state: 'done' as RunState };
    expect(() => machine.transition(record, { kind: 'stop-requested' })).toThrow(IllegalRunTransition);
    expect(() => machine.transition(record, { kind: 'settled', outcome: 'failed' })).toThrow('a done run cannot take "settled"');
  });

  it('the classifications: terminal, live and blocking', () => {
    expect(ALL.filter(isTerminal)).toEqual(['done', 'stopped', 'failed']);
    expect(ALL.filter(isLive)).toEqual([...LIVE_RUN_STATES]);
    expect(BLOCKING_RUN_STATES).toEqual([...LIVE_RUN_STATES, 'detached']);
  });
});
