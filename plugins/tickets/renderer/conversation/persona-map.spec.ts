import { describe, expect, it } from 'vitest';
import { followsFleet, threadOfPersona, type PersonaWords } from './persona-map';

/** The catalog as a spec reads it: the key, then its params. */
const words: PersonaWords = {
  t: (key, params) => (params === undefined ? key : `${key} ${JSON.stringify(params)}`),
  formatTime: (date) => date.toISOString().slice(11, 16),
};

const messages = [
  { role: 'owner' as const, text: 'Why did T-0007 fail?', at: '2026-11-09T10:01:00Z' },
  { role: 'persona' as const, text: 'The gate ran npm test.\n\nThree specs failed.', at: '2026-11-09T10:02:00Z' },
  { role: 'owner' as const, text: 'Change something?', at: '2026-11-09T10:03:00Z' },
  { role: 'persona' as const, text: 'Yes.', at: '2026-11-09T10:04:00Z' },
];

describe('threadOfPersona — the 1:1 tab (req-168)', () => {
  it('maps owner lines and persona answers; the held session is the quiet line', () => {
    const thread = threadOfPersona('ben', 'Ben', { ok: true, messages, file: 'tickets/_meta/chat/x.md', session: 'held', releaseAt: '2026-11-09T10:19:00Z' }, words);
    expect(thread.id).toBe('tickets/_meta/chat/x.md');
    expect(thread.messages.map((m) => [m.role, m.text, m.author ?? null])).toEqual([
      ['user', 'Why did T-0007 fail?', null],
      ['agent', 'The gate ran npm test.\n\nThree specs failed.', 'Ben'],
      ['user', 'Change something?', null],
      ['agent', 'Yes.', 'Ben'],
    ]);
    expect(thread.notice).toBe('one_on_one.state.held {"time":"10:19"}');
  });

  it('says when the session starts or the persona answers, and nothing while none is held', () => {
    expect(threadOfPersona('ben', 'Ben', { ok: true, messages, session: 'starting' }, words).notice).toBe('one_on_one.state.starting {"name":"Ben"}');
    expect(threadOfPersona('ben', 'Ben', { ok: true, messages, session: 'answering' }, words).notice).toBe('one_on_one.state.answering {"name":"Ben"}');
    expect(threadOfPersona('ben', 'Ben', { ok: true, messages, session: 'none' }, words).notice).toBeUndefined();
    expect(threadOfPersona('ben', 'Ben', { ok: true, messages: [], session: 'bridge' }, words).notice).toBeUndefined();
  });

  it('hangs each proposal card on the answer it followed; pending cards carry Accept and Dismiss', () => {
    const proposals = [
      { id: 'p-1', state: 'confirmed' as const, summary: 'Name the date format', command: { kind: 'prompt' as const, text: 'x' }, at: '2026-11-09T10:02:00Z', decidedAt: '2026-11-09T10:02:30Z', outcome: 'prompt.md written' },
      { id: 'p-2', state: 'pending' as const, summary: 'Add git-hygiene', command: { kind: 'skill' as const, skill: 'git-hygiene' }, at: '2026-11-09T10:04:00Z', decidedAt: null, outcome: null },
    ];
    const thread = threadOfPersona('ben', 'Ben', { ok: true, messages, proposals }, words);
    expect(thread.messages[1]?.cards).toEqual([
      { id: 'p-1', kind: 'card', title: 'one_on_one.proposal.prompt', text: 'Name the date format', note: 'one_on_one.accepted_with {"outcome":"prompt.md written"}', actions: [] },
    ]);
    expect(thread.messages[3]?.cards?.[0]).toMatchObject({
      id: 'p-2',
      title: 'one_on_one.proposal.skill {"skill":"git-hygiene"}',
      actions: [
        { id: 'accept', label: 'one_on_one.accept', tone: 'primary' },
        { id: 'dismiss', label: 'one_on_one.dismiss', tone: 'quiet' },
      ],
    });
  });

  it('shows a failed turn as the error card, and a failed read as its own', () => {
    const failed = threadOfPersona('ben', 'Ben', { ok: true, messages: messages.slice(0, 1), failure: 'waits: ben has spent $4.00 of $4.00 today' }, words);
    expect(failed.messages.at(-1)?.error).toEqual({ title: 'one_on_one.could_not_answer {"name":"Ben"}', lines: ['waits: ben has spent $4.00 of $4.00 today'] });
    const unread = threadOfPersona('ben', 'Ben', { ok: false, error: 'no tickets vault detected' }, words);
    expect(unread.messages[0]?.error).toEqual({ title: 'one_on_one.could_not_read {"name":"Ben"}', lines: ['no tickets vault detected'] });
  });

  it('follows the fleet only while a session starts or a turn runs', () => {
    expect([followsFleet({ session: 'starting' }), followsFleet({ session: 'answering' }), followsFleet({ session: 'held' }), followsFleet(null)]).toEqual([true, true, false, false]);
  });
});
