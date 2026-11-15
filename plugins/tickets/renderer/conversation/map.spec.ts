import { describe, expect, it } from 'vitest';
import type { ChatSession } from '../../../../packages/tickets-engine/src/contracts/chat';
import { burnRateMessageOf, errorMessageOf, threadOfSession, cardMessageOf, VIA_MISSION_CONTROL, withCardMessage } from './map';

const base: ChatSession = {
  file: 'tickets/_meta/chat/20261104-100000-demo.md',
  title: 'Demo',
  createdAt: '2026-11-04T10:00:00Z',
  messages: [
    { role: 'owner', text: 'Create a ticket', at: '2026-11-04T10:00:01Z', thought: null },
    { role: 'mission', text: 'Proposed.', at: '2026-11-04T10:00:05Z', thought: 'thinking' },
  ],
  proposals: [
    {
      id: 'p-1',
      state: 'pending',
      summary: 'Create ticket "Fix the login"',
      command: { kind: 'createTicket', title: 'Fix the login', description: '', priority: 'normal', phase: 'inbox' },
      at: '2026-11-04T10:00:06Z',
      decidedAt: null,
      outcome: null,
    },
  ],
};

describe('threadOfSession', () => {
  it('maps roles and puts a pending proposal on the mission message it followed, with Confirm and Dismiss', () => {
    const thread = threadOfSession(base);
    expect(thread.id).toBe(base.file);
    expect(thread.messages.map((m) => m.role)).toEqual(['user', 'agent']);
    const card = thread.messages[1]?.cards?.[0];
    expect(card).toMatchObject({ id: 'p-1', kind: 'card', text: 'Create ticket "Fix the login"' });
    expect(card?.actions?.map((a) => a.id)).toEqual(['confirm', 'dismiss']);
    expect(thread.messages[1]?.thought).toBe('thinking');
    expect(thread.messages[1]?.via).toBeUndefined();
  });

  it('shows a decided proposal as a note without buttons', () => {
    const decided = {
      ...base,
      proposals: [{ ...base.proposals[0]!, state: 'confirmed' as const, decidedAt: 'x', outcome: 'T-0140' }],
    };
    const card = threadOfSession(decided).messages[1]?.cards?.[0];
    expect(card?.actions).toEqual([]);
    expect(card?.note).toBe('Done — T-0140');
  });

  it('makes Paul the author of relays in a shape session, via Mission Control', () => {
    const thread = threadOfSession({ ...base, ticket: 'T-0130' });
    expect(thread.messages[1]).toMatchObject({ author: 'Paul', via: VIA_MISSION_CONTROL });
  });

  it('offers the last question as an answer card and an undecided split as a card', () => {
    const asked = threadOfSession({
      ...base,
      proposals: [],
      messages: [
        ...base.messages,
        {
          role: 'mission',
          text: 'How many parts?',
          at: '2026-11-04T10:01:00Z',
          thought: null,
          kind: 'question',
          options: [{ label: '3 parts', recommended: true }, { label: '2 parts', recommended: false }],
        },
      ],
    });
    const question = asked.messages[2];
    expect(question?.author).toBe('Paul');
    expect(question?.cards?.[0]).toMatchObject({ kind: 'choices' });
    expect(question?.cards?.[0]?.choices?.map((c) => c.label)).toEqual(['3 parts', '2 parts']);

    const split = threadOfSession({
      ...base,
      proposals: [],
      messages: [{ role: 'mission', text: 'Split?', at: 'a', thought: null, kind: 'split', parts: 3, decision: null }],
    });
    expect(split.messages[0]?.cards?.[0]?.actions?.map((a) => a.id)).toEqual(['split', 'keep']);
  });

  it('does not offer an answered question again', () => {
    const answered = threadOfSession({
      ...base,
      proposals: [],
      messages: [
        { role: 'mission', text: 'Which?', at: 'a', thought: null, kind: 'question', options: [{ label: 'A', recommended: false }] },
        { role: 'owner', text: 'A', at: 'b', thought: null },
      ],
    });
    expect(answered.messages[0]?.cards).toBeUndefined();
  });
});

