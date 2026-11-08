import { describe, expect, it, vi } from 'vitest';
import { opencodeAdapter } from './opencode';
import { scriptedFetch } from './opencode-server.fake';
import { collect, fakeProcess, spawnOf } from './worker-process.fake';

/**
 * The opencode adapter against a scripted `opencode serve` (no real
 * binary) — what a worker waits on: a QUESTION: turn, a permission request, a question form.
 */

describe('the opencode adapter', () => {
  it('a turn that ends with QUESTION: waits instead of ending; the answer lets the next turn end the run (req-64)', async () => {
    vi.useFakeTimers();
    const prompts: string[] = [];
    const at = Date.now();
    let messages: unknown[] = [
      { id: 'msg_i', type: 'idle', time: { created: at + 5_000 }, outcome: 'succeeded' },
      {
        id: 'msg_a',
        type: 'assistant',
        time: { created: at + 1, completed: at + 2 },
        content: [{ type: 'text', text: 'QUESTION: Which API — v1 or v2?' }],
      },
    ];
    const { fetch } = scriptedFetch({ sessionCreated: () => undefined, prompts, interrupts: [], messages: () => messages });
    const proc = fakeProcess();
    const { events, start } = collect();
    const handle = opencodeAdapter(spawnOf(proc), fetch, async () => 47000).spawn(start);
    await vi.advanceTimersByTimeAsync(0);
    proc.stdout('server password sekrit');
    await vi.advanceTimersByTimeAsync(12_500);

    const waits = events.filter((e) => e.waiting !== undefined);
    expect(waits).toEqual([expect.objectContaining({ waiting: { kind: 'question', text: 'Which API — v1 or v2?' } })]);
    expect(events.find((e) => e.kind === 'result')).toBeUndefined();
    expect(proc.killTree).not.toHaveBeenCalled();

    await handle.steer('v2');
    expect(events.at(-1)).toMatchObject({ kind: 'usage', waiting: null });
    expect(prompts.at(-1)).toContain('v2');
    messages = [
      { id: 'msg_i2', type: 'idle', time: { created: Date.now() + 5_000 }, outcome: 'succeeded' },
      {
        id: 'msg_b',
        type: 'assistant',
        time: { created: Date.now() + 1, completed: Date.now() + 2 },
        content: [{ type: 'text', text: 'Done with v2.' }],
      },
      ...messages,
    ];
    await vi.advanceTimersByTimeAsync(2_500);
    expect(events.find((e) => e.kind === 'result')?.text).toBe('Done with v2.');
    expect(proc.killTree).toHaveBeenCalled();
    proc.exit(null);
    vi.useRealTimers();
  });

  it('a QUESTION: turn in the fixed shape carries it parsed (req-75 W2)', async () => {
    vi.useFakeTimers();
    const shaped = [
      'QUESTION: Should dragging a heading also move the text below it?',
      'Ticket: Outline — drag headings to reorder the note.',
      'Where: step 2 of 4, the drop handler; step 1 is green.',
      'Why: the plan says "reorder headings" but not whether the section body moves.',
      'Options:',
      '1. Move the whole section — one undo step, what other editors do',
      '2. Only the heading line — the text stays, structure usually breaks',
      'Recommendation: 1 — it keeps the note\'s structure intact.',
    ].join('\n');
    const at = Date.now();
    const messages: unknown[] = [
      { id: 'msg_i', type: 'idle', time: { created: at + 5_000 }, outcome: 'succeeded' },
      { id: 'msg_a', type: 'assistant', time: { created: at + 1, completed: at + 2 }, content: [{ type: 'text', text: shaped }] },
    ];
    const { fetch } = scriptedFetch({ sessionCreated: () => undefined, prompts: [], interrupts: [], messages: () => messages });
    const proc = fakeProcess();
    const { events, start } = collect();
    opencodeAdapter(spawnOf(proc), fetch, async () => 47000).spawn(start);
    await vi.advanceTimersByTimeAsync(0);
    proc.stdout('server password sekrit');
    await vi.advanceTimersByTimeAsync(12_500);

    const waiting = events.find((e) => e.waiting !== undefined)?.waiting;
    expect(waiting).toMatchObject({
      kind: 'question',
      shaped: {
        question: 'Should dragging a heading also move the text below it?',
        recommended: 1,
        options: [
          { n: 1, label: 'Move the whole section' },
          { n: 2, label: 'Only the heading line' },
        ],
      },
    });
    proc.exit(null);
    vi.useRealTimers();
  });

  it('a pending permission request becomes the wait; the answer posts the decision and clears it (req-64)', async () => {
    vi.useFakeTimers();
    let pending: unknown[] = [{ id: 'per_1', sessionID: 'ses_oc', action: 'bash', resources: ['rm -rf dist'] }];
    const replies: Array<[string, unknown]> = [];
    const { fetch } = scriptedFetch({
      sessionCreated: () => undefined,
      prompts: [],
      interrupts: [],
      messages: () => [],
      permissions: () => pending,
      replies,
    });
    const proc = fakeProcess();
    const { events, start } = collect();
    const handle = opencodeAdapter(spawnOf(proc), fetch, async () => 47000).spawn(start);
    await vi.advanceTimersByTimeAsync(0);
    proc.stdout('server password sekrit');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(events.filter((e) => e.waiting !== undefined)).toEqual([
      expect.objectContaining({ waiting: { kind: 'permission', text: 'bash rm -rf dist', requestId: 'per_1' } }),
    ]);

    expect(await handle.answerPermission?.('per_1', 'once')).toBe(true);
    expect(replies).toEqual([['per_1', { decision: 'once' }]]);
    expect(events.at(-1)).toMatchObject({ waiting: null });
    pending = [];
    await vi.advanceTimersByTimeAsync(5_000);
    expect(events.filter((e) => e.waiting !== undefined)).toHaveLength(2);
    await handle.stop();
    proc.exit(null);
    vi.useRealTimers();
  });

  it('a pending question form becomes the wait with its choices; the answer replies to the form and clears it', async () => {
    vi.useFakeTimers();
    let pending: unknown[] = [
      {
        id: 'frm_1',
        sessionID: 'ses_oc',
        title: 'Questions',
        metadata: { kind: 'question' },
        fields: [
          {
            key: 'q0',
            title: 'Merge',
            description: 'How should I merge?',
            type: 'string',
            options: [
              { value: 'Rebase', label: 'Rebase', description: 'linear history' },
              { value: 'Merge', label: 'Merge' },
            ],
            custom: true,
          },
        ],
      },
    ];
    const formReplies: Array<[string, unknown]> = [];
    const { fetch } = scriptedFetch({
      sessionCreated: () => undefined,
      prompts: [],
      interrupts: [],
      messages: () => [],
      forms: () => pending,
      formReplies,
    });
    const proc = fakeProcess();
    const { events, start } = collect();
    const handle = opencodeAdapter(spawnOf(proc), fetch, async () => 47000).spawn(start);
    await vi.advanceTimersByTimeAsync(0);
    proc.stdout('server password sekrit');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(events.filter((e) => e.waiting !== undefined)).toEqual([
      expect.objectContaining({
        waiting: {
          kind: 'question',
          text: 'How should I merge?',
          requestId: 'frm_1',
          questions: [
            {
              key: 'q0',
              header: 'Merge',
              question: 'How should I merge?',
              options: [{ label: 'Rebase', description: 'linear history' }, { label: 'Merge' }],
              multiple: false,
            },
          ],
        },
      }),
    ]);

    expect(await handle.answerQuestion?.('frm_1', { q0: 'Rebase' })).toBe(true);
    expect(formReplies).toEqual([['frm_1', { answer: { q0: 'Rebase' } }]]);
    expect(events.at(-1)).toMatchObject({ waiting: null });
    pending = [];
    await vi.advanceTimersByTimeAsync(5_000);
    expect(events.filter((e) => e.waiting !== undefined)).toHaveLength(2);
    await handle.stop();
    proc.exit(null);
    vi.useRealTimers();
  });
});
