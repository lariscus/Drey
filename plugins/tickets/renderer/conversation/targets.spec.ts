import { describe, expect, it, vi } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- the spec stands in for the host, which owns the catalog at runtime
import { i18n } from '../../../../shared/i18n';
import { burnRateHoldOf } from '../../../../shared/burn-rate';
import type { ChatStreamEvent } from '../../../../packages/tickets-engine/src/contracts/chat';
import type { PersonaView } from '../../shared/remote-protocol';
import {
  createConversationProvider,
  MISSION_CONTROL_TARGET,
  PERSONA_GROUP,
  personaTargetId,
  type ConversationDeps,
  type HoldBinding,
} from './targets';

const persona = (id: string, title: string, kind?: 'human' | 'mission'): PersonaView =>
  ({ id, title, ...(kind !== undefined ? { kind } : {}) }) as unknown as PersonaView;

const FILE = 'tickets/_meta/chat/20261104-100000-demo.md';

function deps(over: Partial<ConversationDeps> = {}) {
  const calls: { method: string; payload: unknown }[] = [];
  const full: ConversationDeps = {
    invoke: (method, payload) => {
      calls.push({ method, payload });
      if (method === 'mcSessions') {
        return Promise.resolve([{ file: FILE, title: 'Demo', createdAt: 'a', updatedAt: 'b', pending: 1 }]);
      }
      if (method === 'mcOpen') {
        return Promise.resolve({ file: FILE, title: 'Demo', createdAt: 'a', messages: [], proposals: [] });
      }
      if (method === 'mcStart' || method === 'mcSend') {
        return Promise.resolve({ ok: true, file: FILE });
      }
      return Promise.resolve({ ok: true, messages: [] });
    },
    personas: () => [persona('pia', 'Pia', 'mission'), persona('paul', 'Paul'), persona('owner', 'You', 'human'), persona('ben', 'Ben')],
    subscribePersonas: () => () => undefined,
    ...over,
  };
  return { deps: full, calls };
}

describe('createConversationProvider', () => {
  it("offers Mission Control first, then one 1:1 per agent persona — none for the owner or for Mission Control's persona (req-269)", () => {
    const targets = createConversationProvider(deps().deps).targets();
    expect(targets.map((t) => t.id)).toEqual([MISSION_CONTROL_TARGET, personaTargetId('paul'), personaTargetId('ben')]);
    expect(targets[1]?.group).toBe(PERSONA_GROUP);
  });

  it('keeps a persona target stable between calls', () => {
    const provider = createConversationProvider(deps().deps);
    expect(provider.targets()[1]).toBe(provider.targets()[1]);
  });
});

describe('the Mission Control target', () => {
  it('opens the newest session, sends into it and starts a fresh one on a new thread', async () => {
    const { deps: d, calls } = deps();
    const mission = createConversationProvider(d).targets()[0]!;
    const opened = await mission.thread();
    expect(opened.id).toBe(FILE);
    await mission.send('Hello');
    expect(calls.map((c) => c.method)).toEqual(['mcSessions', 'mcOpen', 'mcSend', 'mcOpen']);
    expect(calls[2]?.payload).toEqual({ file: FILE, text: 'Hello' });
    await mission.newThread();
    await mission.send('Fresh');
    expect(calls.some((c) => c.method === 'mcStart' && (c.payload as { text: string }).text === 'Fresh')).toBe(true);
  });

  it("sends the title bar's project with the turn, none when the dep names none (req-298, req-308)", async () => {
    let project: string | undefined = 'drey';
    const { deps: d, calls } = deps({ project: () => project });
    const mission = createConversationProvider(d).targets()[0]!;
    await mission.thread();
    await mission.send('Capture it');
    project = undefined;
    await mission.send('And this');
    const sends = calls.filter((c) => c.method === 'mcSend').map((c) => c.payload);
    expect(sends).toEqual([
      { file: FILE, text: 'Capture it', project: 'drey' },
      { file: FILE, text: 'And this' },
    ]);
  });

  it('shows a refused turn as the failure card, not as a message', async () => {
    const { deps: d } = deps({
      invoke: (method) =>
        Promise.resolve(
          method === 'mcSend' || method === 'mcStart'
            ? {
                ok: false,
                error: 'no model',
                failure: {
                  code: 'unsupported',
                  provider: 'claude-code',
                  providerLabel: 'Claude Code',
                  baseUrl: null,
                  model: null,
                  reason: 'the Claude Code CLI cannot drive the chat; pick an HTTP provider',
                  message: 'm',
                },
              }
            : method === 'mcSessions'
              ? []
              : { ok: true },
        ),
    });
    const mission = createConversationProvider(d).targets()[0]!;
    const after = await mission.send('Hi');
    const last = after.messages.at(-1);
    expect(last?.error?.title).toBe('Claude Code could not answer');
    expect(last?.error?.lines[0]).toContain('pick an HTTP provider');
  });

  it('routes a card button to confirm / dismiss and a split card to the shape decision', async () => {
    const { deps: d, calls } = deps();
    const mission = createConversationProvider(d).targets()[0]!;
    await mission.thread();
    await mission.act('p-1', 'confirm');
    await mission.act('s-3', 'keep');
    const decide = calls.find((c) => c.method === 'mcDecide');
    expect(decide?.payload).toEqual({ file: FILE, id: 'p-1', decision: 'confirm' });
    expect(calls.find((c) => c.method === 'mcShapeDecide')?.payload).toEqual({ file: FILE, choice: 'keep' });
  });
});