describe('errorMessageOf', () => {
  it('uses the D-1 failure lines when there is one, else the bare error', () => {
    const failed = errorMessageOf(
      {
        code: 'unsupported',
        provider: 'claude-code',
        providerLabel: 'Claude Code',
        baseUrl: null,
        model: null,
        reason: 'the CLI providers cannot drive the chat',
        message: 'x',
      },
      undefined,
    );
    expect(failed.error?.title).toBe('Claude Code could not answer');
    expect(failed.error?.lines).toEqual(['the CLI providers cannot drive the chat']);
    expect(errorMessageOf(undefined, 'boom').error?.lines).toEqual(['boom']);
  });
});

describe('cardMessageOf (SDK 1.55)', () => {
  const card = {
    id: 'burn-rate-2026-11-10T00:00:00.000Z',
    title: 'Burn rate reached · 20 % of the week today',
    tone: 'attention' as const,
    body: 'The crew is over today’s share of the weekly quota.',
    rows: [],
    summary: 'Nothing new starts until the day turns.',
    actions: [
      { id: 'wait', label: 'Wait', primary: false },
      { id: 'allow_once', label: 'Allow today once', primary: true },
    ],
  };

  it('maps a card model onto the SDK card, the summary as the note', () => {
    const message = cardMessageOf(card, 'm');
    expect(message).toMatchObject({ id: card.id, role: 'agent', text: '' });
    expect(message.cards![0]).toMatchObject({ id: card.id, kind: 'card', title: card.title, dot: 'attention', note: 'Nothing new starts until the day turns.' });
  });

  it('carries rows as red rows, without a note when there is none', () => {
    const early = { ...card, tone: 'negative' as const, summary: null, rows: [{ text: 'T-0119 · build · Ben · red twice', dot: 'negative' as const }] };
    expect(cardMessageOf(early, 'm').cards![0]).toMatchObject({ dot: 'negative', rows: [{ text: 'T-0119 · build · Ben · red twice', dot: 'negative' }] });
    expect(cardMessageOf(early, 'm').cards![0]).not.toHaveProperty('note');
    expect(cardMessageOf(early, 'm').cards![0]).not.toHaveProperty('metrics');
  });

  it('appends the message to the thread, and leaves the thread alone without one', () => {
    const thread = { id: 'x', title: 'Demo', messages: [] };
    expect(withCardMessage(thread, null)).toBe(thread);
    expect(withCardMessage(thread, cardMessageOf(card, 'm')).messages).toHaveLength(1);
  });
});

describe('burnRateMessageOf (req-181, board 10u chrome, SDK 1.56 chips)', () => {
  const card = {
    id: 'burn-rate-2026-11-10T00:00:00.000Z',
    tone: 'attention' as const,
    title: 'Burn rate reached · 20 % of the week today',
    body: 'Nothing new starts until 00:00. Running steps finish.',
    chips: ['spent 21 %', 'resumes 00:00'],
    at: '2026-11-09T22:40:00.000Z',
    actions: [
      { id: 'wait' as const, label: 'Wait', primary: true },
      { id: 'allow_once' as const, label: 'Allow today once', primary: false },
    ],
  };

  it('maps the shared card onto the SDK card: dot, body, chips, buttons, meta', () => {
    expect(burnRateMessageOf(card, 'Mission Control · 22:40')).toEqual({
      id: card.id,
      role: 'agent',
      text: '',
      cards: [
        {
          id: card.id,
          kind: 'card',
          title: 'Burn rate reached · 20 % of the week today',
          dot: 'attention',
          text: 'Nothing new starts until 00:00. Running steps finish.',
          chips: ['spent 21 %', 'resumes 00:00'],
          actions: [
            { id: 'wait', label: 'Wait', tone: 'primary' },
            { id: 'allow_once', label: 'Allow today once', tone: 'quiet' },
          ],
          meta: 'Mission Control · 22:40',
        },
      ],
    });
    expect(burnRateMessageOf(card, '').cards![0]).not.toHaveProperty('meta');
  });
});
