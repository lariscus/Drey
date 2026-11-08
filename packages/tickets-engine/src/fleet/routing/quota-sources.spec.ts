import { describe, expect, it } from 'vitest';
import { rateLimitEvent } from '../harness/claude-code-events';
import type { StreamJsonMessage } from '../harness/stream-json-codec';
import { MemoryFileSystem } from '../ports/memory-file-system.fake';
import { ClaudeCodeQuotaSource, parseClaudeCache } from './claude-code-quota-source';
import { KIMI_USAGES_URL, KimiQuotaSource, parseKimiUsages } from './kimi-quota-source';
import { FIVE_HOURS_MS, MONTH_MS, WEEK_MS } from './quota-source';
import { FakeClock, FakeQuotaHttp, fixture, slot } from './routing.fake';
import { parseZaiLimits, ZAI_QUOTA_URL, ZaiQuotaSource } from './zai-quota-source';

/**
 * Contract specs of the three real quota sources (req-177) over recorded
 * sample responses (`fixtures/`, provenance in its README). No spec calls
 * a real endpoint: the HTTP port is a fake.
 */

const AUTH = '/home/u/.local/share/opencode/auth.json';

describe('ZaiQuotaSource — the coding plan quota endpoint', () => {
  const now = new FakeClock(new Date('2026-11-13T23:00:00Z'));
  const zai = slot({ id: 'zai', provider: 'opencode', quota: 'zai', login: { opencodeAuthEntry: 'zai-coding-plan' } });

  function source(answer: ConstructorParameters<typeof FakeQuotaHttp>[0]): { http: FakeQuotaHttp; source: ZaiQuotaSource } {
    const fs = new MemoryFileSystem();
    fs.files.set(AUTH, JSON.stringify({ 'zai-coding-plan': { type: 'api', key: 'k-123' }, lmstudio: { type: 'api', key: 'x' } }));
    const http = new FakeQuotaHttp(answer);
    return { http, source: new ZaiQuotaSource({ http, fs, authFile: AUTH, clock: now }) };
  }

  it('reads the 5 h and the weekly window, measured; the tool-call TIME_LIMIT is left out', () => {
    expect(parseZaiLimits(fixture('zai-quota-limit.json'), now.now())).toEqual([
      { name: '5h', spanMs: FIVE_HOURS_MS, remaining: 0.55, resetsAt: '2026-11-14T02:00:00.000Z', reliability: 'measured', fetchedAt: '2026-11-13T23:00:00.000Z' },
      { name: '7d', spanMs: WEEK_MS, remaining: 0.7, resetsAt: '2026-11-18T00:00:00.000Z', reliability: 'measured', fetchedAt: '2026-11-13T23:00:00.000Z' },
    ]);
  });

  it('falls back to the percentage, and to the reset distance for an unknown unit', () => {
    const body = { data: { limits: [{ unit: 99, percentage: 20, nextResetTime: Date.parse('2026-11-14T01:00:00Z') }, { unit: 'hours', number: 5, percentage: 50 }] } };
    const windows = parseZaiLimits(body, now.now());
    expect(windows?.map((w) => [w.name, w.remaining])).toEqual([
      ['5h', 0.8],
      ['5h', 0.5],
    ]);
  });

  it("sends the key from opencode's auth entry, never stores it, and answers windows", async () => {
    const { http, source: zaiSource } = source(() => ({ status: 200, body: fixture('zai-quota-limit.json') }));
    const reading = await zaiSource.read(zai);
    expect(reading.kind).toBe('windows');
    expect(http.calls).toEqual([{ url: ZAI_QUOTA_URL, headers: { Authorization: 'Bearer k-123' } }]);
    expect(JSON.stringify(reading)).not.toContain('k-123');
  });

  it('tries the bare key once before a 401 counts as a refused login', async () => {
    const bare = source((_url, headers) => (headers['Authorization'] === 'k-123' ? { status: 200, body: fixture('zai-quota-limit.json') } : { status: 401, body: null }));
    expect((await bare.source.read(zai)).kind).toBe('windows');
    const refused = source(() => ({ status: 401, body: { code: 401, msg: 'token expired' } }));
    expect(await refused.source.read(zai)).toEqual({ kind: 'login', detail: 'z.ai refused the key of "zai-coding-plan" (401)' });
    expect(refused.http.calls).toHaveLength(2);
  });

  it('no key, a server error or a body without limits is unavailable, not a login', async () => {
    const { source: noKey } = source(() => ({ status: 200, body: {} }));
    expect((await noKey.read(slot({ id: 'z', provider: 'opencode', login: { opencodeAuthEntry: 'missing' } }))).kind).toBe('unavailable');
    expect((await source(() => ({ status: 500, body: null })).source.read(zai)).kind).toBe('unavailable');
    expect((await source(() => ({ status: 200, body: { data: {} } })).source.read(zai)).kind).toBe('unavailable');
  });
});

