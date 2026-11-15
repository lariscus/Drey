import { describe, expect, it } from 'vitest';
import type { ProjectRecord } from '../contracts/projects';
import type { Persona } from '../core/persona/persona';
import { LayeredConfigResolver } from '../fleet/chain/layered-config-resolver';
import type { ModelsReply, RunInfo, RunRequest } from '../fleet/protocol';
import { parseCrewFile } from '../core/persona/crew-file';
import { FreeSessionService } from './free-session-service';
import type { EngineVault } from './host';

const VAULT: EngineVault = { id: 'v', name: 'tickets', path: 'E:\\T', exists: true, active: true };
const BEN = { id: 'ben', kind: 'agent', title: 'Ben', role: 'build', class: 'standard', model: null, color: '#fff', skills: [], budget: null, allowed: {} } as unknown as Persona;
/** req-288: a persona whose class holds no model of the table has no harness. */
const PIA = { ...BEN, id: 'pia', title: 'Pia', class: 'light' } as Persona;
const PROJECTS: ProjectRecord[] = [
  { id: 'drey', name: 'Drey', color: '', repos: ['drey'], folders: [], vaults: {}, purpose: '' },
  { id: 'lariscus', name: 'Lariscus', color: '', repos: ['lariscus'], folders: [], vaults: {}, purpose: '' },
];

function world(crewText: string | null = null, personas: readonly Persona[] = [BEN, PIA]): { service: FreeSessionService; starts: RunRequest[]; sends: [string, string][]; runs: RunInfo[] } {
  const starts: RunRequest[] = [];
  const sends: [string, string][] = [];
  const runs: RunInfo[] = [{ id: 'R-live', ticketId: 'T-0007', state: 'running', worktreePath: 'E:\\T\\_worktrees\\T-0007' } as RunInfo];
  const crew = new LayeredConfigResolver().crew(parseCrewFile(crewText).config);
  const models = { models: [{ provider: 'claude-code', model: 'sonnet', class: 'standard', enabled: true }] } as unknown as ModelsReply;
  const service = new FreeSessionService({
    board: { detect: async () => VAULT, listPersonas: async () => personas, listRepos: async () => ({ repos: [{ name: 'drey', url: 'x', path: 'E:\\projects\\drey' } as never] }), projectRecords: async () => PROJECTS },
    fleet: {
      runs: async () => runs,
      start: async (request) => (starts.push(request), { ok: true, run: { id: `R-${starts.length}` } as RunInfo }),
      send: async (runId, text) => (sends.push([runId, text]), { ok: true }),
      models: async () => models,
    },
    crew: { effective: async () => crew },
    host: { read: async (_v, rel) => (rel.endsWith('prompt.md') ? 'Ben builds.' : Promise.reject(new Error('ENOENT'))) },
    isDirectory: async (path) => (path.toLowerCase().includes('gone') ? null : true),
    log: () => undefined,
  });
  return { service, starts, sends, runs };
}

