import { describe, expect, it } from 'vitest';
import type { Persona } from '../core/persona';
import type { ModelRow } from './protocol';
import { composeOneOnOneBrief, type OneOnOneBriefInput } from './one-on-one-brief';
import { OneOnOneRequestBuilder } from './one-on-one-request';
import { cutToOneOnOne, NO_TOOLS, ONE_ON_ONE_TOOLS, ONE_ON_ONE_VAULT_TOOLS } from './one-on-one-toolset';

import { EMPTY_PERSONA_SETTINGS } from '../core/persona-settings';
const row = (provider: ModelRow['provider'], model: string, cls: string, enabled = true): ModelRow => ({ provider, model, class: cls, slot: null, category: '', cost: 1, enabled });
const ROWS: readonly ModelRow[] = [row('claude-code', 'opus', 'heavy'), row('claude-code', 'sonnet', 'standard'), row('opencode', 'glm-5.3', 'standard'), row('kimi', 'k2', 'light', false)];
function persona(over: Partial<Persona> = {}): Persona {
  return {
    id: 'ben',
    kind: 'agent',
    title: 'Ben',
    role: 'builder',
    class: 'heavy',
    model: null,
    color: '#888888',
    summary: '',
    skills: [],
    budget: 4,
    allowed: { spendAboveAllowance: true },
    settings: EMPTY_PERSONA_SETTINGS,
    ...over,
  };
}

const input = (over: Partial<Parameters<OneOnOneRequestBuilder['build']>[0]> = {}): Parameters<OneOnOneRequestBuilder['build']>[0] => ({
  persona: persona(),
  ticketsVaultPath: 'E:/tickets',
  chatFile: 'tickets/_meta/chat/20261109-100000-1-1-ben.md',
  instruction: 'brief',
  origin: 'drey:1:1',
  rows: ROWS,
  ...over,
});

describe('OneOnOneRequestBuilder — the 1:1 asks the pool like any session (req-168)', () => {
  it("runs the first model of the persona's class (req-288), read-only in the tickets repository, with no ticket, gate or move", () => {
    const built = new OneOnOneRequestBuilder().build(input());
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
      column: null,
      poolClass: 'heavy',
      ledger: { allowance: null, personaBudget: 4, spendAboveAllowance: false, noTicket: true },
      session: { kind: '1:1', persona: 'ben', workingDirectory: 'E:/tickets', chatFile: 'tickets/_meta/chat/20261109-100000-1-1-ben.md' },
    });
    expect(request?.dk).toBeUndefined();
    expect(request?.cursor).toBeUndefined(); // nothing moves
  });

  it('req-288: a pinned model runs on its own harness, its class from its row', () => {
    const built = new OneOnOneRequestBuilder().build(input({ persona: persona({ model: 'glm-5.3' }) }));
    expect(built.ok && built.request).toMatchObject({ provider: 'opencode', model: 'glm-5.3', poolClass: 'standard' });
  });

  it('req-288: an unmigrated record runs by the migration rule — the class of its old default', () => {
    const v2 = persona({ class: null, legacy: { worker: 'claude-code', models: { default: 'sonnet', pool: ['sonnet', 'opus'] }, minClass: null } });
    expect(new OneOnOneRequestBuilder().build(input({ persona: v2 }))).toMatchObject({ ok: true, request: { provider: 'claude-code', model: 'sonnet', poolClass: 'standard' } });
  });

  it('refuses a persona whose class holds no model the router may use', () => {
    const built = new OneOnOneRequestBuilder().build(input({ persona: persona({ class: 'light' }) }));
    expect(built).toMatchObject({ ok: false, error: expect.stringContaining('no light model') });
  });
});

describe('the 1:1 toolset is the read-only cut (R1)', () => {
  it("keeps the fleet's read tools and the vault read tools, drops every tool that acts", () => {
    const offered = ['fleet_status', 'fleet_run', 'fleet_stop', 'fleet_steer', 'fleet_watch', 'vault_read', 'vault_edit', 'vault_write', 'vault_move', 'vault_delete'].map((name) => ({ name }));
    expect(cutToOneOnOne(offered).map((t) => t.name)).toEqual(['fleet_status', 'fleet_watch', 'vault_read']);
    expect(ONE_ON_ONE_TOOLS.every((name) => !/run|stop|steer|edit|write|move|delete/.test(name))).toBe(true);
    expect(NO_TOOLS.attached({ persona: 'ben', provider: 'claude-code' })).toEqual([]);
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
    expect(brief({ tools: ['fleet_status', 'vault_read'] })).toContain("## Tools\n\nRead the crew's runs with: fleet_status. Read the owner's notes (the vault) with: vault_read. They only read.");
  });

  it('names exactly the vault read tools when only they are attached (req-217)', () => {
    const text = brief({ tools: [...ONE_ON_ONE_VAULT_TOOLS] });
    expect(text).toContain("## Tools\n\nRead the owner's notes (the vault) with: vault_list, vault_search, vault_read. They only read.");
    expect(text).not.toMatch(/fleet_|vault_(edit|write|move|delete)/);
  });

  it('says so when memory and runs are empty, and carries the conversation so far', () => {
    const text = brief({ memory: null, runs: [], conversation: [{ role: 'owner', text: 'Hi Ben' }, { role: 'persona', text: 'Hi.' }] });
    expect(text).toContain('## Your memory\n\nNothing yet.');
    expect(text).toContain('## Your latest runs\n\nNo runs yet.');
    expect(text).toContain('## The conversation so far\n\nOwner: Hi Ben\n\nYou: Hi.');
  });
});
