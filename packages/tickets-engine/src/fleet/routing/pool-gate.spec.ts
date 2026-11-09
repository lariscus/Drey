import { describe, expect, it } from 'vitest';
import type { NormalizedEvent } from '../harness/contract';
import type { RunInfo, RunRequest, SlotView } from '../protocol';
import { ClaudeCodeQuotaSource } from './claude-code-quota-source';
import { CountingQuotaSource } from './counting-quota-source';
import { MemoryFileSystem } from '../ports/memory-file-system.fake';
import { FakeClock, FakeQuotaSource, slot, window } from './routing.fake';
import type { Slot } from './slot';
import { CapacityCap } from './capacity-cap';
import { Ledgers } from './ledgers';
import { PoolGate } from './pool-gate';
import { PoolGrant } from './pool-grant';
import { PoolSettingsRegistry } from './pool-settings';
import { SessionBook } from './session-book';
import { SlotRegistry } from './slot-registry';
import { SlotReservations } from './slot-reservations';
import { SlotRunListener } from './slot-run-listener';
import { SlotStateResolver } from './slot-state-resolver';
import { SurplusCalculator } from './surplus-calculator';

const NOW = new Date('2026-11-09T12:00:00Z');

function parts(slots: Slot[], sourceOf?: (s: Slot) => FakeQuotaSource | ClaudeCodeQuotaSource | CountingQuotaSource, pool: Record<string, unknown> = {}): { registry: SlotRegistry; gate: PoolGate; reservations: SlotReservations; source: FakeQuotaSource; changes: SlotView[]; book: SessionBook } {
  const source = new FakeQuotaSource();
  const reservations = new SlotReservations();
  const changes: SlotView[] = [];
  const registry = new SlotRegistry({
    config: { load: () => Promise.resolve({ slots, errors: [], refreshMs: 60_000 }) },
    sourceOf: sourceOf ?? (() => source),
    reservations,
    resolver: new SlotStateResolver(new SurplusCalculator()),
    clock: new FakeClock(NOW),
    onChange: (view) => changes.push(view),
    log: () => undefined,
  });
  const settings = new PoolSettingsRegistry(() => undefined);
  settings.apply(pool, slots, null);
  const book = new SessionBook();
  const cap = new CapacityCap(settings, reservations);
  const grant = new PoolGrant({ slots: registry, settings, cap, reservations, ledgers: new Ledgers(book, settings, new FakeClock(NOW)) });
  return { registry, gate: new PoolGate(registry, reservations, grant), reservations, source, changes, book };
}

const NOBODY = { prefer: null, persona: null };
const prefer = (id: string): { prefer: string; persona: null } => ({ prefer: id, persona: null });
const request = (over: Partial<RunRequest> = {}): RunRequest => ({ ticketId: 'T-0001', provider: 'claude-code', ...over }) as RunRequest;
const claudeA = slot({ id: 'claude-a', label: 'Claude A', sessions: 1, login: { claudeConfigDir: '/c/a' } });
const claudeB = slot({ id: 'claude-b', label: 'Claude B', sessions: 1, login: { claudeConfigDir: '/c/b' } });
const claudeWork = slot({ id: 'claude-w', label: 'Claude Work', profile: 'work' });

describe('PoolGate — the profile rule and the free slot (req-177 under the pool)', () => {
  it('binds the first free slot of the provider and profile, reserves it and tells the change', async () => {
    const { registry, gate, reservations, changes } = parts([claudeA, claudeB, claudeWork]);
    await registry.load();
    expect(gate.bind(request(), 'R-1', NOBODY)).toMatchObject({ id: 'claude-a', label: 'Claude A' });
    expect(reservations.busy('claude-a')).toBe(1);
    expect(changes.at(-1)).toMatchObject({ id: 'claude-a', state: 'busy', busy: 1, total: 1 });
    expect(gate.bind(request(), 'R-2', NOBODY)).toMatchObject({ id: 'claude-b', label: 'Claude B' });
    expect(gate.bind(request(), 'R-3', NOBODY)).toEqual({ refused: 'waits for a claude-code slot — Claude A: 1 of 1 sessions busy; Claude B: 1 of 1 sessions busy' });
    gate.release('R-1');
    expect(gate.bind(request(), 'R-3', NOBODY)).toMatchObject({ id: 'claude-a', label: 'Claude A' });
  });

  it('a work repository runs only on a work slot, and a private one never on it — not even as a fallback', async () => {
    const { registry, gate } = parts([claudeA, claudeWork]);
    await registry.load();
    expect(gate.bind(request({ profile: 'work' }), 'R-1', NOBODY)).toMatchObject({ id: 'claude-w', label: 'Claude Work' });
    const onlyPrivate = parts([claudeA]);
    await onlyPrivate.registry.load();
    expect(onlyPrivate.gate.bind(request({ profile: 'work' }), 'R-2', NOBODY)).toEqual({
      refused: 'no work slot serves claude-code: the repository is work and never runs on a private slot — add a work slot for claude-code to service.json',
    });
  });

  it('prefers the slot the resumed session lives on while it is free', async () => {
    const { registry, gate } = parts([claudeA, claudeB]);
    await registry.load();
    expect(gate.bind(request(), 'R-1', prefer('claude-b'))).toMatchObject({ id: 'claude-b', label: 'Claude B' });
    expect(gate.bind(request(), 'R-2', prefer('claude-b'))).toMatchObject({ id: 'claude-a', label: 'Claude A' });
  });

  it('refuses a slot that needs a login or is exhausted, with the reason', async () => {
    const { registry, gate, source } = parts([claudeA, claudeB]);
    await registry.load();
    registry.flagLogin('claude-a', 'authentication_failed');
    source.readings.set('claude-b', { kind: 'windows', windows: [window({ name: '5h', remaining: 0, resetsAt: null })] });
    await registry.refresh();
    expect(gate.bind(request(), 'R-1', NOBODY)).toEqual({ refused: 'waits for a claude-code slot — Claude A needs a login (authentication_failed); Claude B: the 5h window is spent' });
  });

  it("hands the worker its account's environment", async () => {
    const { registry, gate } = parts([claudeA, claudeWork]);
    await registry.load();
    expect(gate.envOf('claude-a')).toEqual({ CLAUDE_CONFIG_DIR: '/c/a' });
    expect(gate.envOf('claude-w')).toBeUndefined();
    expect(gate.envOf('gone')).toBeUndefined();
  });
});

