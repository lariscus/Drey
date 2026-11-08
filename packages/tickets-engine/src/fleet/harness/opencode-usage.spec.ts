import { describe, expect, it, vi } from 'vitest';
import { telemetryFromEvents } from '../telemetry';
import { opencodeAdapter } from './opencode';
import { assistant, scriptedFetch } from './opencode-server.fake';
import { collect, fakeProcess, spawnOf } from './worker-process.fake';

/**
 * The opencode adapter against a scripted `opencode serve` (no real
 * binary) — the usage a run reports: a resumed session's base, turn usage once per message.
 */

describe('the opencode adapter', () => {
  it('a resumed session counts only this run: the totals before the first prompt are the base (req-53)', async () => {
    vi.useFakeTimers();
    const prompts: string[] = [];
    let created = false;
    const usage = { tokens: { input: 1_000, cache: { read: 9_000 }, output: 50 }, cost: 0.5 };
    const { fetch } = scriptedFetch({
      sessionCreated: () => {
        created = true;
      },
      prompts,
      interrupts: [],
      messages: () => [],
      usage,
    });
    const bases: unknown[] = [];
    const proc = fakeProcess();
    const { events, start } = collect({ resumeRef: 'ses_oc', onUsageBase: (base) => bases.push(base) });
    opencodeAdapter(spawnOf(proc), fetch, async () => 47000).spawn(start);
    // the stdout listener is attached once the port is picked
    await vi.advanceTimersByTimeAsync(100);
    proc.stdout('server password sekrit');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(created).toBe(false);
    expect(bases).toEqual([{ tokensIn: 10_000, tokensOut: 50, cacheReadTokens: 9_000, costUsd: 0.5 }]);
    expect(prompts[0]).toContain('Do the ticket.');

    usage.tokens = { input: 1_500, cache: { read: 12_000 }, output: 80 };
    usage.cost = 0.7;
    await vi.advanceTimersByTimeAsync(2_500);
    const last = events.filter((e) => e.kind === 'usage' && e.tokensIn !== undefined).at(-1);
    expect(last?.tokensIn).toBe(3_500);
    expect(last?.cacheReadTokens).toBe(3_000);
    expect(last?.tokensOut).toBe(30);
    expect(last?.costUsd).toBeCloseTo(0.2);
    proc.exit(null);
    vi.useRealTimers();
  });

  it('a resumed session never replays its old messages — text, tools or turn usage (req-80)', async () => {
    vi.useFakeTimers();
    const at = Date.now();
    const old = {
      ...(assistant(at - 100_000) as object),
      id: 'msg_old',
      content: [
        { type: 'text', text: 'old answer' },
        { type: 'tool', id: 'tool_old', name: 'read', state: { input: { filePath: 'a.ts' } } },
      ],
      tokens: { input: 100, cache: { read: 300_000 }, output: 40 },
    };
    const messages: unknown[] = [old];
    const { fetch } = scriptedFetch({ sessionCreated: () => undefined, prompts: [], interrupts: [], messages: () => messages });
    const proc = fakeProcess();
    const { events, start } = collect({ resumeRef: 'ses_oc' });
    opencodeAdapter(spawnOf(proc), fetch, async () => 47000).spawn(start);
    await vi.advanceTimersByTimeAsync(100);
    proc.stdout('server password sekrit');
    await vi.advanceTimersByTimeAsync(1_000);
    messages.unshift({ ...(assistant(Date.now()) as object), id: 'msg_new' });
    await vi.advanceTimersByTimeAsync(2_500);

    expect(events.filter((e) => e.kind === 'text').map((e) => e.text)).toEqual(['Done.']);
    expect(events.some((e) => e.tool === 'read')).toBe(false);
    expect(events.filter((e) => e.turnUsage !== undefined).map((e) => e.turnUsage)).toEqual([
      { input: 8, cacheRead: null, cacheCreation: null, output: 5 },
    ]);
    proc.exit(null);
    vi.useRealTimers();
  });

  it('emits turnUsage once per completed message — telemetry sums turns, never the session aggregate', async () => {
    vi.useFakeTimers();
    const at = Date.now();
    const first = {
      id: 'msg_1',
      type: 'assistant',
      time: { created: at + 1, completed: at + 2 },
      content: [{ type: 'tool', id: 'call_1', name: 'read', state: { status: 'completed', input: { path: 'src/a.ts' } } }],
      tokens: { input: 700, cache: { read: 12_000 }, output: 200 },
    };
    const second = {
      id: 'msg_2',
      type: 'assistant',
      time: { created: at + 3, completed: at + 4 },
      content: [{ type: 'tool', id: 'call_2', name: 'write', state: { status: 'completed', input: { path: 'src/b.ts' } } }],
      tokens: { input: 800, cache: { read: 30_000, write: 900 }, output: 400 },
    };
    const { fetch } = scriptedFetch({
      sessionCreated: () => undefined,
      prompts: [],
      interrupts: [],
      // Newest first, as the API lists them; the session usage is CUMULATIVE.
      messages: () => [second, first],
      usage: { tokens: { input: 31_500, cache: { read: 42_000 }, output: 600 }, cost: 0.05 },
    });
    const proc = fakeProcess();
    const { events, start } = collect();
    opencodeAdapter(spawnOf(proc), fetch, async () => 47000).spawn(start);
    await vi.advanceTimersByTimeAsync(0);
    proc.stdout('server password sekrit');
    await vi.advanceTimersByTimeAsync(2_500);

    const t = telemetryFromEvents(events);
    expect(t.turns).toBe(2);
    expect(t.usage).toEqual({ input: 1_500, cacheRead: 42_000, cacheCreation: 900, output: 600 });
    expect(t.lastTurnContext).toBe(800 + 30_000 + 900); // the last message, not the session's sum
    expect(t.tokensBeforeFirstWrite).toBe(12_700); // the write's own turn no longer counts
    expect(t.readCalls).toBe(1);
    expect(events.find((e) => e.text === 'read src/a.ts')?.tool).toBe('read');
    expect(events.find((e) => e.text === 'write src/b.ts')?.tool).toBe('write');

    // The 2 s poll re-reads the list: the once-guard must hold, or the sums inflate.
    await vi.advanceTimersByTimeAsync(4_000);
    expect(telemetryFromEvents(events).turns).toBe(2);

    proc.exit(null);
    vi.useRealTimers();
  });
});
