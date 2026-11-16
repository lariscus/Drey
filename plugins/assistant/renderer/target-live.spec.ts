// @vitest-environment jsdom
/**
 * A streaming conversation target (SDK 1.63, D-76): the controller draws
 * the answer the target is writing after the owner's pending words, and the
 * folded Thinking block of the thread fills while the send is on its way —
 * it used to show only the finished turn.
 */
import { describe, expect, it } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- the spec stands in for the host, which owns the catalog at runtime
import { i18n } from '../../../shared/i18n';
import type { ConversationMessage, ConversationTarget, ConversationThread, DreyPluginApi } from '../../../shared/plugin-api/renderer';
import { createTargetThread } from './target-view';
import { createTargetController } from './targets';

const EMPTY: ConversationThread = { id: 'chat', title: 'Chat', messages: [] };
const FINISHED: ConversationThread = {
  id: 'chat',
  title: 'Chat',
  messages: [
    { id: 'm-0', role: 'user', text: 'Queue both' },
    { id: 'm-1', role: 'agent', text: 'Both are queued.', thought: 'Ben is free.' },
  ],
};

/** A target whose `send` hangs until `finish`, with a live answer the spec writes. */
function streamingTarget() {
  const liveListeners = new Set<() => void>();
  let live: ConversationMessage | null = null;
  let finish: (thread: ConversationThread) => void = () => undefined;
  const target: ConversationTarget = {
    id: 't.mc',
    label: 'Mission Control',
    thread: () => Promise.resolve(EMPTY),
    send: () => new Promise<ConversationThread>((resolve) => (finish = resolve)),
    act: () => Promise.resolve(EMPTY),
    newThread: () => Promise.resolve(EMPTY),
    live: () => live,
    onLiveChange: (listener) => {
      liveListeners.add(listener);
      return () => liveListeners.delete(listener);
    },
  };
  const write = (message: ConversationMessage | null): void => {
    live = message;
    liveListeners.forEach((listener) => listener());
  };
  return { target, write, finish: (thread: ConversationThread) => finish(thread), liveListeners };
}

function mount(target: ConversationTarget) {
  const targetListeners = new Set<() => void>();
  const api = {
    i18n,
    backend: { invoke: () => Promise.resolve({}) },
    links: { parseInline: (text: string) => [{ kind: 'text', text }], open: () => Promise.resolve() },
    conversations: {
      targets: () => [target],
      onTargetsChange: (listener: () => void) => {
        targetListeners.add(listener);
        return () => targetListeners.delete(listener);
      },
      viewTarget: () => null,
      onViewTargetChange: () => () => undefined,
    },
  } as unknown as DreyPluginApi;
  const controller = createTargetController(api);
  const view = createTargetThread(api, controller);
  controller.subscribe(() => view.render());
  controller.select('t.mc');
  return { controller, view };
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const thoughtOf = (view: { node: HTMLElement }): string | undefined => view.node.querySelector('.target-thought p')?.textContent ?? undefined;

describe('a streaming conversation target (D-76)', () => {
  it('fills the thought block and the answer before the turn resolves, and ends with the finished turn', async () => {
    const { target, write, finish } = streamingTarget();
    const { controller, view } = mount(target);
    await settle();
    const sending = controller.send('Queue both');
    expect(view.node.querySelector('.target-thought')).toBeNull();

    write({ id: 'live', role: 'agent', text: '', thought: 'ticket_read T-1 …' });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(thoughtOf(view)).toBe('ticket_read T-1 …');
    expect(view.node.querySelector('.target-thought summary')?.textContent).toBe('Thinking');

    write({ id: 'live', role: 'agent', text: 'On it.', thought: 'ticket_read T-1 …\nBen is free' });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(thoughtOf(view)).toBe('ticket_read T-1 …\nBen is free');
    const cards = [...view.node.querySelectorAll('.target-message')].map((card) => card.textContent ?? '');
    expect(cards[0]).toContain('Queue both');
    expect(cards.at(-1)).toContain('On it.');
    expect(controller.busy()).toBe(true);

    write(null);
    finish(FINISHED);
    await sending;
    expect(controller.busy()).toBe(false);
    // The live message is gone; the finished turn stands once.
    expect(view.node.querySelectorAll('.target-message')).toHaveLength(2);
    expect(thoughtOf(view)).toBe('Ben is free.');
  });

  it('keeps the Thinking block open across the repaints the owner opened it in', async () => {
    const { target, write, finish } = streamingTarget();
    const { controller, view } = mount(target);
    await settle();
    const sending = controller.send('Go');
    write({ id: 'live', role: 'agent', text: '', thought: 'one' });
    await new Promise((resolve) => setTimeout(resolve, 150));
    const block = view.node.querySelector<HTMLDetailsElement>('.target-thought')!;
    expect(block.open).toBe(false);
    block.open = true;
    block.dispatchEvent(new Event('toggle'));
    write({ id: 'live', role: 'agent', text: '', thought: 'one two' });
    await new Promise((resolve) => setTimeout(resolve, 150));
    const repainted = view.node.querySelector<HTMLDetailsElement>('.target-thought')!;
    expect(repainted).not.toBe(block);
    expect(repainted.open).toBe(true);
    expect(thoughtOf(view)).toBe('one two');
    finish(FINISHED);
    await sending;
    // The finished turn's block starts folded again.
    expect(view.node.querySelector<HTMLDetailsElement>('.target-thought')!.open).toBe(false);
  });

  it('repaints a burst of deltas at most once per tick and not at all outside a send', async () => {
    const { target, write, finish, liveListeners } = streamingTarget();
    const { controller, view } = mount(target);
    await settle();
    write({ id: 'live', role: 'agent', text: 'idle', thought: 'idle' });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(view.node.querySelector('.target-thought')).toBeNull();
    const sending = controller.send('Go');
    let paints = 0;
    controller.subscribe(() => (paints += 1));
    for (let i = 0; i < 50; i++) {
      write({ id: 'live', role: 'agent', text: '', thought: `t${i}` });
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(paints).toBe(1);
    expect(thoughtOf(view)).toBe('t49');
    finish(FINISHED);
    await sending;
    controller.destroy();
    expect(liveListeners.size).toBe(0);
  });
});
