import { promises as fsp } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ModelsReply } from './protocol';
import { FakeQuotaHttp } from './routing/routing.fake';
import { startRunner, type RunnerHandle } from './runner';

/**
 * The capacity pool on the real runner, in-process (req-170): `GET /models`,
 * `POST /models/config` (checked before anything is written, every other
 * key of `service.json` kept), the pool's load and queue on `GET /chain`,
 * and the one-time move of the plugin's pool sizes into the slots.
 */
describe('the runner serves the capacity pool (req-170)', () => {
  let tmp = '';
  let runner: RunnerHandle | null = null;
  const http = new FakeQuotaHttp(() => ({ status: 500, body: {} }));
  const serviceJson = async (): Promise<Record<string, unknown>> => JSON.parse(await fsp.readFile(path.join(tmp, 'service.json'), 'utf8')) as Record<string, unknown>;

  beforeEach(async () => {
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'drey-models-'));
    runner = await startRunner({ root: path.join(tmp, 'fleet'), idleMs: 60 * 60_000 }, { exit: () => undefined, stdout: () => undefined, signals: false, userHome: path.join(tmp, 'home'), quotaHttp: http });
  });

  afterEach(async () => {
    await runner?.stop();
    await fsp.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  });

  const call = async (method: 'GET' | 'POST', route: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown> }> => {
    const res = await fetch(`http://127.0.0.1:${runner!.port}${route}`, {
      method,
      headers: { Authorization: `Bearer ${runner!.token}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };

  it('serves an empty table, writes the keys it is sent and keeps the others', async () => {
    const empty = (await call('GET', '/models')).body as unknown as ModelsReply;
    expect(empty).toMatchObject({ ok: true, models: [], capacity: { global: null, perSlot: {} }, ledgers: { ticketAllowance: null, personaPerDay: null, providerPerDay: null }, queue: [], errors: [] });
    expect(empty.now).toMatchObject({ used: 0, global: null });

    const models = [{ model: 'claude-opus-4-1', provider: 'claude-code', category: 'frontier', class: 'A', cost: 5, sessions: 1 }];
    const written = await call('POST', '/models/config', { models, capacity: { global: 6, perSlot: {} } });
    expect(written.status).toBe(200);
    expect(written.body['models']).toEqual([{ ...models[0], slot: null }]);
    await call('POST', '/models/config', { ledgers: { ticketAllowance: 2.5, personaPerDay: 5, providerPerDay: 15 } });
    const file = await serviceJson();
    expect(file['slots']).toEqual([]);
    expect(file['models']).toEqual(models);
    expect(file['capacity']).toEqual({ global: 6, perSlot: {} });
    expect(file['ledgers']).toEqual({ ticketAllowance: 2.5, personaPerDay: 5, providerPerDay: 15 });

    const chain = (await call('GET', '/chain')).body;
    expect(chain['pool']).toMatchObject({ used: 0, global: 6 });
    expect(chain['queue']).toEqual([]);
  });

  it('refuses a broken row before anything is written', async () => {
    const before = await serviceJson();
    const refused = await call('POST', '/models/config', { models: [{ model: 'x', provider: 'claude-code', class: 'Z' }] });
    expect(refused).toEqual({ status: 422, body: { ok: false, error: 'model "x": class must be A, B or C' } });
    expect((await call('POST', '/models/config', {})).status).toBe(422);
    expect(await serviceJson()).toEqual(before);
  });

  it("moves the plugin's pool sizes into the slots' sessions once, on the first chain config", async () => {
    const vault = path.join(tmp, 'vault');
    await fsp.mkdir(vault, { recursive: true });
    await call('POST', '/chain/config', { ticketsVaultPath: vault, pools: { 'claude-code': { size: 2 } } });
    const file = await serviceJson();
    expect(file['migrations']).toEqual(['fleet.pool.size']);
    expect((file['slots'] as { id: string; sessions: number }[]).map((s) => [s.id, s.sessions])).toEqual([
      ['opencode', 1],
      ['claude-code', 2],
      ['kimi', 1],
    ]);
    await call('POST', '/chain/config', { ticketsVaultPath: vault, pools: { 'claude-code': { size: 5 } } });
    expect(((await serviceJson())['slots'] as { sessions: number }[])[1]!.sessions).toBe(2);
    expect(((await call('GET', '/chain')).body['poolSize'] as Record<string, number>)['claude-code']).toBe(2);
  });
});
