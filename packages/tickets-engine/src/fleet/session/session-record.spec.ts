import { describe, expect, it } from 'vitest';
import type { RunInfo } from '../protocol';
import { sessionStateOf } from '../protocol-session';
import { sessionRecordOf } from './session-record';

const run = {
  id: 'R-1',
  ticketId: 'T-0007',
  persona: 'ben',
  provider: 'claude-code',
  state: 'running',
  pid: 1,
  startedAt: '2026-11-09T10:00:00Z',
  endedAt: null,
  sessionRef: null,
  tokensIn: 0,
  tokensOut: 0,
  costUsd: null,
  lastActivity: '2026-11-09T10:00:00Z',
  steerCount: 0,
  lastSteerRung: null,
  worktreePath: 'E:\\T\\_worktrees\\T-0007',
  branch: 't/T-0007',
  gateFailure: null,
  model: 'sonnet',
} as RunInfo;

describe('the session record (req-173, R12)', () => {
  it('names the state from the record: queued, held, running, released', () => {
    expect(sessionStateOf({ state: 'starting' })).toBe('queued');
    expect(sessionStateOf({ state: 'running', held: true, turn: 'idle' })).toBe('held');
    expect(sessionStateOf({ state: 'running', held: true, turn: 'busy' })).toBe('running');
    expect(sessionStateOf({ state: 'running' })).toBe('running');
    for (const state of ['done', 'stopped', 'failed', 'detached'] as const) {
      expect(sessionStateOf({ state })).toBe('released');
    }
  });

  it('a ticket run: the worktree, the ticket ledger, the token by reference', () => {
    const record = sessionRecordOf({ ...run, vaultMcp: true, grant: { requested: 'B', class: 'B', model: 'sonnet', cost: 1, reason: 'r' } }, 'accept-edits');
    expect(record).toMatchObject({
      kind: 'run',
      workingDirectory: run.worktreePath,
      ticketId: 'T-0007',
      class: 'B',
      token: 'R-1',
      ledgers: { ticket: 'T-0007', persona: 'ben', provider: 'claude-code' },
      stream: 'runs/R-1/stream.jsonl',
      state: 'running',
      permission: 'accept-edits',
    });
  });

  it('a free session: its own directory, no ticket, no token without the vault MCP', () => {
    const record = sessionRecordOf({ ...run, ticketId: 'free', kind: 'free', workingDirectory: 'E:\\T', held: true, turn: 'idle' });
    expect(record).toMatchObject({ kind: 'free', workingDirectory: 'E:\\T', ticketId: null, token: null, state: 'held', ledgers: { ticket: null } });
  });
});
