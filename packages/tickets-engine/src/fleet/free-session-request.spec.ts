import { describe, expect, it } from 'vitest';
import type { Persona } from '../core/persona';
import { composeFreeSessionBrief } from './free-session-brief';
import { FreeSessionRequestBuilder } from './free-session-request';
import { FREE_SESSION_TICKET } from './protocol-session';

const BEN = { id: 'ben', kind: 'agent', title: 'Ben', role: 'build', worker: 'claude-code', models: { default: 'claude-code/sonnet', pool: ['claude-code/opus'] }, color: '#fff', skills: [], budget: 4, allowed: {} } as unknown as Persona;
const base = { persona: BEN, ticketsVaultPath: 'E:\\T', directory: 'E:\\work', instruction: 'brief', origin: 'drey:crew', crew: { permissionMode: 'accept-edits' as const }, overrides: {} };
const builder = new FreeSessionRequestBuilder();

describe('FreeSessionRequestBuilder (req-173)', () => {
  it('builds a free session: the persona harness, the named directory, the vault permission, no ticket allowance', () => {
    const built = builder.build({ ...base, classOf: (provider, model) => (provider === 'claude-code' && model === 'sonnet' ? 'B' : null) });
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
      poolClass: 'B',
      profile: 'private',
      ledger: { allowance: null, personaBudget: 4, noTicket: true },
      session: { kind: 'free', persona: 'ben', workingDirectory: 'E:\\work' },
    });
  });

  it('the session record wins: permission, model pin and class over the vault and the persona', () => {
    const built = builder.build({ ...base, profile: 'work', overrides: { permissionMode: 'read-only', model: 'opus', poolClass: 'A' }, classOf: () => 'C' });
    expect(built.ok && built.request).toMatchObject({ permissionMode: 'read-only', model: 'opus', poolClass: 'A', profile: 'work' });
  });

  it('refuses a persona without a harness', () => {
    expect(builder.build({ ...base, persona: { ...BEN, worker: 'api' } as Persona })).toMatchObject({ ok: false });
  });

  it('the brief names the directory, what the permission allows, and the tickets vault rule', () => {
    const brief = composeFreeSessionBrief({ title: 'Ben', role: 'build', prompt: 'Be terse.', skills: [], workingDirectory: 'E:\\T', permissionMode: 'read-only', ticketsVault: true });
    expect(brief).toContain('# Free session with Ben');
    expect(brief).toContain('You work in E:\\T. Read-only');
    expect(brief).toContain('This folder is the tickets repository');
    expect(brief).toContain('## Your instructions\n\nBe terse.');
  });
});