describe('KimiQuotaSource — the usages endpoint with the CLI login', () => {
  const now = new FakeClock(new Date('2026-11-09T00:00:00Z'));
  const kimi = slot({ id: 'kimi', provider: 'kimi', quota: 'kimi' });
  const credentials = (expiresAt: number): string => JSON.stringify({ access_token: 'at-9', refresh_token: 'rt', expires_at: expiresAt, token_type: 'Bearer' });

  function source(expiresAt: number, answer: ConstructorParameters<typeof FakeQuotaHttp>[0]): { http: FakeQuotaHttp; source: KimiQuotaSource } {
    const fs = new MemoryFileSystem();
    fs.files.set('/home/u/.kimi-code/credentials/kimi-code-env-1.json', credentials(expiresAt));
    const http = new FakeQuotaHttp(answer);
    return { http, source: new KimiQuotaSource({ http, fs, home: '/home/u/.kimi-code', clock: now }) };
  }

  it('reads the 5 h window and the two monthly ratios, measured', () => {
    expect(parseKimiUsages(fixture('kimi-usages.json'), now.now())).toEqual([
      { name: '5h', spanMs: FIVE_HOURS_MS, remaining: 0.75, resetsAt: '2026-11-09T03:00:00.000Z', reliability: 'measured', fetchedAt: '2026-11-09T00:00:00.000Z' },
      { name: 'month', spanMs: MONTH_MS, remaining: 0.6, resetsAt: '2026-12-01T00:00:00.000Z', reliability: 'measured', fetchedAt: '2026-11-09T00:00:00.000Z' },
      { name: 'month-code', spanMs: MONTH_MS, remaining: 0.9, resetsAt: '2026-12-01T00:00:00.000Z', reliability: 'measured', fetchedAt: '2026-11-09T00:00:00.000Z' },
    ]);
  });

  it("sends the CLI's access token as a bearer", async () => {
    const valid = Date.parse('2026-11-09T06:00:00Z') / 1000;
    const { http, source: kimiSource } = source(valid, () => ({ status: 200, body: fixture('kimi-usages.json') }));
    expect((await kimiSource.read(kimi)).kind).toBe('windows');
    expect(http.calls).toEqual([{ url: KIMI_USAGES_URL, headers: { Authorization: 'Bearer at-9' } }]);
  });

  it('skips an expired token without a fetch and without a login alarm: the CLI refreshes it on its next run', async () => {
    const { http, source: kimiSource } = source(Date.parse('2026-11-08T00:00:00Z') / 1000, () => ({ status: 200, body: {} }));
    expect((await kimiSource.read(kimi)).kind).toBe('unavailable');
    expect(http.calls).toHaveLength(0);
  });

  it('a 401 with a valid token is a refused login', async () => {
    const { source: kimiSource } = source(Date.parse('2026-11-09T06:00:00Z') / 1000, () => ({ status: 401, body: null }));
    expect(await kimiSource.read(kimi)).toEqual({ kind: 'login', detail: 'Kimi refused the CLI login (401)' });
  });
});

describe('ClaudeCodeQuotaSource — the rate-limit events of its runs, the cache between them', () => {
  const event = rateLimitEvent(fixture('claude-rate-limit-event.json') as StreamJsonMessage);
  const claudeA = slot({ id: 'claude-a', quota: 'claude-code', login: { claudeConfigDir: '/home/u/.claude-a' } });

  it("turns the adapter's reading into measured windows; rejected spends the window", async () => {
    const source = new ClaudeCodeQuotaSource(new MemoryFileSystem(), '/home/u');
    expect(source.observe('claude-a', event!.rateLimit!, new Date('2026-11-13T23:00:00Z'))).toBe(true);
    const reading = await source.read(claudeA);
    expect(reading).toEqual({
      kind: 'windows',
      windows: [
        { name: '5h', spanMs: FIVE_HOURS_MS, remaining: 0.78, resetsAt: '2026-11-14T02:00:00.000Z', reliability: 'measured', fetchedAt: '2026-11-13T23:00:00.000Z' },
        { name: '7d', spanMs: WEEK_MS, remaining: 0.62, resetsAt: '2026-11-18T00:00:00.000Z', reliability: 'measured', fetchedAt: '2026-11-13T23:00:00.000Z' },
      ],
    });
    source.observe('claude-a', { fiveHour: { utilization: 1, resetsAt: null, status: 'rejected' }, sevenDay: null }, new Date());
    const after = await source.read(claudeA);
    expect(after.kind === 'windows' && after.windows.map((w) => [w.name, w.remaining, w.rejected ?? false])).toEqual([
      ['5h', 0, true],
      ['7d', 0.62, false],
    ]);
  });

  it("keeps each account apart and reads the account's own .claude.json cache, estimated, before any run", async () => {
    const fs = new MemoryFileSystem();
    fs.files.set('/home/u/.claude-a/.claude.json', JSON.stringify(fixture('claude-cached-usage.json')));
    const source = new ClaudeCodeQuotaSource(fs, '/home/u');
    source.observe('claude-b', event!.rateLimit!, new Date());
    const reading = await source.read(claudeA);
    expect(reading.kind === 'windows' && reading.windows.map((w) => [w.name, w.remaining, w.reliability])).toEqual([
      ['5h', 0.36, 'estimated'],
      ['7d', 0.5, 'estimated'],
    ]);
    expect((await source.read(slot({ id: 'default', quota: 'claude-code' }))).kind).toBe('unavailable');
  });

  it('reads the cache leniently and an unknown file as nothing', () => {
    expect(parseClaudeCache(null)).toEqual([]);
    expect(parseClaudeCache('{broken')).toEqual([]);
    expect(parseClaudeCache(JSON.stringify({ cachedUsageUtilization: { fiveHour: { utilization: 0.1 } } }))[0]?.remaining).toBeCloseTo(0.9);
  });
});
