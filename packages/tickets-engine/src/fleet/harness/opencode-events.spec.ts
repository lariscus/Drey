import { describe, expect, it, vi } from 'vitest';
import { OPENCODE_API } from './opencode-api';
import { opencodeAdapter } from './opencode';
import { assistant, ev, scriptedFetch, sseChannel } from './opencode-server.fake';
import { collect, fakeProcess, spawnOf } from './worker-process.fake';

/**
 * The opencode adapter against a scripted `opencode serve` (no real
 * binary) — the live event subscription (SSE) and its fallback to the poll.
 */

describe('the opencode adapter', () => {
  it('streams tool calls and text parts live from the event subscription (T-0051)', async () => {
    vi.useFakeTimers();
    const channel = sseChannel();
    const at = Date.now();
    let round = 0;
    // After the events below, the list shows the finished message + idle marker.
    const finished = {
      id: 'msg_s',
      type: 'assistant',
      time: { created: at + 1, completed: at + 9 },
      content: [
        { type: 'text', text: 'Found it.' },
        { type: 'tool', id: 'call_1', name: 'read', state: { status: 'completed', input: { path: 'src/a.ts' } } },
      ],
    };
    const { fetch, calls } = scriptedFetch({
      sessionCreated: () => undefined,
      prompts: [],
      interrupts: [],
      messages: () => (round++ < 3 ? [] : [{ id: 'msg_i', type: 'idle', time: { created: at + 10_000 } }, finished]),
      eventStream: () => channel.response,
    });
    const proc = fakeProcess();
    const { events, start } = collect();
    opencodeAdapter(spawnOf(proc), fetch, async () => 47000).spawn(start);
    await vi.advanceTimersByTimeAsync(0);
    proc.stdout('server password sekrit');
    await vi.advanceTimersByTimeAsync(2_500);
    expect(calls.some((c) => c.url.endsWith(OPENCODE_API.event))).toBe(true);

    channel.push(ev('session.tool.input.started', { assistantMessageID: 'msg_s', id: 'call_1', name: 'read' }));
    channel.push(ev('session.tool.called', { assistantMessageID: 'msg_s', id: 'call_1', input: { path: 'src/a.ts' } }));
    channel.push(
      ev('session.tool.success', { assistantMessageID: 'msg_s', id: 'call_1', content: [{ type: 'text', text: '42 lines' }] }),
    );
    channel.push(ev('session.text.delta', { assistantMessageID: 'msg_s', ordinal: 0, delta: 'Found ' }));
    channel.push(ev('session.text.delta', { assistantMessageID: 'msg_s', ordinal: 0, delta: '(mid-part, throttled)' }));
    channel.push(ev('session.text.ended', { assistantMessageID: 'msg_s', ordinal: 0, text: 'Found it.' }));
    await vi.advanceTimersByTimeAsync(0);

    const tools = events.filter((e) => e.kind === 'tool');
    expect(tools.map((e) => [e.tool, e.detail])).toEqual([
      ['read', 'running'],
      ['read', undefined],
      ['read', 'done'],
    ]);
    expect(tools[1]?.text).toBe('read src/a.ts');
    expect(tools[1]?.activity).toBe('read src/a.ts');
    expect(tools[2]?.text).toBe('result › 42 lines');
    const deltas = events.filter((e) => e.kind === 'text-delta');
    // The mid-part delta fell to the throttle; the seal carries the whole part.
    expect(deltas.map((e) => e.text)).toEqual(['Found ', 'Found it.']);
    expect(deltas[1]?.detail).toBe('end');
    expect(deltas[1]?.activity).toBe('Found it.');

    // The list poll completes the message: no duplicate text event (the
    // subscription sealed the same text), no duplicate tool note, and the
    // turn still ends through the idle marker.
    await vi.advanceTimersByTimeAsync(6_000);
    expect(events.filter((e) => e.kind === 'text')).toEqual([]);
    expect(events.filter((e) => e.kind === 'note' && e.text === 'read src/a.ts')).toEqual([]);
    const result = events.find((e) => e.kind === 'result');
    expect(result?.text).toBe('Found it.');
    expect(proc.killTree).toHaveBeenCalled();

    proc.exit(null);
    vi.useRealTimers();
  });

  it('an event of another session is ignored; usage events report context and this run\'s own totals', async () => {
    vi.useFakeTimers();
    const channel = sseChannel();
    const { fetch } = scriptedFetch({
      sessionCreated: () => undefined,
      prompts: [],
      interrupts: [],
      messages: () => [],
      eventStream: () => channel.response,
    });
    const proc = fakeProcess();
    const { events, start } = collect();
    opencodeAdapter(spawnOf(proc), fetch, async () => 47000).spawn(start);
    await vi.advanceTimersByTimeAsync(0);
    proc.stdout('server password sekrit');
    await vi.advanceTimersByTimeAsync(2_500);

    channel.push({ type: 'session.text.delta', data: { sessionID: 'ses_other', delta: 'not this run' } });
    channel.push(ev('session.step.started', {}));
    channel.push(ev('session.step.ended', { tokens: { input: 100, cache: { read: 20 }, output: 3 }, cost: 0.01 }));
    channel.push(ev('session.usage.updated', { cost: 0.02, tokens: { input: 10, cache: { read: 4 }, output: 5 } }));
    await vi.advanceTimersByTimeAsync(0);

    expect(events.filter((e) => e.kind === 'text-delta')).toEqual([]);
    expect(events.find((e) => e.kind === 'usage' && e.turn !== undefined)?.turn).toBe('busy');
    expect(events.find((e) => e.kind === 'usage' && e.contextTokens !== undefined)?.contextTokens).toBe(120);
    const usage = events.find((e) => e.kind === 'usage' && e.tokensIn !== undefined);
    expect(usage?.tokensIn).toBe(14);
    expect(usage?.cacheReadTokens).toBe(4);
    expect(usage?.costUsd).toBe(0.02);

    proc.exit(null);
    vi.useRealTimers();
  });

  it('a dropped event stream falls back to the poll and reconnects', async () => {
    vi.useFakeTimers();
    const at = Date.now();
    const first = sseChannel();
    const second = sseChannel();
    let eventRounds = 0;
    const { fetch, calls } = scriptedFetch({
      sessionCreated: () => undefined,
      prompts: [],
      interrupts: [],
      // The poll still delivers the finished message — no SSE seal exists.
      messages: () => [
        { id: 'msg_i', type: 'idle', time: { created: at + 5_000 } },
        assistant(at),
      ],
      eventStream: () => {
        eventRounds += 1;
        return eventRounds === 1 ? first.response : second.response;
      },
    });
    const proc = fakeProcess();
    const { events, start } = collect();
    opencodeAdapter(spawnOf(proc), fetch, async () => 47000).spawn(start);
    await vi.advanceTimersByTimeAsync(0);
    proc.stdout('server password sekrit');
    await vi.advanceTimersByTimeAsync(2_500);
    expect(calls.filter((c) => c.url.endsWith(OPENCODE_API.event))).toHaveLength(1);

    first.end(); // the server drops the stream
    await vi.advanceTimersByTimeAsync(2_500); // past EVENT_RETRY_MS
    expect(calls.filter((c) => c.url.endsWith(OPENCODE_API.event))).toHaveLength(2);

    // Polling covered the gap: the completed message's text arrived anyway.
    expect(events.find((e) => e.kind === 'text')?.text).toBe('Done.');

    proc.exit(null);
    vi.useRealTimers();
  });
});
