import { describe, expect, it } from 'vitest';
import type { SupervisorSet } from '../orchestrate/supervisor-set';
import { attachCommandOf } from './attach-command';
import type { RouteContext } from './route-context';
import { RunReadRoutes } from './run-read-routes';

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
