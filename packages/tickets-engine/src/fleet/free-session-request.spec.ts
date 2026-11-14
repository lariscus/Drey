import { describe, expect, it } from 'vitest';
import type { Persona } from '../core/persona';
import type { ModelRow } from './protocol';
import { composeFreeSessionBrief } from './free-session-brief';
import { FreeSessionRequestBuilder } from './free-session-request';
import { FREE_SESSION_TICKET } from './protocol-session';

const row = (provider: ModelRow['provider'], model: string, cls: string, enabled = true): ModelRow => ({ provider, model, class: cls, slot: null, category: '', cost: 1, enabled });
const ROWS: readonly ModelRow[] = [row('claude-code', 'opus', 'heavy'), row('claude-code', 'sonnet', 'standard'), row('opencode', 'glm-5.3', 'standard'), row('kimi', 'k2', 'light', false)];
const BEN = { id: 'ben', kind: 'agent', title: 'Ben', role: 'build', class: 'standard', model: null, color: '#fff', skills: [], budget: 4, allowed: {} } as unknown as Persona;
const base = { persona: BEN, ticketsVaultPath: 'E:\\T', directory: 'E:\\work', instruction: 'brief', origin: 'drey:crew', crew: { permissionMode: 'accept-edits' as const }, overrides: {}, rows: ROWS };
const builder = new FreeSessionRequestBuilder();

describe('FreeSessionRequestBuilder (req-173)', () => {
  it("builds a free session: the first model of the persona's class (req-288), the named directory, the vault permission, no ticket allowance", () => {
    const built = builder.build(base);
    expect(built.ok).toBe(true);
    const request = built.ok ? built.request : null;
    expect(request).toMatchObject({
      ticketId: FREE_SESSION_TICKET,
      provider: 'claude-code',
      model: 'sonnet',
      permissionMode: 'accept-edits',
      worktreePath: 'E:\\work',
      repoPath: 'E:\\work',
      gate: 'none',
      poolClass: 'standard',
      ledger: { allowance: null, personaBudget: 4, noTicket: true },
      session: { kind: 'free', persona: 'ben', workingDirectory: 'E:\\work' },
    });
  });

  it('req-283: carries the project the session works in; none = no projectId', () => {
    const named = builder.build({ ...base, projectId: 'drey' });
    const none = builder.build({ ...base, projectId: null });
    expect(named.ok && named.request.projectId).toBe('drey');
    expect(none.ok && 'projectId' in none.request).toBe(false);
  });

  it('the session record wins: permission, model pin and class over the vault and the persona', () => {
    const built = builder.build({ ...base, overrides: { permissionMode: 'read-only', model: 'opus', poolClass: 'heavy' } });
    expect(built.ok && built.request).toMatchObject({ permissionMode: 'read-only', model: 'opus', poolClass: 'heavy' });
  });

  it('req-288: a pinned model runs on its harness; a persona with no model of its class has no session', () => {
    expect(builder.build({ ...base, persona: { ...BEN, model: 'opencode/glm-5.3' } as Persona })).toMatchObject({ ok: true, request: { provider: 'opencode', model: 'glm-5.3', poolClass: 'standard' } });
    expect(builder.build({ ...base, persona: { ...BEN, class: 'light' } as Persona })).toMatchObject({ ok: false, error: expect.stringContaining('no light model') });
  });

  it('the brief names the directory, what the permission allows, and the tickets vault rule', () => {
    const brief = composeFreeSessionBrief({ title: 'Ben', role: 'build', prompt: 'Be terse.', skills: [], workingDirectory: 'E:\\T', permissionMode: 'read-only', ticketsVault: true });
    expect(brief).toContain('# Free session with Ben');
    expect(brief).toContain('You work in E:\\T. Read-only');
    expect(brief).toContain('This folder is the tickets repository');
    expect(brief).toContain('## Your instructions\n\nBe terse.');
  });
});
