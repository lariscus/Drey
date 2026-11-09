import { describe, expect, it } from 'vitest';
import type { ChatSession } from '../../../../packages/tickets-engine/src/contracts/chat';
import { burnRateMessageOf, errorMessageOf, threadOfPersona, threadOfSession, trancheMessageOf, VIA_MISSION_CONTROL, withTrancheMessage } from './map';

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

describe('threadOfPersona', () => {
  it('maps the owner messages and names who reads the thread', () => {
    const thread = threadOfPersona('ben', 'Ben', { ok: true, messages: [{ at: 'a', role: 'owner', text: 'Prefer small commits' }] });
    expect(thread.messages).toEqual([{ id: 't-0', role: 'user', text: 'Prefer small commits' }]);
    expect(thread.notice).toBe('Ben reads this thread before the next run.');
  });

  it('turns a failed read into an error message', () => {
    const thread = threadOfPersona('ben', 'Ben', { ok: false, error: 'no such persona' });
    expect(thread.messages[0]?.error?.lines).toEqual(['no such persona']);
  });
});

describe('trancheMessageOf (board 10u parts 1 and 6, SDK 1.55)', () => {
  const card = {
    id: 'tranche-1-2026-11-09T14:02:00.000Z',
    kind: 'checkpoint' as const,
    tone: 'attention' as const,
    title: 'Checkpoint · tranche 1 of 3 done',
    body: null,
    metrics: [
      { label: 'Gate rate', value: '7 of 8', sub: 'green', inline: true },
      { label: 'Cost per run', value: '$0.41', sub: 'median · $1.20 max', inline: false },
      { label: 'Cost', value: 'Not known', sub: '', inline: false },
    ],
    rows: [],
    summary: 'Autopilot paused · 10 runs · $4.10 · 2 h 10 min',
    at: '2026-11-09T14:02:00.000Z',
    actions: [
      { id: 'release' as const, label: 'Release next tranche', primary: true },
      { id: 'adjust' as const, label: 'Adjust…', primary: false },
    ],
  };

  it('maps the card model onto the SDK card, the summary as the note and the time as the meta line', () => {
    const message = trancheMessageOf(card, 'Mission Control · 14:02');
    expect(message).toMatchObject({ id: card.id, role: 'agent', text: '' });
    expect(message.cards).toEqual([
      {
        id: card.id,
        kind: 'card',
        title: 'Checkpoint · tranche 1 of 3 done',
        dot: 'attention',
        text: '',
        metrics: [
          { label: 'Gate rate', value: '7 of 8', sub: 'green', inline: true },
          { label: 'Cost per run', value: '$0.41', sub: 'median · $1.20 max', inline: false },
          { label: 'Cost', value: 'Not known' },
        ],
        note: 'Autopilot paused · 10 runs · $4.10 · 2 h 10 min',
        actions: [
          { id: 'release', label: 'Release next tranche', tone: 'primary' },
          { id: 'adjust', label: 'Adjust…', tone: 'quiet' },
        ],
        meta: 'Mission Control · 14:02',
      },
    ]);
  });

  it('carries an early stop as body and red rows, without a note', () => {
    const early = { ...card, kind: 'early' as const, tone: 'negative' as const, body: '3 of the last 6 gates were red.', metrics: [], rows: ['T-0119 · build · Ben · red twice'], summary: null };
    expect(trancheMessageOf(early, 'm').cards![0]).toMatchObject({ dot: 'negative', text: '3 of the last 6 gates were red.', rows: [{ text: 'T-0119 · build · Ben · red twice', dot: 'negative' }] });
    expect(trancheMessageOf(early, 'm').cards![0]).not.toHaveProperty('note');
    expect(trancheMessageOf(early, 'm').cards![0]).not.toHaveProperty('metrics');
  });

  it('appends the message to the thread, and leaves the thread alone without one', () => {
    const thread = { id: 'x', title: 'Demo', messages: [] };
    expect(withTrancheMessage(thread, null)).toBe(thread);
    expect(withTrancheMessage(thread, trancheMessageOf(card, 'm')).messages).toHaveLength(1);
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