describe('FreeSessionService (req-173, R12)', () => {
  it('starts in the tickets vault itself with the vault permission and the table class, then sends the first line', async () => {
    const w = world('---\npermission-mode: bypass\n---\n');
    expect(await w.service.start({ persona: 'ben', directory: 'E:\\T', firstLine: 'Tidy the inbox.' }, 'service-window')).toEqual({ ok: true, runId: 'R-1' });
    const request = w.starts[0]!;
    expect(request).toMatchObject({ permissionMode: 'bypass', provider: 'claude-code', model: 'sonnet', poolClass: 'standard', origin: 'service-window', session: { kind: 'free', persona: 'ben', workingDirectory: 'E:\\T' } });
    expect(request.instruction).toContain('This folder is the tickets repository');
    expect(request.instruction).toContain('Ben builds.');
    expect(w.sends).toEqual([['R-1', 'Tidy the inbox.']]);
  });

  it('a session override wins over the vault, and the start carries no profile (req-290)', async () => {
    const w = world('---\npermission-mode: bypass\n---\n');
    await w.service.start({ persona: 'ben', directory: 'E:\\projects\\drey\\src', permissionMode: 'read-only', poolClass: 'A' }, 'drey:crew');
    expect(w.starts[0]).toMatchObject({ permissionMode: 'read-only', poolClass: 'A' });
    expect('profile' in w.starts[0]!).toBe(false);
    expect(w.sends).toEqual([]);
  });

  it("req-142: the persona's run-commands beats the vault's mode, the session's own choice beats both; without network: true the network is off", async () => {
    const strict = { ...BEN, allowed: { spendAboveAllowance: false, runCommands: 'accept-edits' } } as Persona;
    const open = { ...BEN, id: 'olga', allowed: { spendAboveAllowance: false, network: true } } as Persona;
    const w = world('---\npermission-mode: bypass\n---\n', [strict, open]);
    await w.service.start({ persona: 'ben', directory: 'E:\\T' }, 'drey:crew');
    await w.service.start({ persona: 'ben', directory: 'E:\\T', permissionMode: 'bypass' }, 'drey:crew');
    await w.service.start({ persona: 'olga', directory: 'E:\\T' }, 'drey:crew');
    expect(w.starts.map((s) => s.permissionMode)).toEqual(['accept-edits', 'bypass', 'bypass']);
    expect(w.starts.map((s) => s.network)).toEqual([false, false, undefined]);
  });

  it('refuses a missing folder, a live worktree, an unknown persona and one without a harness — and starts nothing', async () => {
    const w = world();
    expect(await w.service.start({ persona: 'ben', directory: 'E:\\gone' }, 'x')).toMatchObject({ ok: false, error: expect.stringContaining('does not exist') });
    expect(await w.service.start({ persona: 'ben', directory: 'E:\\T\\_worktrees\\T-0007' }, 'x')).toMatchObject({ ok: false, error: expect.stringContaining('live run') });
    expect(await w.service.start({ persona: 'nobody', directory: 'E:\\T' }, 'x')).toMatchObject({ ok: false, error: expect.stringContaining('not found') });
    expect(await w.service.start({ persona: 'pia', directory: 'E:\\T' }, 'x')).toMatchObject({ ok: false, error: expect.stringContaining('needs a harness') });
    expect(w.starts).toEqual([]);
  });

  it('req-269: never offers or starts Mission Control\'s persona, whatever harness its record names', async () => {
    const mission = { ...BEN, id: 'mara', title: 'Mara', kind: 'mission' } as Persona;
    const w = world(null, [BEN, mission]);
    const options = await w.service.options();
    expect(options.ok && options.personas.map((p) => p.id)).toEqual(['ben']);
    expect(await w.service.start({ persona: 'mara', directory: 'E:\\T' }, 'x')).toMatchObject({ ok: false, error: expect.stringContaining('not found') });
    expect(w.starts).toEqual([]);
  });

  it('offers the personas with a harness, the classes, the tickets vault first and the repos', async () => {
    const options = await world().service.options();
    expect(options).toEqual({
      ok: true,
      personas: [{ id: 'ben', title: 'Ben', worker: 'claude-code' }],
      classes: ['standard'],
      ticketsVault: 'E:\\T',
      repos: [{ name: 'drey', path: 'E:\\projects\\drey' }],
      permissionMode: 'accept-edits',
      defaultPersona: null,
      projects: [{ id: 'drey', name: 'Drey' }, { id: 'lariscus', name: 'Lariscus' }],
    });
    expect(await world().service.promptContext()).toBe('## Sessions you may propose\n\npersonas: ben (claude-code)\nfolders: E:\\T (the tickets repository); E:\\projects\\drey (drey)');
  });

  it('req-283: a session takes the project picked, else its folder\'s; an unknown pick starts nothing; the tickets vault has none', async () => {
    const w = world();
    await w.service.start({ persona: 'ben', directory: 'E:\\T', project: 'lariscus' }, 'drey:crew');
    await w.service.start({ persona: 'ben', directory: 'E:\\projects\\drey\\docs' }, 'drey:crew');
    await w.service.start({ persona: 'ben', directory: 'E:\\T' }, 'drey:crew');
    expect(w.starts.map((r) => r.projectId)).toEqual(['lariscus', 'drey', undefined]);
    expect(await w.service.start({ persona: 'ben', directory: 'E:\\T', project: 'gone' }, 'drey:crew')).toEqual({ ok: false, error: 'project "gone" not found' });
    expect(w.starts).toHaveLength(3);
  });
});
