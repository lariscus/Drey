import { describe, expect, it, vi } from 'vitest';
import type { TicketsRemotePort } from '../contracts/remote-protocol';
import type { SkillListData } from '../contracts/skills';
import { DeviceRegistry, FailureLimiter, PairingCodes } from './auth';
import { route, type RemoteRequest, type RouterDeps } from './router';

/** req-172: the skill routes — shapes in, the port's call out, the id pinned by the path. */

const HOST = '127.0.0.1:47811';
const origin = `http://${HOST}`;
const LIST: SkillListData = { persona: 'ben', skills: [], missing: [], selectedTokens: 0, tokenizer: { id: 'claude-estimate', family: 'anthropic', exact: false, model: null } };

function setup() {
  const reply = { ok: true as const, list: LIST };
  const remote = {
    sharedSkills: vi.fn(async () => reply),
    personaSkills: vi.fn(async () => reply),
    personaSkillToggle: vi.fn(async () => reply),
    personaSkillRemove: vi.fn(async () => reply),
    skillUpload: vi.fn(async () => ({ ok: true as const, name: 'review', origin: 'shared' as const, files: 1, replaced: false, list: LIST })),
    personaPromptPreview: vi.fn(async () => ({ ok: true as const, persona: 'ben', step: 'build', text: 'brief', tokens: 2, tokenizer: LIST.tokenizer, parts: [], skills: [] })),
  };
  const devices = new DeviceRegistry([], async () => undefined);
  const deps: RouterDeps = {
    port: remote as unknown as TicketsRemotePort,
    devices,
    pairing: new PairingCodes(),
    limiter: new FailureLimiter(3, 60_000),
    allowedHosts: () => new Set([HOST]),
    now: () => new Date('2026-11-09T10:00:00Z'),
    log: () => undefined,
    onPaired: () => undefined,
  };
  return { deps, devices, remote };
}

const req = (patch: Partial<RemoteRequest>): RemoteRequest => ({ method: 'GET', path: '/api/skills', host: HOST, origin: undefined, authorization: undefined, body: undefined, remote: '127.0.0.1', ...patch });

async function paired(devices: DeviceRegistry, readOnly = false): Promise<string> {
  return `Bearer ${(await devices.add(readOnly ? 'Viewer' : 'iPhone', readOnly, new Date())).token}`;
}

describe('GET /api/skills and /api/personas/<id>/skills', () => {
  it('lists the shared pool, and a persona\'s skills with the id pinned by the grammar', async () => {
    const { deps, devices, remote } = setup();
    const authorization = await paired(devices, true);
    expect(await route(req({ authorization }), deps)).toEqual({ status: 200, body: { ok: true, list: LIST } });
    expect(remote.sharedSkills).toHaveBeenCalledOnce();
    expect((await route(req({ path: '/api/personas/ben/skills', authorization }), deps)).status).toBe(200);
    expect(remote.personaSkills).toHaveBeenCalledWith('ben');
    expect((await route(req({ path: '/api/personas/Ben%2Fx/skills', authorization }), deps)).status).toBe(404);
  });

  it('needs a paired device', async () => {
    expect((await route(req({}), setup().deps)).status).toBe(401);
  });
});

describe('GET /api/personas/<id>/prompt', () => {
  it('asks the port for the preview with the step and model from the query', async () => {
    const { deps, devices, remote } = setup();
    const authorization = await paired(devices, true);
    const reply = await route(req({ path: '/api/personas/ben/prompt', query: new URLSearchParams('step=review&model=opencode%2Fqwen'), authorization }), deps);
    expect(reply.status).toBe(200);
    expect(remote.personaPromptPreview).toHaveBeenCalledWith({ persona: 'ben', step: 'review', model: 'opencode/qwen' });
    await route(req({ path: '/api/personas/ben/prompt', authorization }), deps);
    expect(remote.personaPromptPreview).toHaveBeenLastCalledWith({ persona: 'ben' });
  });
});

describe('POST /api/personas/<id>/skills/toggle and /remove', () => {
  it('toggles a skill and removes an own one, the persona from the path', async () => {
    const { deps, devices, remote } = setup();
    const authorization = await paired(devices);
    await route(req({ method: 'POST', path: '/api/personas/ben/skills/toggle', origin, authorization, body: { skill: 'review', on: true } }), deps);
    expect(remote.personaSkillToggle).toHaveBeenCalledWith({ persona: 'ben', skill: 'review', on: true });
    await route(req({ method: 'POST', path: '/api/personas/ben/skills/remove', origin, authorization, body: { name: 'mine' } }), deps);
    expect(remote.personaSkillRemove).toHaveBeenCalledWith({ persona: 'ben', name: 'mine' });
  });

  it('refuses a body that is not the shape, without calling the port', async () => {
    const { deps, devices, remote } = setup();
    const authorization = await paired(devices);
    const bad = await route(req({ method: 'POST', path: '/api/personas/ben/skills/toggle', origin, authorization, body: { skill: 'review', on: 'yes' } }), deps);
    expect(bad.body).toEqual({ ok: false, error: 'a toggle needs skill (a name) and on (true or false)' });
    const none = await route(req({ method: 'POST', path: '/api/personas/ben/skills/remove', origin, authorization, body: {} }), deps);
    expect(none.body).toMatchObject({ ok: false });
    expect(remote.personaSkillToggle).not.toHaveBeenCalled();
    expect(remote.personaSkillRemove).not.toHaveBeenCalled();
  });

  it('a read-only device gets the usual 403 on every write', async () => {
    const { deps, devices } = setup();
    const authorization = await paired(devices, true);
    for (const path of ['/api/personas/ben/skills/toggle', '/api/personas/ben/skills/remove', '/api/skills']) {
      expect((await route(req({ method: 'POST', path, origin, authorization, body: {} }), deps)).status).toBe(403);
    }
  });
});

describe('POST /api/skills', () => {
  it('uploads a markdown text into the shared pool, and a zip into a persona\'s own home', async () => {
    const { deps, devices, remote } = setup();
    const authorization = await paired(devices);
    const md = await route(req({ method: 'POST', path: '/api/skills', origin, authorization, body: { scope: 'shared', format: 'markdown', text: '# S', name: 'review' } }), deps);
    expect(md.status).toBe(200);
    expect(remote.skillUpload).toHaveBeenCalledWith({ scope: 'shared', format: 'markdown', text: '# S', name: 'review' });
    await route(req({ method: 'POST', path: '/api/skills', origin, authorization, body: { scope: 'own', persona: 'ben', format: 'zip', zipBase64: 'UEs=', overwrite: true } }), deps);
    expect(remote.skillUpload).toHaveBeenLastCalledWith({ scope: 'own', persona: 'ben', format: 'zip', zipBase64: 'UEs=', overwrite: true });
  });

  it('refuses an unknown scope or format and a non-boolean overwrite before the port', async () => {
    const { deps, devices, remote } = setup();
    const authorization = await paired(devices);
    for (const body of [{ scope: 'all', format: 'zip' }, { scope: 'shared', format: 'tar' }, { scope: 'shared', format: 'zip', overwrite: 'yes' }, 'text']) {
      const reply = await route(req({ method: 'POST', path: '/api/skills', origin, authorization, body }), deps);
      expect(reply.body).toMatchObject({ ok: false }, JSON.stringify(body));
    }
    expect(remote.skillUpload).not.toHaveBeenCalled();
  });
});
