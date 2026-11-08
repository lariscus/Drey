import { describe, expect, it, vi } from 'vitest';
import { INTERRUPT_WAIT_MS } from './opencode-api';
import { opencodeAdapter } from './opencode';
import type { FetchFn } from './contract';
import { assistant, scriptedFetch } from './opencode-server.fake';
import { collect, fakeProcess, spawnOf } from './worker-process.fake';

/**
 * The opencode adapter against a scripted `opencode serve` (no real
 * binary) — hold, interrupt and stop.
 */

describe('the opencode adapter', () => {
  it('a held run ignores the idle marker until it is released, and interrupt posts to the server', async () => {
    vi.useFakeTimers();
    const interrupts: string[] = [];
    const at = Date.now();
    const { fetch } = scriptedFetch({
      sessionCreated: () => undefined,
      prompts: [],
      interrupts,
      messages: () => [
        { id: 'msg_i', type: 'idle', time: { created: at + 5_000 }, outcome: 'interrupted' },
        assistant(at),
        { id: 'msg_q', type: 'user', time: { created: at }, text: 'Do the ticket.' },
      ],
    });
    const proc = fakeProcess();
    const { events, start } = collect();
    const handle = opencodeAdapter(spawnOf(proc), fetch, async () => 47000).spawn(start);
    handle.setHold?.(true);

    await vi.advanceTimersByTimeAsync(0);
    proc.stdout('server password sekrit');
    await vi.advanceTimersByTimeAsync(2_500);
    expect(events.find((e) => e.kind === 'result')).toBeUndefined();
    expect(proc.killTree).not.toHaveBeenCalled();

    expect(await handle.interrupt?.()).toBe(true);
    expect(interrupts.length).toBe(1);

    handle.setHold?.(false);
    await vi.advanceTimersByTimeAsync(2_500);
    expect(events.find((e) => e.kind === 'result')).toBeDefined();
    expect(proc.killTree).toHaveBeenCalled();

    proc.exit(null);
    vi.useRealTimers();
  });

  it('stop interrupts the session and kills the serve process', async () => {
    vi.useFakeTimers();
    const prompts: string[] = [];
    const interrupts: string[] = [];
    const { fetch } = scriptedFetch({
      sessionCreated: () => undefined,
      prompts,
      interrupts,
      messages: () => [],
    });
    const proc = fakeProcess();
    const { start } = collect();
    const handle = opencodeAdapter(spawnOf(proc), fetch, async () => 47000).spawn(start);
    await vi.advanceTimersByTimeAsync(0); // let the boot attach its stdout listener
    proc.stdout('server password sekrit');
    await vi.advanceTimersByTimeAsync(1_000);

    await handle.stop();
    expect(interrupts.length).toBe(1);
    expect(proc.killTree).toHaveBeenCalled();

    proc.exit(null);
    vi.useRealTimers();
  });

  it('stop still kills the serve process when the interrupt never answers', async () => {
    vi.useFakeTimers();
    const { fetch } = scriptedFetch({
      sessionCreated: () => undefined,
      prompts: [],
      interrupts: [],
      messages: () => [],
    });
    const hanging: FetchFn = (url, init) =>
      url.includes('/interrupt') ? new Promise<Response>(() => undefined) : fetch(url, init);
    const proc = fakeProcess();
    const { start } = collect();
    const handle = opencodeAdapter(spawnOf(proc), hanging, async () => 47000).spawn(start);
    await vi.advanceTimersByTimeAsync(0);
    proc.stdout('server password sekrit');
    await vi.advanceTimersByTimeAsync(1_000);

    const stopped = handle.stop();
    expect(proc.killTree).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(INTERRUPT_WAIT_MS);
    await stopped;
    expect(proc.killTree).toHaveBeenCalled();

    proc.exit(null);
    vi.useRealTimers();
  });
});
