import { describe, expect, it } from 'vitest';
import type { Persona } from '../core/persona';
import { composeOneOnOneBrief, type OneOnOneBriefInput } from './one-on-one-brief';
import { OneOnOneRequestBuilder } from './one-on-one-request';
import { cutToOneOnOne, NO_TOOLS, ONE_ON_ONE_TOOLS } from './one-on-one-toolset';

function persona(over: Partial<Persona> = {}): Persona {
  return {
    id: 'ben',
    kind: 'agent',
    title: 'Ben',
    role: 'builder',
    worker: 'claude-code',
    models: { default: 'opus', pool: ['opus', 'opencode/glm-5.3'] },
    color: '#888888',
    skills: [],
    budget: 4,
    allowed: { spendAboveAllowance: true },
    ...over,
  };
}

const input = (over: Partial<Parameters<OneOnOneRequestBuilder['build']>[0]> = {}): Parameters<OneOnOneRequestBuilder['build']>[0] => ({
  persona: persona(),
  ticketsVaultPath: 'E:/tickets',
  chatFile: 'tickets/_meta/chat/20261109-100000-1-1-ben.md',
  instruction: 'brief',
  origin: 'drey:1:1',
  ...over,
});

describe('OneOnOneRequestBuilder — the 1:1 asks the pool like any session (req-168)', () => {
  it("runs the persona's own harness and model, read-only in the tickets repository, with no ticket, gate or move", () => {
    const built = new OneOnOneRequestBuilder().build(input({ classOf: (provider, model) => (provider === 'claude-code' && model === 'opus' ? 'A' : null) }));
    expect(built.ok).toBe(true);
    const request = built.ok ? built.request : null;
    expect(request).toMatchObject({
      ticketId: '1:1',
      provider: 'claude-code',
      model: 'opus',
      permissionMode: 'read-only',
      worktreePath: 'E:/tickets',
      gate: 'none',
      acceptance: [],
      nextPhase: null,
      column: null,
      poolClass: 'A',
      ledger: { allowance: null, personaBudget: 4, spendAboveAllowance: false, noTicket: true },
      session: { kind: '1:1', persona: 'ben', workingDirectory: 'E:/tickets', chatFile: 'tickets/_meta/chat/20261109-100000-1-1-ben.md' },
    });
    expect(request?.dk).toBeUndefined();
  });

  it("takes the pool's first model of the persona's harness when the default names another one", () => {
    const built = new OneOnOneRequestBuilder().build(input({ persona: persona({ worker: 'opencode', models: { default: 'claude-code/opus', pool: ['opencode/glm-5.3'] } }) }));
    expect(built.ok && built.request).toMatchObject({ provider: 'opencode', model: 'glm-5.3' });
    expect(built.ok && built.request.poolClass).toBeUndefined();
  });

  it('refuses an api persona: its 1:1 goes over the chat bridge', () => {
    const built = new OneOnOneRequestBuilder().build(input({ persona: persona({ worker: 'api' }) }));
    expect(built).toMatchObject({ ok: false, error: expect.stringContaining('chat bridge') });
  });
});

describe('the 1:1 toolset is the read-only cut (R1)', () => {
  it("keeps the fleet's read tools and the vault read tools, drops every tool that acts", () => {
    const offered = ['fleet_status', 'fleet_run', 'fleet_stop', 'fleet_steer', 'fleet_watch', 'vault_read', 'vault_edit', 'vault_write', 'vault_move', 'vault_delete'].map((name) => ({ name }));
    expect(cutToOneOnOne(offered).map((t) => t.name)).toEqual(['fleet_status', 'fleet_watch', 'vault_read']);
    expect(ONE_ON_ONE_TOOLS.every((name) => !/run|stop|steer|edit|write|move|delete/.test(name))).toBe(true);
    expect(NO_TOOLS.attached('ben')).toEqual([]);
  });
});

describe('composeOneOnOneBrief — the context of R2', () => {
  const brief = (over: Partial<OneOnOneBriefInput> = {}): string =>
    composeOneOnOneBrief({
      id: 'ben',
      title: 'Ben',
      role: 'builder',
      prompt: 'Build small.',
      skills: [{ name: 'git-hygiene', text: 'Commit often.' }],
      memory: '# Memory\n\n- 2026-11-08 · keep PRs small',
      runs: [{ ticketId: 'T-0007', state: 'failed', costUsd: 1.1, gateFailure: 'npm test\n3 failing', model: 'opus' }],
      conversation: [],
      tools: [],
      workingDirectory: 'E:/tickets',
      ...over,
    });

  it('carries profile, instructions, skills, memory and the latest runs — never the board', () => {
    const text = brief();
    expect(text).toContain('You are Ben, the builder of this crew');
    expect(text).toContain('read-only');
    expect(text).toContain('## Your instructions\n\nBuild small.');
    expect(text).toContain('### git-hygiene\n\nCommit often.');
    expect(text).toContain('keep PRs small');
    expect(text).toContain('- T-0007 · failed · opus · $1.10 · gate: npm test 3 failing');
    expect(text).toContain('```proposal');
    expect(text).not.toContain('Board digest');
  });

  it('names a tool only when it is attached', () => {
    expect(brief()).not.toContain('## Tools');
    expect(brief({ tools: ['fleet_status', 'vault_read'] })).toContain('## Tools\n\nRead the board, the tickets and the vault with: fleet_status, vault_read.');
  });

  it('says so when memory and runs are empty, and carries the conversation so far', () => {
    const text = brief({ memory: null, runs: [], conversation: [{ role: 'owner', text: 'Hi Ben' }, { role: 'persona', text: 'Hi.' }] });
    expect(text).toContain('## Your memory\n\nNothing yet.');
    expect(text).toContain('## Your latest runs\n\nNo runs yet.');
    expect(text).toContain('## The conversation so far\n\nOwner: Hi Ben\n\nYou: Hi.');
  });
});
