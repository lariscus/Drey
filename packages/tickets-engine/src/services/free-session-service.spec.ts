import { describe, expect, it } from 'vitest';
import type { Persona } from '../core/persona';
import { LayeredConfigResolver } from '../fleet/config/layered-config-resolver';
import type { ModelsReply, RunInfo, RunRequest } from '../fleet/protocol';
import { parseCrewFile } from '../core/crew-file';
import { FreeSessionService } from './free-session-service';
import type { EngineVault } from './host';

const VAULT: EngineVault = { id: 'v', name: 'tickets', path: 'E:\\T', exists: true, active: true };
const BEN = { id: 'ben', kind: 'agent', title: 'Ben', role: 'build', worker: 'claude-code', models: { default: 'claude-code/sonnet', pool: [] }, color: '#fff', skills: [], budget: null, allowed: {} } as unknown as Persona;
const PIA = { ...BEN, id: 'pia', title: 'Pia', worker: 'api' } as Persona;

function world(crewText: string | null = null, personas: readonly Persona[] = [BEN, PIA]): { service: FreeSessionService; starts: RunRequest[]; sends: [string, string][]; runs: RunInfo[] } {
  const starts: RunRequest[] = [];
  const sends: [string, string][] = [];
  const runs: RunInfo[] = [{ id: 'R-live', ticketId: 'T-0007', state: 'running', worktreePath: 'E:\\T\\_worktrees\\T-0007' } as RunInfo];
  const crew = new LayeredConfigResolver().crew(parseCrewFile(crewText).config);
  const models = { models: [{ provider: 'claude-code', model: 'sonnet', class: 'B' }] } as unknown as ModelsReply;
  const service = new FreeSessionService({
    board: { detect: async () => VAULT, listPersonas: async () => personas, listRepos: async () => ({ repos: [{ name: 'drey', url: 'x', path: 'E:\\projects\\drey', profile: 'work' } as never] }) },
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
    expect(request).toMatchObject({ permissionMode: 'bypass', poolClass: 'B', origin: 'service-window', session: { kind: 'free', persona: 'ben', workingDirectory: 'E:\\T' } });
    expect(request.instruction).toContain('This folder is the tickets repository');
    expect(request.instruction).toContain('Ben builds.');
    expect(w.sends).toEqual([['R-1', 'Tidy the inbox.']]);
  });

  it('a session override wins over the vault; a repository folder takes its slot profile', async () => {
    const w = world('---\npermission-mode: bypass\n---\n');
    await w.service.start({ persona: 'ben', directory: 'E:\\projects\\drey\\src', permissionMode: 'read-only', poolClass: 'A' }, 'drey:crew');
    expect(w.starts[0]).toMatchObject({ permissionMode: 'read-only', poolClass: 'A', profile: 'work' });
    expect(w.sends).toEqual([]);
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
      classes: ['B'],
      ticketsVault: 'E:\\T',
      repos: [{ name: 'drey', path: 'E:\\projects\\drey' }],
      permissionMode: 'accept-edits',
      defaultPersona: null,
    });
    expect(await world().service.promptContext()).toBe('## Sessions you may propose\n\npersonas: ben (claude-code)\nfolders: E:\\T (the tickets repository); E:\\projects\\drey (drey)');
  });
});
