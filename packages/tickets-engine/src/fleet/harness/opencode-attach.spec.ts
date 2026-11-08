import { describe, expect, it, vi } from 'vitest';
import type { SpawnFn } from '../ports/process-spawner';
import { opencodeAdapter } from './opencode';
import type { FetchFn } from './contract';
import { assistant, scriptedFetch } from './opencode-server.fake';
import { collect } from './worker-process.fake';

/**
 * The opencode adapter against a scripted `opencode serve` (no real
 * binary) — attaching to a running server.
 */

describe('the opencode adapter', () => {
  it('attach binds to a running server: nothing is spawned, streamed messages stay out, the idle marker ends the turn through the attach kill', async () => {
    vi.useFakeTimers();
    const at = Date.now();
    const earlier = {
      ...(assistant(at - 100_000) as object),
      id: 'msg_old',
      content: [{ type: 'text', text: 'earlier text' }],
    };
    const { fetch, calls } = scriptedFetch({
      sessionCreated: () => undefined,
      prompts: [],
      interrupts: [],
      messages: () => [
        { id: 'msg_i', type: 'idle', time: { created: at + 5_000 }, outcome: 'succeeded' },
        { ...(assistant(at) as object), id: 'msg_new' },
        earlier,
      ],
    });
    const kill = vi.fn(async () => undefined);
    const spawn = vi.fn();
    const { events, start } = collect();
    const handle = opencodeAdapter(spawn as unknown as SpawnFn, fetch, async () => 47000).attach!(start, {
      address: 'http://127.0.0.1:50001',
      password: 'pw',
      sessionRef: 'ses_oc',
      runStartedMs: at - 200_000,
      seenBeforeMs: at - 1_000,
      pid: 777,
      kill,
    });

    await vi.advanceTimersByTimeAsync(2_500);
    expect(spawn).not.toHaveBeenCalled();
    expect(calls[0]?.url.startsWith('http://127.0.0.1:50001')).toBe(true);
    expect((calls[0]?.init?.headers as Record<string, string>)['Authorization']).toBe(
      `Basic ${Buffer.from('opencode:pw').toString('base64')}`,
    );
    expect(events.filter((e) => e.kind === 'text').map((e) => e.text)).toEqual(['Done.']);
    expect(events.find((e) => e.kind === 'result')).toBeDefined();
    expect(kill).toHaveBeenCalled();
    expect(await handle.exited).toBeNull();
    expect(handle.pid).toBe(777);
    vi.useRealTimers();
  });

  it('an attached worker whose server stops answering ends after three failed polls; stop uses the attach kill', async () => {
    vi.useFakeTimers();
    const failing: FetchFn = async () => {
      throw new Error('ECONNREFUSED');
    };
    const attachInfo = (kill: () => Promise<void>) => ({
      address: 'http://127.0.0.1:50001',
      password: 'pw',
      sessionRef: 'ses_oc',
      runStartedMs: Date.now(),
      seenBeforeMs: 0,
      pid: 777,
      kill,
    });
    const { start } = collect();
    const adapter = opencodeAdapter(vi.fn() as unknown as SpawnFn, failing, async () => 47000);

    const gone = adapter.attach!(start, attachInfo(async () => undefined));
    await vi.advanceTimersByTimeAsync(7_000);
    await expect(gone.exited).resolves.toBeNull();

    const kill = vi.fn(async () => undefined);
    const stopping = adapter.attach!(start, attachInfo(kill));
    await stopping.stop();
    expect(kill).toHaveBeenCalledTimes(1);
    await expect(stopping.exited).resolves.toBeNull();
    vi.useRealTimers();
  });

  it('a given base is subtracted as it is — an attached run keeps its own earlier spend counted', async () => {
    vi.useFakeTimers();
    const usage = { tokens: { input: 2_000, cache: { read: 18_000 }, output: 400 }, cost: 0 };
    const { fetch } = scriptedFetch({ sessionCreated: () => undefined, prompts: [], interrupts: [], messages: () => [], usage });
    const bases: unknown[] = [];
    const { events, start } = collect({
      resumeRef: 'ses_oc',
      usageBase: { tokensIn: 10_000, tokensOut: 50, cacheReadTokens: 9_000, costUsd: 0 },
      onUsageBase: (base) => bases.push(base),
    });
    const handle = opencodeAdapter(vi.fn() as unknown as SpawnFn, fetch, async () => 47000).attach!(start, {
      address: 'http://127.0.0.1:50001',
      password: 'pw',
      sessionRef: 'ses_oc',
      runStartedMs: Date.now(),
      seenBeforeMs: Date.now(),
      pid: 777,
      kill: async () => undefined,
    });
    await vi.advanceTimersByTimeAsync(2_500);
    expect(bases).toEqual([]);
    const last = events.filter((e) => e.kind === 'usage' && e.tokensIn !== undefined).at(-1);
    expect(last?.tokensIn).toBe(10_000);
    expect(last?.cacheReadTokens).toBe(9_000);
    expect(last?.tokensOut).toBe(350);
    await handle.stop();
    vi.useRealTimers();
  });
});
