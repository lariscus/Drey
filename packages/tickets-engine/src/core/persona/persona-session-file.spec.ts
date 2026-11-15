import { describe, expect, it } from 'vitest';
import { decideProposal, parseSessionFile } from '../chat/chat-session';
import { appendPersonaAnswer, appendPersonaOwner, appendPersonaProposal, migrateThread, newPersonaSessionText } from './persona-session-file';
import { extractProposals, parsePersonaSession } from './persona-session-parse';

const T0 = new Date('2026-11-09T10:00:00.000Z');
const T1 = new Date('2026-11-09T10:01:00.000Z');
const T2 = new Date('2026-11-09T10:02:10.000Z');
const FILE = 'tickets/_meta/chat/20261109-100000-1-1-with-ben.md';

describe('the persona session file (req-168, R3)', () => {
  it('is a Mission Control session with a persona: key', () => {
    const text = newPersonaSessionText('Ben', T0, 'ben');
    expect(text).toBe(`---\ntitle: "1:1 with Ben"\ncreated: '2026-11-09T10:00:00.000Z'\npersona: ben\n---\n\n`);
    expect(parseSessionFile(text, FILE)).toMatchObject({ title: '1:1 with Ben', persona: 'ben', messages: [] });
    expect(parsePersonaSession(text, FILE)).toMatchObject({ persona: 'ben', messages: [], proposals: [], migrated: null });
  });

  it('keeps multi-line answers and owner lines whole, the generic reader still sees one line each', () => {
    let text = newPersonaSessionText('Ben', T0, 'ben');
    text = appendPersonaOwner(text, T1, 'Why did T-0007 fail?\nAnd T-0008?');
    text = appendPersonaAnswer(text, T2, 'The gate ran `npm test`:\n\nthree specs failed.\n');
    expect(text).toContain(`- '2026-11-09T10:02:10.000Z' persona — The gate ran \`npm test\`:\n  \n  three specs failed.\n`);
    expect(parsePersonaSession(text, FILE)?.messages).toEqual([
      { role: 'owner', text: 'Why did T-0007 fail?\nAnd T-0008?', at: '2026-11-09T10:01:00.000Z' },
      { role: 'persona', text: 'The gate ran `npm test`:\n\nthree specs failed.', at: '2026-11-09T10:02:10.000Z' },
    ]);
    expect(parseSessionFile(text, FILE)?.messages.map((m) => m.text)).toEqual(['Why did T-0007 fail?']);
  });

  it('refuses an empty owner line and writes nothing for an empty answer', () => {
    const text = newPersonaSessionText('Ben', T0, 'ben');
    expect(() => appendPersonaOwner(text, T1, '  ')).toThrow('not empty');
    expect(appendPersonaAnswer(text, T2, ' \n ')).toBe(text);
  });

  it('carries proposal cards, decided with the Mission Control decision line', () => {
    let text = appendPersonaAnswer(newPersonaSessionText('Ben', T0, 'ben'), T1, 'I would name the date format.');
    const first = appendPersonaProposal(text, T1, 'Name the date format', { kind: 'prompt', text: 'Build small.\nDates are ISO.' });
    const second = appendPersonaProposal(first.text, T1, 'Add git-hygiene', { kind: 'skill', skill: 'git-hygiene' });
    expect([first.id, second.id]).toEqual(['p-1', 'p-2']);
    text = decideProposal(second.text, T2, 'p-1', 'confirmed', 'prompt.md written')!;
    const parsed = parsePersonaSession(text, FILE)!;
    expect(parsed.proposals).toEqual([
      { id: 'p-1', state: 'confirmed', summary: 'Name the date format', command: { kind: 'prompt', text: 'Build small.\nDates are ISO.' }, at: T1.toISOString(), decidedAt: T2.toISOString(), outcome: 'prompt.md written' },
      { id: 'p-2', state: 'pending', summary: 'Add git-hygiene', command: { kind: 'skill', skill: 'git-hygiene' }, at: T1.toISOString(), decidedAt: null, outcome: null },
    ]);
    expect(parsed.messages).toHaveLength(1);
  });

  it("migrates thread.md's owner lines once, with their own stamps, and says how many", () => {
    const thread = "---\ntitle: \"Ben\"\ncreated: '2026-11-03T09:00:00.000Z'\n---\n\n- '2026-11-03T09:01:00.000Z' owner — Treat rank fields as the owner's word\nbroken line\n- '2026-11-04T08:00:00.000Z' owner — Ask before any dependency bump\n";
    const moved = migrateThread(newPersonaSessionText('Ben', T0, 'ben'), thread, T1);
    expect(moved.count).toBe(2);
    const parsed = parsePersonaSession(moved.text, FILE)!;
    expect(parsed.migrated).toBe(2);
    expect(parsed.messages.map((m) => [m.at, m.text])).toEqual([
      ['2026-11-03T09:01:00.000Z', "Treat rank fields as the owner's word"],
      ['2026-11-04T08:00:00.000Z', 'Ask before any dependency bump'],
    ]);
    expect(migrateThread('x', '', T1)).toEqual({ text: 'x', count: 0 });
  });

  it('reads no persona session out of a Mission Control session', () => {
    expect(parsePersonaSession(`---\ntitle: "Chat"\ncreated: '2026-11-09T10:00:00.000Z'\n---\n\n`, FILE)).toBeNull();
  });
});

describe('extractProposals — the answer’s proposal blocks become cards', () => {
  it('pulls readable blocks out and keeps an unreadable one in the text', () => {
    const answer = [
      'I would change two things.',
      '',
      '```proposal',
      '{"kind": "prompt", "summary": "Name the date format", "text": "Dates are ISO."}',
      '```',
      '',
      '```proposal',
      '{"kind": "skill", "skill": "git-hygiene"}',
      '```',
      '',
      '```proposal',
      'not json',
      '```',
    ].join('\n');
    const out = extractProposals(answer);
    expect(out.proposals).toEqual([
      { summary: 'Name the date format', command: { kind: 'prompt', text: 'Dates are ISO.' } },
      { summary: 'Add the skill git-hygiene', command: { kind: 'skill', skill: 'git-hygiene' } },
    ]);
    expect(out.text).toBe('I would change two things.\n\n```proposal\nnot json\n```');
  });
});
