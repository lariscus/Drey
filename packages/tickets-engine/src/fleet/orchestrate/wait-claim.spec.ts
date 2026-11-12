import { describe, expect, it } from 'vitest';
import { TicketStoreError } from '../../ports/ticket-store';
import type { RunRequest } from '../protocol';
import { FakeTicketStore } from '../store/ticket-store.fake';
import { settled, waitFor } from './run-spec-support';
import { buildRequest, DK_TARGET, harness, startRun, useTempDirs, type Harness } from './supervisor-harness.fake';

/** Q-03 (accepted 2026-11-05): a run that waits for the owner gives its claim up and re-claims on the answer. */
describe('WaitClaim — the claim through a wait for the owner', () => {
  const dirs = useTempDirs();
  const request = (over: Partial<RunRequest> = {}): RunRequest => buildRequest(dirs.vault, { nextPhase: null, nextPhaseDir: null, ...over });
  const setup = (): Harness => harness(dirs.fleet, {}, new FakeTicketStore());
  const question = (text: string, label: string) =>
    ({ kind: 'question', text, requestId: 'q1', questions: [{ question: text, header: 'Key', options: [{ label, description: '' }] }] }) as never;

  it('Q-03: a worker that waits for the owner gives the claim up and re-claims on the answer', async () => {
    const t = setup();
    const id = await startRun(t.sup, request());
    t.adapter.starts[0]!.onEvent({ ts: '2026-10-17T12:00:01Z', kind: 'note', waiting: question('Which shortcut?', 'Ctrl+K') });
    await waitFor(() => expect(t.store.of('release')).toHaveLength(1));
    const wait = t.store.of('comment')[0]?.text ?? '';
    expect(wait).toMatch(/^needs-decision: \[run-[a-z0-9-]+-waits\] /);
    expect(t.timers.armed).toBeNull(); // no keep-alive while nobody holds the claim
    expect(t.store.of('claim')).toHaveLength(1);

    const answer = await t.sup.answerQuestion(id, { 'Which shortcut?': ['Ctrl+K'] } as never);
    expect(answer.ok).toBe(true);
    expect(t.store.of('claim')).toHaveLength(2); // re-claimed BEFORE the worker went on
    expect(t.store.of('comment').map((c) => (c.text ?? '').split('\n')[0])).toContainEqual(expect.stringMatching(/^resolved: run-/));
    expect(t.timers.armed).not.toBeNull(); // the keep-alive runs again
    expect(t.adapter.handles[0]!.answerQuestion).toHaveBeenCalled();
    t.adapter.handles[0]!.fail(1);
    await settled(t.sup, id, 'failed');
  });

  it('req-257: a question in a chain run puts the card at You (x-awaiting) and the answer brings it back', async () => {
    const t = setup();
    const id = await startRun(t.sup, request({ cursor: { at: 3, length: 4, entries: ['paul:shape', 'paul', 'ben', 'you'] } }));
    t.adapter.starts[0]!.onEvent({ ts: '2026-10-17T12:00:01Z', kind: 'note', waiting: question('Which shortcut?', 'Ctrl+K') });
    await waitFor(() => expect(t.store.of('release')).toHaveLength(1));
    expect(t.store.text).toMatch(/^x-awaiting: you$/m);

    expect((await t.sup.answerQuestion(id, { 'Which shortcut?': ['Ctrl+K'] } as never)).ok).toBe(true);
    expect(t.store.text).not.toMatch(/^x-awaiting:/m);
    t.adapter.handles[0]!.fail(1);
    await settled(t.sup, id, 'failed');
  });

  it('Q-03: an answer for a ticket someone else took meanwhile is refused and the worker gets nothing', async () => {
    const t = setup();
    const id = await startRun(t.sup, request());
    t.adapter.starts[0]!.onEvent({ ts: '2026-10-17T12:00:01Z', kind: 'note', waiting: question('Which?', 'a') });
    await waitFor(() => expect(t.store.of('release')).toHaveLength(1));
    t.store.failNext('claim', new TicketStoreError('claimed', 'ticket t-1 is claimed by henrik', 11));
    const answer = await t.sup.answerQuestion(id, { 'Which?': ['a'] } as never);
    expect(answer.ok).toBe(false);
    expect(t.adapter.handles[0]!.answerQuestion).not.toHaveBeenCalled();
    t.adapter.handles[0]!.fail(1);
    await settled(t.sup, id, 'failed');
  });

  it('Q-03: with commit trailers on, the claim is kept through the wait (the epoch the trailers carry must stand)', async () => {
    const t = setup();
    const id = await startRun(t.sup, request({ dk: { ...DK_TARGET, trailers: true } }));
    t.adapter.starts[0]!.onEvent({ ts: '2026-10-17T12:00:01Z', kind: 'note', waiting: { kind: 'permission', text: 'edit x', requestId: 'p1' } });
    await waitFor(() => expect(t.sup.get(id)?.waiting?.kind).toBe('permission'));
    await t.sup.idle();
    expect(t.store.of('release')).toHaveLength(0);
    t.adapter.handles[0]!.fail(1);
    await settled(t.sup, id, 'failed');
  });
});
