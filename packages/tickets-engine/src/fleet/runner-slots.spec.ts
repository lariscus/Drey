import { promises as fsp } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sseFrame } from './api/event-stream';
import type { SlotView } from './protocol';
import { FakeQuotaHttp, fixture } from './routing/routing.fake';
import { startRunner, type RunnerHandle } from './runner';

/**
 * The slots on the real runner, in-process (req-177): `GET /slots`, the
 * slot summary on `GET /chain`, the `service.json` it creates and writes,
 * a configured z.ai slot read through the (fake) quota endpoint. The user's
 * home and the network are the spec's own.
 */
describe('the runner serves the slots (req-177)', () => {
  let tmp = '';
  let runner: RunnerHandle | null = null;
  /** The recorded z.ai answer with its resets moved ahead of the wall clock (this runner runs on real time). */
  const zaiNow = (): unknown => {
    const body = fixture('zai-quota-limit.json') as { data: { limits: { nextResetTime: number; number: number }[] } };
    body.data.limits.forEach((limit, i) => (limit.nextResetTime = Date.now() + (i === 0 ? 2 : 72) * 3_600_000));
    return body;
  };
  const http = new FakeQuotaHttp(() => ({ status: 200, body: zaiNow() }));

  beforeEach(async () => {
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'drey-slots-'));
    const auth = path.join(tmp, 'home', '.local', 'share', 'opencode');
    await fsp.mkdir(auth, { recursive: true });
    await fsp.writeFile(path.join(auth, 'auth.json'), JSON.stringify({ 'zai-coding-plan': { type: 'api', key: 'k-1' } }), 'utf8');
    http.calls.length = 0;
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

  it('creates service.json in the service home and serves the implied slots without a network call', async () => {
    expect(JSON.parse(await fsp.readFile(path.join(tmp, 'service.json'), 'utf8'))).toEqual({ slots: [] });
    const { status, body } = await call('GET', '/slots');
    expect(status).toBe(200);
    expect((body['slots'] as SlotView[]).map((s) => [s.id, s.profile, s.implied])).toEqual([
      ['opencode', 'private', true],
      ['claude-code', 'private', true],
      ['kimi', 'private', true],
      ['copilot', 'private', true],
    ]);
    expect(body['configPath']).toBe(path.join(tmp, 'service.json'));
    expect(http.calls).toEqual([]);
  });

  it('writes the slots (other keys kept), reads a configured z.ai quota, and the chain status carries the summary', async () => {
    await fsp.writeFile(path.join(tmp, 'service.json'), JSON.stringify({ slots: [], models: ['kept'] }), 'utf8');
    const written = await call('POST', '/slots/config', { slots: [{ id: 'zai', label: 'z.ai', provider: 'opencode', login: { opencodeAuthEntry: 'zai-coding-plan' } }] });
    expect(written.status).toBe(200);
    expect(JSON.parse(await fsp.readFile(path.join(tmp, 'service.json'), 'utf8'))).toMatchObject({ models: ['kept'], slots: [{ id: 'zai' }] });
    const zai = (written.body['slots'] as SlotView[]).find((s) => s.id === 'zai');
    expect(zai).toMatchObject({ quota: 'zai', state: 'ready', windows: [{ name: '5h', reliability: 'measured' }, { name: '7d', reliability: 'measured' }] });
    expect(http.calls[0]?.headers).toEqual({ Authorization: 'Bearer k-1' });
    const chain = await call('GET', '/chain');
    expect((chain.body['slots'] as unknown[]).length).toBe(4);
    expect(chain.body['slots']).toContainEqual(expect.objectContaining({ id: 'zai', state: 'ready', reliability: 'measured' }));
  });

  it('refuses a slot list with a broken entry, and an unknown slot', async () => {
    expect((await call('POST', '/slots/config', { slots: [{ id: 'x', provider: 'gemini' }] })).status).toBe(422);
    expect((await call('POST', '/slots/config', {})).status).toBe(422);
    expect((await call('POST', '/slots/login-done', { id: 'nope' })).status).toBe(404);
    expect((await call('POST', '/slots/refresh', { id: 'nope' })).status).toBe(404);
    expect((await call('POST', '/slots/refresh', {})).status).toBe(200);
  });

  it('adds one slot and removes one, every other entry kept as written (D-69)', async () => {
    const kept = { id: 'claude-a', provider: 'claude-code', login: { claudeConfigDir: 'C:/a' }, limits: [{ window: '5h', budget: 9 }] };
    await fsp.writeFile(path.join(tmp, 'service.json'), JSON.stringify({ slots: [kept], models: ['kept'] }), 'utf8');
    const added = await call('POST', '/slots/add', { slot: { id: 'kimi-work', provider: 'kimi', profile: 'work' } });
    expect(added.status).toBe(200);
    expect((added.body['slots'] as SlotView[]).map((s) => s.id)).toEqual(['claude-a', 'kimi-work', 'opencode', 'copilot']);
    expect((await call('POST', '/slots/add', { slot: { id: 'claude-a', provider: 'claude-code' } })).status).toBe(422);
    // An implied slot: its provider leaves the machine's slots.
    const removed = await call('POST', '/slots/remove', { id: 'copilot' });
    expect(removed.status).toBe(200);
    expect((removed.body['slots'] as SlotView[]).map((s) => s.id)).toEqual(['claude-a', 'kimi-work', 'opencode']);
    expect((await call('POST', '/slots/remove', { id: 'kimi-work' })).status).toBe(200);
    expect((await call('POST', '/slots/remove', { id: 'nope' })).status).toBe(422);
    expect(JSON.parse(await fsp.readFile(path.join(tmp, 'service.json'), 'utf8'))).toEqual({ slots: [kept], models: ['kept'], impliedOff: ['copilot'] });
  });

  it('clears a needs login on the owner’s word', async () => {
    const reply = await call('POST', '/slots/login-done', { id: 'claude-code' });
    expect(reply.body).toMatchObject({ ok: true, slot: { id: 'claude-code' } });
  });
});

describe('the slot event on the SSE stream', () => {
  it("is named slot and carries the slot's view", () => {
    const view = { id: 'claude-a', state: 'busy' } as SlotView;
    expect(sseFrame({ kind: 'slot', slot: view })).toBe(`event: slot\ndata: ${JSON.stringify(view)}\n\n`);
  });
});
