import { describe, expect, it } from 'vitest';
import { createI18n, loadCatalog, silentMissingKey } from '../../../../shared/i18n';
import type { PersonaJournalEntryView } from '../api/dto';
import { parsePersonaJournal, parsePersonaMemory } from '../api/dto';
import { journalRows, memoryMeta, memoryText } from './memory-rows';

const i18n = createI18n({ locale: 'en', catalog: loadCatalog('en'), onMissing: silentMissingKey });
const t = (key: Parameters<typeof i18n.t>[0], params?: Parameters<typeof i18n.t>[1]): string => i18n.t(key, params);

const JOURNAL: PersonaJournalEntryView[] = [
  { at: '2026-11-01', ticket: 'T-0007', harness: null, model: null, gate: 'none', costUsd: null, signals: ['friction'], friction: 'guessed', finding: null, note: 'migrated from friction.md' },
  { at: '2026-11-09T10:00:00Z', ticket: 'T-0102', harness: 'claude-code', model: 'sonnet', gate: 'red', costUsd: 0.42, signals: ['red-gate', 'retry'], friction: null, finding: { cause: 'prompt', text: 'no test command' }, note: null },
];

describe('the team detail memory rows (req-169)', () => {
  it('reads author and evidence off the wire, tolerantly', () => {
    const view = parsePersonaMemory({
      entries: [
        { text: '2026-11-09 · you · ask first', pinned: false, author: 'you', model: null, date: '2026-11-09', ticket: null, lesson: 'ask first' },
        { text: 'an old line', pinned: true },
      ],
    });
    expect(view.entries[0]).toEqual({ text: '2026-11-09 · you · ask first', pinned: false, author: 'you', model: null, date: '2026-11-09', ticket: null, lesson: 'ask first' });
    expect(memoryMeta(view.entries[0]!, t)).toBe('you · 2026-11-09');
    expect(memoryText(view.entries[0]!)).toBe('ask first');
    expect(memoryMeta(view.entries[1]!, t)).toBe('');
    expect(memoryText(view.entries[1]!)).toBe('an old line');
  });

  it("a persona's lesson names persona/model and ticket", () => {
    expect(memoryMeta({ text: 'x', pinned: false, author: 'ben', model: 'sonnet', date: '2026-11-09', ticket: 'T-0102', lesson: 'x' }, t)).toBe('ben/sonnet · T-0102 · 2026-11-09');
  });

  it('parses the journal and lists it newest first, the index the file position', () => {
    const view = parsePersonaJournal({ entries: [...JOURNAL, { junk: true }] });
    expect(view.entries).toEqual(JOURNAL);
    const rows = journalRows(view.entries, t);
    expect(rows.map((r) => r.index)).toEqual([1, 0]);
    expect(rows[0]).toEqual({ index: 1, at: '2026-11-09T10:00:00Z', head: 'T-0102 · claude-code/sonnet · gate red · $0.42 · 2026-11-09', lines: ['Why: red gate, retry', 'Finding (prompt): no test command'] });
    expect(rows[1]!.lines).toEqual(['Why: friction', 'Friction: guessed', 'Note: migrated from friction.md']);
  });
});
