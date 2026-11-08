import { describe, expect, it, vi } from 'vitest';
import { providerErrorText } from './opencode-api';
import { opencodeAdapter } from './opencode';
import { assistant, scriptedFetch } from './opencode-server.fake';
import { collect, fakeProcess, spawnOf } from './worker-process.fake';

/**
 * The opencode adapter against a scripted `opencode serve` (no real
 * binary) — the poll and the turn end: the idle marker, a refused turn, an incomplete message.
 */

describe('the opencode adapter', () => {
  it('assistant text streams into the run log and the idle marker ends the turn', async () => {
    vi.useFakeTimers();
    const prompts: string[] = [];
    const interrupts: string[] = [];
    const at = Date.now();
    const { fetch } = scriptedFetch({
      sessionCreated: () => undefined,
      prompts,
      interrupts,
      // Newest first — the idle marker above the assistant message.
      messages: () => [
        { id: 'msg_i', type: 'idle', time: { created: at + 5_000 }, outcome: 'succeeded' },
        assistant(at),
        { id: 'msg_q', type: 'user', time: { created: at }, text: 'Do the ticket.' },
      ],
    });
    const proc = fakeProcess();
    const { events, start } = collect();
    opencodeAdapter(spawnOf(proc), fetch, async () => 47000).spawn(start);

    await vi.advanceTimersByTimeAsync(0); // let the boot attach its stdout listener
    proc.stdout('server password sekrit');
    await vi.advanceTimersByTimeAsync(2_500);

    const text = events.find((e) => e.kind === 'text');
    expect(text?.text).toBe('Done.');
    const result = events.find((e) => e.kind === 'result');
    expect(result?.text).toBe('Done.');
    expect(result?.tokensIn).toBe(14);
    expect(result?.tokensOut).toBe(5);
    expect(result?.costUsd).toBe(0.02);
    expect(proc.killTree).toHaveBeenCalled();

    proc.exit(null);
    vi.useRealTimers();
  });

  it('a turn the provider refuses (quota) ends with an error and no result — nothing to gate', async () => {
    vi.useFakeTimers();
    const at = Date.now();
    const error = { type: 'provider.quota', message: 'Usage limit reached for 5 hour.', status: 429 };
    const { fetch } = scriptedFetch({
      sessionCreated: () => undefined,
      prompts: [],
      interrupts: [],
      messages: () => [
        { id: 'msg_i', type: 'idle', time: { created: at + 5_000 }, outcome: 'failed', error },
        { id: 'msg_a', type: 'assistant', time: { created: at + 1, completed: at + 2 }, content: [], finish: 'error', error },
        { id: 'msg_q', type: 'user', time: { created: at }, text: 'Do the ticket.' },
      ],
    });
    const proc = fakeProcess();
    const { events, start } = collect();
    opencodeAdapter(spawnOf(proc), fetch, async () => 47000).spawn(start);
    await vi.advanceTimersByTimeAsync(0);
    proc.stdout('server password sekrit');
    await vi.advanceTimersByTimeAsync(2_500);

    expect(events.find((e) => e.kind === 'result')).toBeUndefined();
    expect(events.filter((e) => e.kind === 'error').map((e) => e.text)).toEqual([
      'provider.quota 429: Usage limit reached for 5 hour.',
    ]);
    expect(proc.killTree).toHaveBeenCalled();
    proc.exit(null);
    vi.useRealTimers();
  });

  it('a turn that ends without one model message fails like a refusal — never gated (req-80)', async () => {
    vi.useFakeTimers();
    const at = Date.now();
    const { fetch } = scriptedFetch({
      sessionCreated: () => undefined,
      prompts: [],
      interrupts: [],
      messages: () => [
        { id: 'msg_i', type: 'idle', time: { created: at + 5_000 }, outcome: 'succeeded' },
        { id: 'msg_q', type: 'user', time: { created: at }, text: 'Do the ticket.' },
      ],
    });
    const proc = fakeProcess();
    const { events, start } = collect();
    opencodeAdapter(spawnOf(proc), fetch, async () => 47000).spawn(start);
    await vi.advanceTimersByTimeAsync(0);
    proc.stdout('server password sekrit');
    await vi.advanceTimersByTimeAsync(2_500);

    expect(events.find((e) => e.kind === 'result')).toBeUndefined();
    expect(events.filter((e) => e.kind === 'error').map((e) => e.text)).toEqual([
      'the provider answered the prompt with nothing — no model message, no tokens',
    ]);
    expect(proc.killTree).toHaveBeenCalled();
    proc.exit(null);
    vi.useRealTimers();
  });

  it('names a refused turn by type, status and message', () => {
    expect(providerErrorText({ type: 'provider.auth', message: 'bad key' })).toBe('provider.auth: bad key');
    expect(providerErrorText(undefined)).toBe('provider error: the turn failed');
  });

  it('reads a message only once it is complete and shows a tool call only with its input', async () => {
    vi.useFakeTimers();
    const at = Date.now();
    let round = 0;
    const streaming = {
      id: 'msg_s',
      type: 'assistant',
      time: { created: at + 1 },
      content: [
        { type: 'reasoning', text: 'Let me look.' },
        { type: 'tool', id: 'call_1', name: 'read', state: { status: 'pending', input: {} } },
      ],
    };
    const finished = {
      ...streaming,
      time: { created: at + 1, completed: at + 3 },
      content: [
        { type: 'reasoning', text: 'Let me look.' },
        { type: 'text', text: 'Found it.' },
        { type: 'tool', id: 'call_1', name: 'read', state: { status: 'completed', input: { path: 'src/a.ts' } } },
      ],
    };
    const { fetch } = scriptedFetch({
      sessionCreated: () => undefined,
      prompts: [],
      interrupts: [],
      messages: () => (round++ < 2 ? [streaming] : [finished]),
    });
    const proc = fakeProcess();
    const { events, start } = collect();
    opencodeAdapter(spawnOf(proc), fetch, async () => 47000).spawn(start);
    await vi.advanceTimersByTimeAsync(0);
    proc.stdout('server password sekrit');
    await vi.advanceTimersByTimeAsync(2_100);
    expect(events.filter((e) => e.kind === 'note' && e.text === 'read')).toHaveLength(0);
    expect(events.find((e) => e.kind === 'text')).toBeUndefined();

    proc.exit(null);
    vi.useRealTimers();
  });
});
