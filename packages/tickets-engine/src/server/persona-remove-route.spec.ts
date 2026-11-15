import { describe, expect, it, vi } from 'vitest';
import type { TicketsRemotePort } from '../contracts/remote-protocol';
import { DeviceRegistry, FailureLimiter, PairingCodes } from './auth';
import { ChangeHub, DreyTicketsPort } from './drey-port';
import { route, type RemoteRequest, type RouterDeps } from './router';

/** req-261: the removal route — shape in, the port's call out, the id pinned by the path, the answer as the service gave it. */

const HOST = '127.0.0.1:47811';
const origin = `http://${HOST}`;

function setup(reply: unknown = { ok: true, persona: 'ben', files: 3 }) {
  const remote = { personaRemove: vi.fn(async () => reply) };
  const devices = new DeviceRegistry([], async () => undefined);
  const deps: RouterDeps = {
    port: remote as unknown as TicketsRemotePort,
    devices,
    pairing: new PairingCodes(),
    limiter: new FailureLimiter(3, 60_000),
    allowedHosts: () => new Set([HOST]),
    now: () => new Date('2026-11-10T10:00:00Z'),
    log: () => undefined,
    onPaired: () => undefined,
  };
  return { deps, devices, remote };
}

const req = (patch: Partial<RemoteRequest>): RemoteRequest => ({ method: 'POST', path: '/api/personas/ben/remove', host: HOST, origin, authorization: undefined, body: undefined, remote: '127.0.0.1', ...patch });
const paired = async (devices: DeviceRegistry, readOnly = false): Promise<string> => `Bearer ${(await devices.add(readOnly ? 'Viewer' : 'iPhone', readOnly, new Date())).token}`;

describe('POST /api/personas/<id>/remove', () => {
  it('passes the persona from the path and the typed title from the body, and answers what the service said', async () => {
    const { deps, devices, remote } = setup();
    const authorization = await paired(devices);
    expect(await route(req({ authorization, body: { confirm: 'Ben' } }), deps)).toEqual({ status: 200, body: { ok: true, persona: 'ben', files: 3 } });
    expect(remote.personaRemove).toHaveBeenCalledWith({ persona: 'ben', confirm: 'Ben' });
  });

  it('hands a refusal with its code to the client unchanged', async () => {
    const refusal = { ok: false, code: 'busy', error: 'Ben has a live run' };
    const { deps, devices } = setup(refusal);
    const authorization = await paired(devices);
    expect((await route(req({ authorization, body: { confirm: 'Ben' } }), deps)).body).toEqual(refusal);
  });

  it('refuses a body without the typed title, without calling the port', async () => {
    const { deps, devices, remote } = setup();
    const authorization = await paired(devices);
    for (const body of [{}, { confirm: 3 }, [], null]) {
      expect((await route(req({ authorization, body }), deps)).body).toMatchObject({ ok: false });
    }
    expect(remote.personaRemove).not.toHaveBeenCalled();
  });

  it('pins the id by the grammar and gives a read-only device the usual 403', async () => {
    const { deps, devices, remote } = setup();
    const authorization = await paired(devices);
    expect((await route(req({ authorization, path: '/api/personas/Ben%2Fx/remove', body: { confirm: 'x' } }), deps)).status).toBe(404);
    expect(remote.personaRemove).not.toHaveBeenCalled();
    const viewer = await paired(devices, true);
    expect((await route(req({ authorization: viewer, body: { confirm: 'Ben' } }), deps)).status).toBe(403);
  });
});

describe('DreyTicketsPort.personaRemove', () => {
  it('delegates to the removal service, and says so when none is wired', async () => {
    const service = { personaRemove: vi.fn(async () => ({ ok: true as const, persona: 'ben', files: 1 })) };
    const board = {} as ConstructorParameters<typeof DreyTicketsPort>[0];
    const fleet = {} as ConstructorParameters<typeof DreyTicketsPort>[1];
    const wired = new DreyTicketsPort(board, fleet, new ChangeHub(), { allowBypass: () => false }, null, null, null, null, service);
    expect(await wired.personaRemove({ persona: 'ben', confirm: 'Ben' })).toEqual({ ok: true, persona: 'ben', files: 1 });
    expect(service.personaRemove).toHaveBeenCalledWith({ persona: 'ben', confirm: 'Ben' });
    expect(() => new DreyTicketsPort(board, fleet, new ChangeHub(), { allowBypass: () => false }).personaRemove({ persona: 'ben', confirm: 'Ben' })).toThrow(/not wired/);
  });
});
