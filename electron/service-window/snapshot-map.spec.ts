import { describe, expect, it } from 'vitest';
import { componentsOf, governorFactsOf, loadOf, sessionsOf, slotFactsOf, spendOf, streamEventsOf } from './snapshot-map';

/** The service's, the runner's and the engine's answers in the window's shapes (req-165/166). */
describe('snapshot mapping', () => {
  const status = {
    vaultPath: 'E:\\projects\\drey-tickets',
    components: {
      engine: { state: 'running', port: 52114 },
      runner: { state: 'failed', detail: 'a file where fleet/ should be' },
      gateway: { state: 'running', detail: 'http://192.168.1.20:47811 · 2 paired devices', port: 47811 },
      mcp: { state: 'external', detail: 'served by Drey (until req-167)' },
    },
  };

  it('the governor (req-180): seats with holders, the higher of CPU and memory, the waits with their cause, only listening dev servers', () => {
    expect(
      governorFactsOf({
        heavy: { busy: 1, total: 2, holders: [{ runId: 'R-1', ticket: 'T-0126', task: 'tests', since: 'x', pid: 4 }] },
        light: { busy: 2, total: 6 },
        load: { cpu: 41, memory: 37, reserve: 25 },
        lowPriority: true,
        quietHours: '',
        quietUntil: null,
        waiting: [{ runId: 'R-2', ticket: 'T-0121', task: 'build', cause: 'seats', reason: '2 of 2 heavy seats busy', since: 'x' }],
        devServers: [
          { port: 4302, ticket: 'T-0126', runId: 'R-1', listening: true },
          { port: 4303, ticket: 'T-0121', runId: 'R-2', listening: false },
        ],
      }),
    ).toEqual({
      heavy: { busy: 1, total: 2, holders: [{ ticket: 'T-0126', task: 'tests' }] },
      light: { busy: 2, total: 6 },
      load: 41,
      reserve: 25,
      quietUntil: null,
      waiting: [{ ticket: 'T-0121', task: 'build', cause: 'seats' }],
      devServers: [{ port: 4302, ticket: 'T-0126' }],
    });
    expect(governorFactsOf({}).load).toBeNull();
  });

  it('the component rows: the engine address and vault name, the runner reason, the gateway address and devices; the MCP detail from the catalog', () => {
    expect(componentsOf(status, 2)).toEqual({
      engine: { state: 'running', address: '127.0.0.1:52114', vaultName: 'drey-tickets' },
      runner: { state: 'failed', reason: 'a file where fleet/ should be', liveRuns: 2 },
      mcp: { state: 'external', detail: null },
      gateway: { state: 'running', address: 'http://192.168.1.20:47811', devices: 2, reason: null },
    });
  });

  it('a slot: the tightest window, q, the reset, the reliability; no windows = unknown', () => {
    expect(
      slotFactsOf({
        id: 'claude-a',
        label: 'Claude A',
        busy: 1,
        total: 2,
        q: 1.4,
        windows: [
          { name: '5h', remaining: 0.8, resetsAt: '2026-11-09T14:20:00Z', reliability: 'measured' },
          { name: '7d', remaining: 0.62, resetsAt: '2026-11-10T09:00:00Z', reliability: 'measured' },
        ],
      }),
    ).toEqual({ id: 'claude-a', label: 'Claude A', busy: 1, total: 2, left: 0.62, q: 1.4, resetsAt: '2026-11-10T09:00:00Z', reliability: 'measured' });
    expect(slotFactsOf({ id: 'kimi', label: 'Kimi', busy: 0, total: 2, q: null, windows: [] })).toMatchObject({ left: null, reliability: 'unknown' });
  });

  it("today's spend sums the slots; the limit only when every slot has one", () => {
    expect(spendOf({ providerDay: [{ id: 'a', spent: 3, limit: 15 }, { id: 'b', spent: 1.1, limit: 15 }] })).toEqual({ spent: 4.1, limit: 30 });
    expect(spendOf({ providerDay: [{ id: 'a', spent: 3, limit: null }] })).toEqual({ spent: 3, limit: null });
    expect(spendOf(null)).toBeNull();
  });

  it('the Load group from the settings, defaults for what is missing', () => {
    expect(loadOf({ heavySeats: 1, reserve: 30 })).toEqual({ heavySeats: 1, reserve: 30, lowPriority: true, quietHours: '' });
  });

  it("the sessions: live runs and today's ended ones, newest first", () => {
    const now = new Date('2026-11-09T12:00:00');
    const runs = [
      { id: 'R-1', state: 'running', startedAt: '2026-11-09T08:00:00', interactive: 'dialog', held: true, grant: { class: 'B', model: 'sonnet' } },
      { id: 'R-2', state: 'done', startedAt: '2026-11-09T09:00:00', endedAt: new Date('2026-11-09T10:00:00').toISOString() },
      { id: 'R-3', state: 'done', startedAt: '2026-11-07T09:00:00', endedAt: '2026-11-07T10:00:00Z' },
    ];
    const sessions = sessionsOf(runs, now);
    expect(sessions.map((s) => s.id)).toEqual(['R-2', 'R-1']);
    expect(sessions[1]).toMatchObject({ interactive: true, held: true, grantClass: 'B', model: 'sonnet' });
  });

  it("a stream file's lines, a cut first line skipped", () => {
    expect(streamEventsOf('"kind":"cut"}\n{"ts":"t","kind":"note","text":"x"}\n')).toEqual([{ ts: 't', kind: 'note', text: 'x' }]);
  });
});
