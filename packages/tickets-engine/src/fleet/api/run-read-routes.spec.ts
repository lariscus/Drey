import { describe, expect, it } from 'vitest';
import type { SupervisorSet } from '../runner/supervisor-set';
import { attachCommandOf } from './attach-command';
import type { RouteContext } from './route-context';
import { parseLedger } from '../../core/pipeline/ledger';
import type { JournalReader } from '../runner/journal-reader';
import type { LedgerReader } from './ledger-reader';
import type { RunInfo } from '../protocol';
import { busyMsOf, RunReadRoutes } from './run-read-routes';

/** The Sessions tab's reads (req-166): a run's instruction and the attach command of its harness session. */
function request(pathname: string): { ctx: RouteContext; answer: { status: number; body: unknown } } {
  const answer = { status: 0, body: null as unknown };
  const ctx = {
    method: 'GET',
    pathname,
    parts: pathname.split('/').filter((p) => p !== ''),
    search: new URLSearchParams(),
    body: async () => ({}),
    respond: (status: number, body: unknown) => Object.assign(answer, { status, body }),
    raw: () => undefined,
    stream: () => {
      throw new Error('no stream');
    },
  } as RouteContext;
  return { ctx, answer };
}

const RECORD = {
  info: { id: 'R-1', provider: 'claude-code', sessionRef: 'e4b9-71c0', worktreePath: 'E:\\drey-tickets\\_worktrees\\T-0121' },
  request: { instruction: 'Build the order reducer.' },
};

const supervisors = {
  ofRun: (id: string) => (id === 'R-1' ? { records: () => [RECORD] } : null),
} as unknown as SupervisorSet;

describe('GET /instruction/<run> and /attach/<run>', () => {
  it('answers the instruction the run started with', async () => {
    const r = request('/instruction/R-1');
    expect(await new RunReadRoutes(supervisors).handle(r.ctx)).toBe(true);
    expect(r.answer).toEqual({ status: 200, body: { ok: true, instruction: 'Build the order reducer.' } });
  });

  it("answers the harness's resume of the session inside the worktree", async () => {
    const r = request('/attach/R-1');
    await new RunReadRoutes(supervisors).handle(r.ctx);
    expect(r.answer.body).toEqual({ ok: true, command: 'cd "E:\\drey-tickets\\_worktrees\\T-0121" && claude --resume e4b9-71c0' });
  });

  it('an unknown run is a 404', async () => {
    const r = request('/attach/R-9');
    await new RunReadRoutes(supervisors).handle(r.ctx);
    expect(r.answer.status).toBe(404);
  });
});

describe('GET /sessions (req-173, R12)', () => {
  it('answers every record as a session record: kind, directory, state, permission', async () => {
    const free = { id: 'R-2', ticketId: 'free', kind: 'free', persona: 'ben', provider: 'kimi', state: 'running', held: true, turn: 'idle', workingDirectory: 'E:\\drey-tickets', worktreePath: 'E:\\drey-tickets', startedAt: 's', endedAt: null };
    const set = { records: () => [{ info: free, request: { permissionMode: 'accept-edits' } }] } as unknown as SupervisorSet;
    const r = request('/sessions');
    expect(await new RunReadRoutes(set).handle(r.ctx)).toBe(true);
    expect(r.answer.body).toMatchObject({ sessions: [{ id: 'R-2', kind: 'free', workingDirectory: 'E:\\drey-tickets', state: 'held', ticketId: null, permission: 'accept-edits' }] });
  });
});

describe('attachCommandOf', () => {
  it('one resume per harness; none without a session or for an unknown harness', () => {
    expect(attachCommandOf('opencode', 'ses_1', '')).toBe('opencode --session ses_1');
    expect(attachCommandOf('kimi', 'k1', 'W')).toBe('cd "W" && kimi --session k1');
    expect(attachCommandOf('claude-code', null, 'W')).toBeNull();
    expect(attachCommandOf('other', 'x', 'W')).toBeNull();
    expect(attachCommandOf('claude-code', 'x; rm -rf /', 'W')).toBeNull();
  });
});

describe('GET /report (req-274: grouped by persona and by chain position)', () => {
  it('answers the persona rows with time held and the position rows from the records and the hold lines', async () => {
    const info = {
      id: 'R-3', ticketId: 'T-0007', persona: 'ben', provider: 'claude-code', state: 'done', tokensIn: 100, tokensOut: 10, costUsd: 0.3,
      startedAt: '2026-11-13T09:00:00Z', endedAt: '2026-11-13T09:20:00Z', gateResult: 'red', chainPosition: { at: 2, length: 3 }, phase: 'build', model: 'opus',
    };
    const set = { records: () => [{ info, request: { ticketsVaultPath: 'V', phase: 'build', model: 'opus' } }] } as unknown as SupervisorSet;
    const vaultsRead: string[][] = [];
    const ledgers = {
      eventsOf: (vaults: readonly string[]) => {
        vaultsRead.push([...vaults]);
        return Promise.resolve(parseLedger('{"v":1,"ts":"2026-11-13T08:30:00Z","event":"hold","ticket":"T-0007","persona":"ben","position":2,"length":3}'));
      },
    } as unknown as LedgerReader;
    const journals = { entriesOf: () => Promise.resolve([]) } as unknown as JournalReader;
    const r = request('/report');
    await new RunReadRoutes(set, { ledgers, journals, chainVault: () => 'W', now: () => new Date('2026-11-13T09:30:00Z') }).handle(r.ctx);
    expect(vaultsRead).toEqual([['V', 'W']]);
    expect(r.answer.body).toMatchObject({
      ok: true,
      byPersona: [{ persona: 'ben', runs: 1, costUsd: 0.3, redGates: 1, heldMs: 60 * 60_000 }],
      byPosition: [{ position: 2, runs: 1, busyMs: 20 * 60_000, heldMs: 60 * 60_000, waitingMs: 40 * 60_000 }],
    });
  });
});

describe('busyMsOf (req-274)', () => {
  const base = { startedAt: '2026-11-13T09:00:00Z', endedAt: null } as unknown as RunInfo;
  const now = Date.parse('2026-11-13T10:00:00Z');

  it('the closed busy spans plus the open one', () => {
    expect(busyMsOf({ ...base, execMs: 60_000, execSince: '2026-11-13T09:59:00Z' }, now)).toBe(120_000);
    expect(busyMsOf({ ...base, execMs: 60_000, execSince: null }, now)).toBe(60_000);
  });

  it('a record before req-67: the wall clock of an ended run, nothing for a live one', () => {
    expect(busyMsOf({ ...base, endedAt: '2026-11-13T09:05:00Z' }, now)).toBe(300_000);
    expect(busyMsOf(base, now)).toBeNull();
  });
});