describe('a persona target (req-168)', () => {
  it('reads the 1:1, sends a line and routes a card button to the proposal decision', async () => {
    const { deps: d, calls } = deps();
    const ben = createConversationProvider(d).targets()[2]!;
    await ben.thread();
    await ben.send('Prefer small commits');
    await ben.act('p-1', 'accept');
    await ben.act('p-2', 'dismiss');
    expect(calls.map((c) => [c.method, c.payload])).toEqual([
      ['personaThread', { persona: 'ben' }],
      ['personaThreadAppend', { persona: 'ben', text: 'Prefer small commits' }],
      ['personaProposalDecide', { persona: 'ben', id: 'p-1', decision: 'confirm' }],
      ['personaProposalDecide', { persona: 'ben', id: 'p-2', decision: 'dismiss' }],
    ]);
    expect(ben.description).toBe('one_on_one.talk_to');
  });

  it('follows board changes always, fleet changes only while a session starts or a turn runs', async () => {
    let fire: (what: 'board' | 'fleet') => void = () => undefined;
    let reply: unknown = { ok: true, messages: [], session: 'answering' };
    const { deps: d } = deps({
      invoke: () => Promise.resolve(reply),
      subscribeChanges: (listener) => ((fire = listener), () => undefined),
    });
    const ben = createConversationProvider(d).targets()[2]!;
    const heard: string[] = [];
    ben.onThreadChange!(() => heard.push('read'));
    await ben.thread();
    fire('fleet');
    reply = { ok: true, messages: [], session: 'held', releaseAt: '2026-11-09T10:15:00Z' };
    await ben.thread();
    fire('fleet');
    fire('board');
    expect(heard).toEqual(['read', 'read']);
  });
});

