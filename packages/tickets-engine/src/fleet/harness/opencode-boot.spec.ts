import { describe, expect, it, vi } from 'vitest';
import { OPENCODE_API } from './opencode-api';
import { opencodeAdapter } from './opencode';
import type { FetchFn } from './contract';
import { scriptedFetch } from './opencode-server.fake';
import { collect, fakeProcess, spawnOf } from './worker-process.fake';

/**
 * The opencode adapter against a scripted `opencode serve` (no real
 * binary) — the boot, the session, its commands, the resume pre-flight and compact-first.
 */

describe('the opencode adapter', () => {
  it('boots serve from the stdout password, creates the session, prompts it and reports usage', async () => {
    vi.useFakeTimers();
    const prompts: string[] = [];
    const interrupts: string[] = [];
    let sessionBody: unknown;
    const { fetch } = scriptedFetch({
      sessionCreated: (body) => {
        sessionBody = body;
      },
      prompts,
      interrupts,
      messages: () => [],
    });
    const proc = fakeProcess();
    const { events, sessions, start } = collect();
    const handle = opencodeAdapter(spawnOf(proc), fetch, async () => 47000).spawn(start);

    // Without the stdout credential line nothing is contacted yet.
    await vi.advanceTimersByTimeAsync(2_000);
    expect(sessionBody).toBeUndefined();

    proc.stdout('server listening on http://127.0.0.1:47000');
    proc.stdout('server password sekrit');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sessionBody).toEqual({ title: 'fleet T-0001' });
    expect(sessions).toEqual(['ses_oc']);
    expect(prompts[0]).toContain('Do the ticket.');

    // The usage poll lands within the interval (input + cache read).
    await vi.advanceTimersByTimeAsync(2_500);
    const usage = events.find((e) => e.kind === 'usage' && e.tokensIn !== undefined);
    expect(usage?.tokensIn).toBe(14);
    expect(usage?.cacheReadTokens).toBe(4);
    expect(usage?.tokensOut).toBe(5);
    expect(usage?.costUsd).toBe(0.02);

    const rung = await handle.steer('one more pass');
    expect(rung).toBe('inject');
    expect(prompts.at(-1)).toContain('one more pass');

    await handle.stop();
    expect(interrupts.length).toBe(1);
    expect(proc.killTree).toHaveBeenCalled();

    proc.exit(null);
    vi.useRealTimers();
  });

  it('holdAtSpawn boots, creates the session and starts the poll — but posts no prompt (req-75)', async () => {
    vi.useFakeTimers();
    const prompts: string[] = [];
    const interrupts: string[] = [];
    const { fetch } = scriptedFetch({ sessionCreated: () => undefined, prompts, interrupts, messages: () => [] });
    const proc = fakeProcess();
    const { events, sessions, start } = collect({ holdAtSpawn: true });
    const handle = opencodeAdapter(spawnOf(proc), fetch, async () => 47000).spawn(start);

    await vi.advanceTimersByTimeAsync(100);
    proc.stdout('server password sekrit');
    await vi.advanceTimersByTimeAsync(1_000);
    // The worker is up, its session exists and is reported — the quiet
    // start delivers nothing: the worker stands until steered.
    expect(sessions).toEqual(['ses_oc']);
    expect(prompts).toEqual([]);

    // The poll runs as usual (usage lands), and the owner's first steer
    // is the session's first prompt.
    await vi.advanceTimersByTimeAsync(2_500);
    expect(events.find((e) => e.kind === 'usage' && e.tokensIn !== undefined)?.tokensIn).toBe(14);
    await handle.steer('The owner starts the dialog');
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('The owner starts the dialog');

    proc.exit(null);
    vi.useRealTimers();
  });

  it('lists its slash commands and runs a known one as a command, not as text', async () => {
    vi.useFakeTimers();
    const prompts: string[] = [];
    const posted: Array<{ url: string; body: string }> = [];
    const { fetch: base } = scriptedFetch({ sessionCreated: () => undefined, prompts, interrupts: [], messages: () => [] });
    const json = (body: unknown): Response => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
    const fetch: FetchFn = async (url, init) => {
      if (url.endsWith(OPENCODE_API.commands)) {
        return json({ data: [{ name: 'deploy' }] });
      }
      if (url.endsWith(OPENCODE_API.compact('ses_oc')) || url.endsWith(OPENCODE_API.command('ses_oc'))) {
        posted.push({ url, body: String(init?.body) });
        return json({ data: {} });
      }
      return base(url, init);
    };
    const proc = fakeProcess();
    const { events, start } = collect();
    const handle = opencodeAdapter(spawnOf(proc), fetch, async () => 47000).spawn(start);
    await vi.advanceTimersByTimeAsync(100);
    proc.stdout('server password sekrit');
    await vi.advanceTimersByTimeAsync(3_000);
    expect(events.find((e) => e.commands !== undefined)?.commands).toEqual(['compact', 'deploy']);

    await handle.steer('/compact');
    await handle.steer('/deploy staging now');
    await handle.steer('/nosuch thing');
    expect(posted.map((p) => p.url.split('/').at(-1))).toEqual(['compact', 'command']);
    expect(JSON.parse(posted[1]!.body)).toEqual({ name: 'deploy', text: 'staging now' });
    expect(prompts.at(-1)).toContain('/nosuch thing');

    proc.exit(null);
    vi.useRealTimers();
  });

  it('a resume pre-flights the session — a missing one is reported, never prompted (T-0049)', async () => {
    vi.useFakeTimers();
    const prompts: string[] = [];
    const { fetch: base } = scriptedFetch({ sessionCreated: () => undefined, prompts, interrupts: [], messages: () => [] });
    const fetch: FetchFn = async (url, init) => {
      if (url.endsWith(OPENCODE_API.session('ses_oc'))) {
        return { ok: false, status: 404 } as unknown as Response;
      }
      return base(url, init);
    };
    const failures: string[] = [];
    const proc = fakeProcess();
    const { events, start } = collect({ resumeRef: 'ses_oc', onResumeFailed: (reason) => failures.push(reason) });
    const handle = opencodeAdapter(spawnOf(proc), fetch, async () => 47000).spawn(start);
    await vi.advanceTimersByTimeAsync(0);
    proc.stdout('server password sekrit');
    await vi.advanceTimersByTimeAsync(1_500);

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('404');
    expect(prompts).toHaveLength(0);
    expect(events.some((e) => e.kind === 'error' && (e.text ?? '').includes('pre-flight'))).toBe(true);
    expect(proc.killTree).toHaveBeenCalled();
    await expect(handle.exited).resolves.toBe(-1);
    vi.useRealTimers();
  });

  it('compact-first settles the compact (its idle marker) before the instruction prompts (T-0049)', async () => {
    vi.useFakeTimers();
    const at = Date.now();
    const prompts: string[] = [];
    const promptWhenSettled: boolean[] = [];
    let compacts = 0;
    let rounds = 0;
    let settled = false;
    // While the compaction runs: only the `compaction` message, no idle
    // marker. From the third wait round on: the turn ended.
    const messages = (): unknown[] => {
      rounds += 1;
      if (rounds <= 2) {
        return [{ id: 'msg_c', type: 'compaction', time: { created: at + 1 } }];
      }
      settled = true;
      return [
        { id: 'msg_i2', type: 'idle', time: { created: at + 5_000 } },
        { id: 'msg_c', type: 'compaction', time: { created: at + 1 } },
      ];
    };
    const { fetch: base } = scriptedFetch({ sessionCreated: () => undefined, prompts: [], interrupts: [], messages });
    const json = (body: unknown): Response => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
    const fetch: FetchFn = async (url, init) => {
      if (url.endsWith(OPENCODE_API.compact('ses_oc'))) {
        compacts += 1;
        return json({ data: {} });
      }
      if (url.endsWith(OPENCODE_API.prompt('ses_oc'))) {
        promptWhenSettled.push(settled);
        prompts.push(String(init?.body));
        return json({ data: { id: 'msg_q', type: 'user', delivery: 'steer' } });
      }
      return base(url, init);
    };
    const proc = fakeProcess();
    const { events, start } = collect({ resumeRef: 'ses_oc', compactFirst: true });
    const handle = opencodeAdapter(spawnOf(proc), fetch, async () => 47000).spawn(start);
    await vi.advanceTimersByTimeAsync(0);
    proc.stdout('server password sekrit');
    await vi.advanceTimersByTimeAsync(6_000);

    expect(compacts).toBe(1);
    // The instruction rode only once the compact had settled — and never
    // before (the idle-marker race the T-0049 pitfall pins).
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('Do the ticket.');
    expect(promptWhenSettled).toEqual([true]);
    expect(events.some((e) => (e.text ?? '').includes('natively compacted'))).toBe(true);
    // The compact's own idle marker sits BEFORE lastPromptAt: the turn end
    // the poll saw belongs to the prompt, and the worker was killed then.
    expect(events.find((e) => e.kind === 'result')).toBeDefined();
    expect(proc.killTree).toHaveBeenCalled();
    proc.exit(null);
    vi.useRealTimers();
  });
});
