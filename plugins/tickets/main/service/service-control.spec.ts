import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ServiceControl, type GatewayProbe } from './service-control';

/**
 * The status Settings → Background service draws, from the service's
 * `service.lock` and its control port (req-165). A tiny server stands in
 * for the control port: `/health` answers, `/shutdown` and
 * `/components/runner/*` record the call.
 */
let home: string;
let server: http.Server;
const calls: string[] = [];

async function listen(): Promise<number> {
  server = http.createServer((req, res) => {
    calls.push(`${req.method} ${req.url} ${req.headers.authorization ?? ''}`);
    res.writeHead(req.url === '/components/runner/stop' ? 409 : 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(req.url === '/components/runner/stop' ? { ok: false, error: 'busy' } : { ok: true }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

async function writeLock(port: number, runner: string): Promise<void> {
  const record = (state: string) => ({ state, detail: null });
  await writeFile(
    path.join(home, 'service.lock'),
    JSON.stringify({
      version: 1,
      pid: process.pid,
      build: 'b',
      startedAt: '2026-11-08T08:12:00.000Z',
      home,
      vaultPath: home,
      port,
      token: 'secret',
      components: { engine: record('running'), runner: record(runner), gateway: record('stopped'), mcp: record('external') },
    }),
  );
}

const gateway = (patch: Partial<GatewayProbe> = {}): GatewayProbe => ({ config: { enabled: false }, listening: null, devices: [], error: null, ...patch });

beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), 'drey-service-control-'));
  calls.length = 0;
});

afterEach(async () => {
  await new Promise<void>((resolve) => (server === undefined ? resolve() : server.close(() => resolve())));
  await rm(home, { recursive: true, force: true });
});

const control = (probe: GatewayProbe = gateway(), runs = 2) =>
  new ServiceControl({ home: () => home, liveRuns: async () => runs, gateway: async () => probe });

describe('ServiceControl.status', () => {
  it('is stopped, with the home, when there is no lock', async () => {
    const status = await control().status();
    expect(status.running).toBe(false);
    expect(status.home).toBe(home);
  });

  it('is stopped when the lock is stale: nothing answers on its port', async () => {
    await writeLock(1, 'running');
    expect((await control().status()).running).toBe(false);
  });

  it('reads a live service: start time, live runs, component states and the gateway', async () => {
    await writeLock(await listen(), 'sleeping');
    const probe = gateway({ config: { enabled: true }, listening: '127.0.0.1:52900', devices: [{}, {}] });
    expect(await control(probe, 3).status()).toEqual({
      running: true,
      home,
      logFolder: path.join(home, 'logs'),
      startedAt: '2026-11-08T08:12:00.000Z',
      liveRuns: 3,
      gateway: { enabled: true, listening: true, devices: 2, failed: false },
      components: { engine: 'running', runner: 'sleeping' },
    });
  });

  it('marks an enabled gateway that is not listening and has an error as failed', async () => {
    await writeLock(await listen(), 'running');
    const status = await control(gateway({ config: { enabled: true }, error: 'port in use' })).status();
    expect(status.gateway).toMatchObject({ enabled: true, listening: false, failed: true });
  });

  it('survives a gateway that cannot be read', async () => {
    await writeLock(await listen(), 'running');
    const broken = new ServiceControl({
      home: () => home,
      liveRuns: async () => {
        throw new Error('no fleet');
      },
      gateway: async () => {
        throw new Error('no engine');
      },
    });
    const status = await broken.status();
    expect(status.running).toBe(true);
    expect(status.liveRuns).toBe(0);
    expect(status.gateway.enabled).toBe(false);
  });
});

describe('ServiceControl calls', () => {
  it('posts the runner calls with the lock token and reports the service\'s refusal', async () => {
    await writeLock(await listen(), 'running');
    expect(await control().runner('start')).toEqual({ ok: true });
    expect(await control().runner('stop')).toEqual({ ok: false, error: 'busy' });
    expect(calls.filter((c) => c.startsWith('POST'))).toEqual(['POST /components/runner/start Bearer secret', 'POST /components/runner/stop Bearer secret']);
  });

  it('refuses a runner call when no service runs', async () => {
    expect((await control().runner('start')).ok).toBe(false);
  });
});