describe('Mission Control: the burn rate card (req-181, board 10u chrome)', () => {
  const HOLD = { reason: 'burn-rate', spent: 0.21, limit: 0.2, resumesAt: '2026-11-10T00:00:00.000Z', basis: 'measured', since: '2026-11-09T22:40:00.000Z' };

  function withHold(initial: object | null, liftWords: string | null = null) {
    let current = burnRateHoldOf({ hold: initial });
    const listeners = new Set<() => void>();
    const lifted: string[] = [];
    const binding: HoldBinding = {
      view: () => current,
      format: () => ({ t: (key, params) => i18n.t(key, params), time: (date) => date.toISOString().slice(11, 16) }),
      lift: () => {
        lifted.push('lift');
        if (liftWords === null) {
          current = null;
        }
        return Promise.resolve(liftWords);
      },
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    const mission = createConversationProvider({ ...deps().deps, hold: binding }).targets()[0]!;
    return {
      mission,
      lifted,
      set: (next: object | null) => {
        current = burnRateHoldOf({ hold: next });
        listeners.forEach((listener) => listener());
      },
    };
  }

  it('ends the thread with the card while the hold stands, and not before', async () => {
    const { mission, set } = withHold(null);
    expect((await mission.thread()).messages).toHaveLength(0);
    set(HOLD);
    const card = (await mission.thread()).messages[0]!.cards![0]!;
    expect(card).toMatchObject({
      title: 'Burn rate reached · 20 % of the week today',
      dot: 'attention',
      text: 'Nothing new starts until 00:00. Running steps finish.',
      chips: ['spent 21 %', 'resumes 00:00'],
      meta: 'Mission Control · 22:40',
    });
    expect(card.actions!.map((a) => [a.label, a.tone])).toEqual([['Wait', 'primary'], ['Allow today once', 'quiet']]);
  });

  it('Wait dismisses the card for the day; Allow today once lifts the hold', async () => {
    const { mission, lifted } = withHold(HOLD);
    const id = (await mission.thread()).messages[0]!.cards![0]!.id;
    expect((await mission.act(id, 'wait')).messages).toHaveLength(0);
    expect(lifted).toEqual([]);
    const other = withHold(HOLD);
    const second = (await other.mission.thread()).messages[0]!.cards![0]!.id;
    expect((await other.mission.act(second, 'allow_once')).messages).toHaveLength(0);
    expect(other.lifted).toEqual(['lift']);
  });

  it('a refused lift shows the words and keeps the card', async () => {
    const { mission } = withHold(HOLD, 'the fleet runner is not running');
    const id = (await mission.thread()).messages[0]!.cards![0]!.id;
    const after = await mission.act(id, 'allow_once');
    expect(after.messages.some((m) => m.error !== undefined || m.text.includes('the fleet runner is not running'))).toBe(true);
    expect(after.messages.at(-1)!.cards![0]!.id).toBe(id);
  });

  it('tells the Assistant when the hold rises or clears', () => {
    const { mission, set } = withHold(null);
    const listener = vi.fn();
    const off = mission.onThreadChange!(listener);
    set(HOLD);
    set({ ...HOLD, spent: 0.25 });
    expect(listener).toHaveBeenCalledTimes(1);
    set(null);
    expect(listener).toHaveBeenCalledTimes(2);
    off();
  });
});

describe('the live answer of a Mission Control turn (D-76)', () => {
  type Live = { readonly file: string; readonly event: ChatStreamEvent };
  const OTHER = 'tickets/_meta/chat/20261104-110000-other.md';

  /** A target whose `mcSend` / `mcStart` hangs until `finish`, fed by an engine stream the spec drives. */
  function streaming() {
    const base = deps();
    const listeners = new Set<(live: Live) => void>();
    const turn: { finish: (value: unknown) => void; started: boolean } = { finish: () => undefined, started: false };
    const { deps: d } = deps({
      invoke: (method, payload) =>
        method === 'mcSend' || method === 'mcStart'
          ? new Promise((resolve) => {
              turn.started = true;
              turn.finish = resolve;
            })
          : base.deps.invoke(method, payload),
      subscribeLive: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    });
    const mission = createConversationProvider(d).targets()[0]!;
    const emit = (event: ChatStreamEvent, file = FILE): void => listeners.forEach((listener) => listener({ file, event }));
    return { mission, emit, turn, listeners };
  }

  it('shows the thought and the say while the model writes them, before the turn resolves', async () => {
    const { mission, emit, turn } = streaming();
    await mission.thread();
    const painted = vi.fn();
    mission.onLiveChange!(painted);
    expect(mission.live!()).toBeNull();
    const sending = mission.send('Queue both');
    await vi.waitFor(() => expect(turn.started).toBe(true));
    emit({ kind: 'thought', text: 'ticket_read T-1 … ' });
    expect(painted).toHaveBeenCalledTimes(1);
    expect(mission.live!()).toMatchObject({ role: 'agent', text: '', thought: 'ticket_read T-1 …' });
    for (const delta of ['{"say": "On ', 'it.", "thought": "Ben is fr', 'ee']) {
      emit({ kind: 'text', text: delta });
    }
    expect(mission.live!()).toMatchObject({ text: 'On it.', thought: 'ticket_read T-1 …\nBen is free' });
    // Nothing resolved yet: the thread of the session still holds the old messages only.
    expect(turn.started).toBe(true);
    turn.finish({ ok: true, file: FILE });
    await sending;
  });

  it('starts the next round clean: the tool step ends the text that came before it', async () => {
    const { mission, emit, turn } = streaming();
    await mission.thread();
    mission.onLiveChange!(() => undefined);
    const sending = mission.send('Go');
    await vi.waitFor(() => expect(turn.started).toBe(true));
    emit({ kind: 'text', text: 'let me look' });
    emit({ kind: 'thought', text: 'vault_read a.md … ' });
    emit({ kind: 'text', text: '{"say": "Done."}' });
    expect(mission.live!()).toMatchObject({ text: 'Done.', thought: 'vault_read a.md …' });
    turn.finish({ ok: true, file: FILE });
    await sending;
  });

  it('ignores another session and anything outside a send', async () => {
    const { mission, emit, turn } = streaming();
    await mission.thread();
    const painted = vi.fn();
    mission.onLiveChange!(painted);
    emit({ kind: 'text', text: '{"say": "before"}' });
    expect(painted).not.toHaveBeenCalled();
    const sending = mission.send('Go');
    await vi.waitFor(() => expect(turn.started).toBe(true));
    emit({ kind: 'text', text: '{"say": "phone talks"}' }, OTHER);
    expect(painted).not.toHaveBeenCalled();
    expect(mission.live!()).toBeNull();
    turn.finish({ ok: true, file: FILE });
    await sending;
    painted.mockClear();
    emit({ kind: 'text', text: '{"say": "after"}' });
    expect(painted).not.toHaveBeenCalled();
  });

  it("adopts the session a first message's first event names and then holds to it", async () => {
    const { mission, emit, turn } = streaming();
    await mission.newThread();
    mission.onLiveChange!(() => undefined);
    const sending = mission.send('Fresh');
    await vi.waitFor(() => expect(turn.started).toBe(true));
    emit({ kind: 'text', text: '{"say": "mine"}' }, OTHER);
    emit({ kind: 'text', text: '{"say": "not mine"}' }, FILE);
    expect(mission.live!()).toMatchObject({ text: 'mine' });
    turn.finish({ ok: true, file: OTHER });
    await sending;
  });

  it('stops listening to the stream when the Assistant unsubscribes', async () => {
    const { mission, listeners } = streaming();
    const off = mission.onLiveChange!(() => undefined);
    expect(listeners.size).toBe(1);
    off();
    expect(listeners.size).toBe(0);
  });

  it('offers no live answer to a plugin that wires no stream', () => {
    const mission = createConversationProvider(deps().deps).targets()[0]!;
    expect(mission.live).toBeUndefined();
    expect(mission.onLiveChange).toBeUndefined();
  });
});
