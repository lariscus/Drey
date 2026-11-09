import { describe, expect, it } from 'vitest';
import { DEFAULT_TRANCHE, type ChainConfig, type RunInfo, type TrancheConfig } from '../../protocol';
import { ChainState } from '../chain-state';
import { AnomalyDetector } from './anomaly-detector';
import { CheckpointReporter } from './checkpoint-reporter';
import { RunFacts } from './run-facts';
import { TrancheBudget } from './tranche-budget';
import { TrancheLedger } from './tranche-ledger';
import { Tranches } from './tranches';
import { FakeClock } from './tranche.fake';

function tranches(tranche: Partial<TrancheConfig> = {}): { t: Tranches; state: ChainState; clock: FakeClock; logs: string[] } {
  const state = new ChainState();
  state.config = { ticketsVaultPath: 'V:/', git: 'git', defaultWorker: 'opencode', permissionMode: 'accept-edits', tranche: { ...DEFAULT_TRANCHE, runs: 2, budgetShare: null, minutes: null, ...tranche } } as ChainConfig;
  const clock = new FakeClock();
  const logs: string[] = [];
  const t = new Tranches({
    state,
    ledger: new TrancheLedger(state, clock),
    budget: new TrancheBudget({ limitUsd: () => null }, clock),
    reporter: new CheckpointReporter(),
    detector: new AnomalyDetector(),
    facts: new RunFacts({ linesOf: async () => null }),
    clock,
    log: (line) => logs.push(line),
  });
  return { t, state, clock, logs };
}

const run = (ticket: string, gate: 'green' | 'red'): RunInfo => ({ id: `R-${ticket}`, ticketId: ticket, gateResult: gate, costUsd: 0.4, worktreePath: '', startedAt: '2026-11-09T12:00:00Z' }) as RunInfo;

describe('Tranches', () => {
  it('releases a start while the tranche has room, refuses it once spent', () => {
    const { t, state } = tranches();
    state.autopilot = t.onAutopilot({ state: 'on' });
    expect(t.mayStart()).toBe(true);
    t.started('T-1');
    expect(t.mayStart()).toBe(true);
    t.started('T-2');
    expect(t.mayStart()).toBe(false);
    expect(state.autopilot).toEqual({ state: 'paused', reason: 'checkpoint' });
  });

  it('refuses a start while a checkpoint waits, even with room left', () => {
    const { t, state } = tranches({ runs: 10, earlyStop: { ...DEFAULT_TRANCHE.earlyStop, redGates: 1 } });
    state.autopilot = t.onAutopilot({ state: 'on' });
    t.started('T-1');
    return t.settled(run('T-1', 'red')).then(() => {
      expect(t.status()?.checkpoint).toBe('waiting');
      expect(t.mayStart()).toBe(false);
    });
  });

  it('On after the checkpoint opens the next tranche; Off and On in between continue the same one', () => {
    const { t, state } = tranches({ runs: 3 });
    state.autopilot = t.onAutopilot({ state: 'on' });
    t.started('T-1');
    state.autopilot = t.onAutopilot({ state: 'off' });
    state.autopilot = t.onAutopilot({ state: 'on' });
    expect(t.status()).toMatchObject({ index: 1, done: 1 });
    t.started('T-2');
    t.started('T-3');
    expect(t.status()?.checkpoint).toBe('waiting');
    t.onAutopilot({ state: 'on' });
    expect(t.status()).toMatchObject({ index: 2, done: 0, checkpoint: null });
  });

  it('a spent tranche with no checkpoint (the time ran out while Off) opens the next on On', () => {
    const { t, state, clock } = tranches({ runs: null, minutes: 30 });
    state.autopilot = t.onAutopilot({ state: 'on' });
    state.autopilot = { state: 'off' };
    clock.advance(45);
    t.onAutopilot({ state: 'on' });
    expect(t.status()).toMatchObject({ index: 2, startedAt: '2026-11-09T12:45:00.000Z' });
  });

  it('raises the time checkpoint on review, and leaves an Off Autopilot Off', () => {
    const { t, state, clock, logs } = tranches({ runs: null, minutes: 30 });
    state.autopilot = t.onAutopilot({ state: 'on' });
    expect(t.review()).toBe(false);
    clock.advance(30);
    state.autopilot = { state: 'off' };
    expect(t.review()).toBe(true);
    expect(state.autopilot).toEqual({ state: 'off' });
    expect(t.status()?.report).toMatchObject({ endedBy: 'time', minutes: 30 });
    expect(logs.at(-1)).toContain('checkpoint: tranche 1 done (time span over)');
  });

  it('counts only the runs it released', async () => {
    const { t, state } = tranches();
    state.autopilot = t.onAutopilot({ state: 'on' });
    expect(await t.settled(run('T-9', 'green'))).toBe(false);
  });

  it('is off without a chain config or with every limit off', () => {
    const { t, state } = tranches({ runs: null });
    state.autopilot = t.onAutopilot({ state: 'on' });
    t.started('T-1');
    expect(t.status()).toBeNull();
    expect(t.mayStart()).toBe(true);
    state.config = null;
    expect(t.config()).toBeNull();
  });
});