describe("SlotRunListener — the slots' ear on the runner's events", () => {
  const info = (over: Partial<RunInfo>): RunInfo => ({ id: 'R-1', ticketId: 'T-0001', provider: 'claude-code', state: 'running', tokensIn: 0, tokensOut: 0, startedAt: NOW.toISOString(), endedAt: null, lastActivity: NOW.toISOString(), slot: { id: 'claude-a', label: 'Claude A' }, ...over }) as RunInfo;
  const line = (over: Partial<NormalizedEvent>): NormalizedEvent => ({ ts: NOW.toISOString(), kind: 'usage', ...over });

  function wired(slots: Slot[]): ReturnType<typeof parts> & { listener: SlotRunListener; counting: CountingQuotaSource; claude: ClaudeCodeQuotaSource } {
    const counting = new CountingQuotaSource(new FakeClock(NOW));
    const claude = new ClaudeCodeQuotaSource(new MemoryFileSystem(), '/home/u');
    const p = parts(slots, (s) => (s.quota === 'claude-code' ? claude : counting));
    return { ...p, counting, claude, listener: new SlotRunListener({ registry: p.registry, reservations: p.reservations, claude, counting }) };
  }

  it("Claude Code's rate-limit line measures the run's slot", async () => {
    const { registry, listener } = wired([slot({ ...claudeA, quota: 'claude-code' })]);
    await registry.load();
    listener.publish({ kind: 'run', info: info({}) });
    listener.publish({ kind: 'line', runId: 'R-1', event: line({ rateLimit: { fiveHour: { utilization: 0.25, resetsAt: '2026-11-09T14:00:00.000Z', status: 'allowed' }, sevenDay: null } }) });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(registry.view('claude-a')).toMatchObject({ state: 'busy', windows: [{ name: '5h', remaining: 0.75, reliability: 'measured' }] });
  });

  it("a run's end frees the slot and feeds the counting: an unknown slot becomes estimated after its first run", async () => {
    const copilot = slot({ id: 'copilot', provider: 'opencode', limits: [{ window: 'month', budget: 1000, unit: 'runs' }] });
    const { registry, listener, reservations } = wired([copilot]);
    await registry.load();
    await registry.refresh();
    expect(registry.view('copilot')?.state).toBe('unknown');
    const run = info({ provider: 'opencode', slot: { id: 'copilot', label: 'copilot' } });
    listener.publish({ kind: 'run', info: run });
    expect(reservations.busy('copilot')).toBe(1);
    listener.publish({ kind: 'run', info: { ...run, state: 'done', endedAt: NOW.toISOString(), tokensIn: 900, tokensOut: 100 } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reservations.busy('copilot')).toBe(0);
    expect(registry.view('copilot')).toMatchObject({ state: 'ready', windows: [{ reliability: 'estimated', used: 1 }] });
  });

  it('an authentication_failed run marks its slot needs login — once, and never again from the same record', async () => {
    const { registry, listener } = wired([claudeA]);
    await registry.load();
    listener.publish({ kind: 'run', info: info({ state: 'failed', endedAt: NOW.toISOString(), lastError: 'error_during_execution: authentication_failed' }) });
    expect(registry.view('claude-a')).toMatchObject({ state: 'needs-login', reason: 'error_during_execution: authentication_failed' });
    registry.clearLogin('claude-a');
    listener.publish({ kind: 'run', info: info({ state: 'failed', endedAt: NOW.toISOString(), lastError: 'error_during_execution: authentication_failed' }) });
    expect(registry.view('claude-a')?.state).not.toBe('needs-login');
  });

  it("a login error line of a live run marks the slot at once", async () => {
    const { registry, listener } = wired([claudeA]);
    await registry.load();
    listener.publish({ kind: 'run', info: info({}) });
    listener.publish({ kind: 'line', runId: 'R-1', event: line({ kind: 'error', text: 'Invalid API key · Please run /login' }) });
    expect(registry.view('claude-a')?.state).toBe('needs-login');
  });

  it('a restarted runner re-reserves live records and counts ended ones, without a login alarm from history', async () => {
    const { registry, listener, reservations } = wired([claudeA]);
    await registry.load();
    listener.seed([info({ id: 'R-live' }), info({ id: 'R-old', state: 'failed', endedAt: NOW.toISOString(), lastError: 'authentication_failed' }), info({ id: 'R-none', slot: undefined })]);
    expect(reservations.busy('claude-a')).toBe(1);
    expect(registry.view('claude-a')?.state).toBe('busy');
  });

  it('ignores runs without a slot and its own slot events', () => {
    const { listener, reservations } = wired([claudeA]);
    listener.publish({ kind: 'run', info: info({ slot: undefined }) });
    listener.publish({ kind: 'line', runId: 'R-x', event: line({ kind: 'error', text: '401' }) });
    expect(reservations.busy('claude-a')).toBe(0);
  });
});
