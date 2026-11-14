import { describe, expect, it, vi } from 'vitest';
import type { TicketsRemotePort } from '../contracts/remote-protocol';
import { DeviceRegistry, FailureLimiter, PairingCodes } from './auth';
import { ChangeHub, DreyTicketsPort } from './drey-port';
import { route, type RemoteRequest, type RouterDeps } from './router';

/** req-288: the picture routes — the id pinned by the path, the data URL from the body, the service's answer passed on. */

const HOST = '127.0.0.1:47811';
const origin = `http://${HOST}`;
const PNG_URL = 'data:image/png;base64,iVBORw0KGgo=';

function setup() {
  const remote = { personaAvatarSet: vi.fn(async () => ({ ok: true })), personaAvatarRemove: vi.fn(async () => ({ ok: true })) };
  const devices = new DeviceRegistry([], async () => undefined);
  const deps: RouterDeps = {
    port: remote as unknown as TicketsRemotePort,
    devices,
    pairing: new PairingCodes(),
    limiter: new FailureLimiter(3, 60_000),
    allowedHosts: () => new Set([HOST]),
    now: () => new Date('2026-11-14T10:00:00Z'),
    log: () => undefined,
    onPaired: () => undefined,
  };
  return { deps, devices, remote };
}

const req = (patch: Partial<RemoteRequest>): RemoteRequest => ({ method: 'POST', path: '/api/personas/ben/avatar', host: HOST, origin, authorization: undefined, body: undefined, remote: '127.0.0.1', ...patch });
const paired = async (devices: DeviceRegistry, readOnly = false): Promise<string> => `Bearer ${(await devices.add(readOnly ? 'Viewer' : 'iPhone', readOnly, new Date())).token}`;

describe('POST /api/personas/<id>/avatar and /avatar/remove (req-288)', () => {
  it('an upload passes the persona from the path and the data URL from the body', async () => {
    const { deps, devices, remote } = setup();
    const authorization = await paired(devices);
    expect(await route(req({ authorization, body: { dataUrl: PNG_URL } }), deps)).toEqual({ status: 200, body: { ok: true } });
    expect(remote.personaAvatarSet).toHaveBeenCalledWith({ persona: 'ben', dataUrl: PNG_URL });
  });

  it('a removal names only the persona; a body without the data URL refuses an upload without calling the port', async () => {
    const { deps, devices, remote } = setup();
    const authorization = await paired(devices);
    expect((await route(req({ authorization, path: '/api/personas/ben/avatar/remove' }), deps)).status).toBe(200);
    expect(remote.personaAvatarRemove).toHaveBeenCalledWith({ persona: 'ben' });
    expect((await route(req({ authorization, body: {} }), deps)).body).toMatchObject({ ok: false });
    expect(remote.personaAvatarSet).not.toHaveBeenCalled();
  });

  it('a read-only device may change no picture', async () => {
    const { deps, devices, remote } = setup();
    const viewer = await paired(devices, true);
    expect((await route(req({ authorization: viewer, body: { dataUrl: PNG_URL } }), deps)).status).toBe(403);
    expect(remote.personaAvatarSet).not.toHaveBeenCalled();
  });
});

describe('DreyTicketsPort — the picture writes (req-288)', () => {
  it('passes them to the wired service, and refuses without one', async () => {
    const pictures = { set: vi.fn(async () => ({ ok: true as const })), remove: vi.fn(async () => ({ ok: true as const })) };
    const board = {} as ConstructorParameters<typeof DreyTicketsPort>[0];
    const fleet = {} as ConstructorParameters<typeof DreyTicketsPort>[1];
    const wired = new DreyTicketsPort(board, fleet, new ChangeHub(), { allowBypass: () => false, pictures });
    await wired.personaAvatarSet({ persona: 'ben', dataUrl: PNG_URL });
    await wired.personaAvatarRemove({ persona: 'ben' });
    expect(pictures.set).toHaveBeenCalledWith({ persona: 'ben', dataUrl: PNG_URL });
    expect(pictures.remove).toHaveBeenCalledWith({ persona: 'ben' });
    const bare = new DreyTicketsPort(board, fleet, new ChangeHub(), { allowBypass: () => false });
    expect(await bare.personaAvatarRemove({ persona: 'ben' })).toMatchObject({ ok: false });
  });
});
