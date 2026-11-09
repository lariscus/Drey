import { describe, expect, it } from 'vitest';
import { parseJournalBlock, renderJournalEntry, type JournalEntry } from './persona-journal';
import { journalFromFriction, parseJournal, withJournalEntries, withoutJournalEntry } from './persona-journal-file';

const ENTRY: JournalEntry = {
  at: '2026-11-09T10:12:03Z',
  ticket: 'T-0102',
  persona: 'ben',
  harness: 'zai',
  model: 'glm-5.3',
  gate: 'red',
  costUsd: 0.4231,
  signals: ['red-gate', 'retry'],
  friction: 'the brief named\nno test command',
  finding: { cause: 'prompt', text: 'the brief never said how the repo runs its tests' },
  note: null,
};

describe('the journal entry (req-169)', () => {
  it('renders the head and fields, one line each', () => {
    expect(renderJournalEntry(ENTRY)).toEqual([
      '- 2026-11-09T10:12:03Z · T-0102 · ben · zai/glm-5.3 · gate red · $0.42',
      '  - signals: red-gate, retry',
      '  - friction: the brief named no test command',
      '  - finding (prompt): the brief never said how the repo runs its tests',
    ]);
  });

  it('reads back what it wrote; the model keeps a slash of its own', () => {
    const back = parseJournalBlock(renderJournalEntry({ ...ENTRY, harness: 'opencode', model: 'zai/glm-5.3' }));
    expect(back).toMatchObject({ harness: 'opencode', model: 'zai/glm-5.3', costUsd: 0.42, friction: 'the brief named no test command' });
  });

  it('an unknown model and cost render as dashes and read back as null', () => {
    const lines = renderJournalEntry({ ...ENTRY, ticket: null, harness: null, model: null, costUsd: null, finding: null, note: 'round skipped — no session' });
    expect(lines[0]).toBe('- 2026-11-09T10:12:03Z · — · ben · — · gate red · —');
    expect(parseJournalBlock(lines)).toMatchObject({ ticket: null, harness: null, model: null, costUsd: null, note: 'round skipped — no session' });
  });

  it('a head that does not parse is no entry', () => {
    expect(parseJournalBlock(['- a hand note'])).toBeNull();
  });
});

describe('the journal file (req-169)', () => {
  it('starts with the header, appends at the end, keeps a hand-written block verbatim but unlisted', () => {
    const first = withJournalEntries(null, [ENTRY]);
    expect(first.startsWith('# Reviews\n\n- 2026-11-09T10:12:03Z')).toBe(true);
    const handEdited = `${first}- my own aside\n  with a second line\n`;
    const second = withJournalEntries(handEdited, [{ ...ENTRY, at: '2026-11-10T08:00:00Z' }]);
    expect(second).toContain('- my own aside\n  with a second line');
    expect(parseJournal(second).map((e) => e.at)).toEqual(['2026-11-09T10:12:03Z', '2026-11-10T08:00:00Z']);
  });

  it('removes exactly the entry the caller saw, and refuses when the stamp does not match', () => {
    const text = withJournalEntries(null, [ENTRY, { ...ENTRY, at: '2026-11-10T08:00:00Z' }]);
    expect(withoutJournalEntry(text, 1, '2026-11-09T10:12:03Z')).toBeNull();
    expect(withoutJournalEntry(text, 5, '2026-11-09T10:12:03Z')).toBeNull();
    const removed = withoutJournalEntry(text, 0, '2026-11-09T10:12:03Z')!;
    expect(parseJournal(removed).map((e) => e.at)).toEqual(['2026-11-10T08:00:00Z']);
  });

  it('caps at 200 entries, the oldest dropped first', () => {
    const many = Array.from({ length: 205 }, (_, i) => ({ ...ENTRY, at: `2026-11-09T10:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}Z` }));
    const entries = parseJournal(withJournalEntries(null, many));
    expect(entries).toHaveLength(200);
    expect(entries[0]!.at).toBe(many[5]!.at);
  });

  it('migrates friction.md lines as entries noted so, placed before the runs', () => {
    const migrated = journalFromFriction('# Friction\n\n- 2026-11-01 · T-0007 · guessed the order.md shape\nnot a line\n', 'ben');
    expect(migrated).toEqual([
      { at: '2026-11-01', ticket: 'T-0007', persona: 'ben', harness: null, model: null, gate: 'none', costUsd: null, signals: ['friction'], friction: 'guessed the order.md shape', finding: null, note: 'migrated from friction.md' },
    ]);
    const merged = parseJournal(withJournalEntries(withJournalEntries(null, [ENTRY]), migrated, 'start'));
    expect(merged.map((e) => e.at)).toEqual(['2026-11-01', '2026-11-09T10:12:03Z']);
  });
});
