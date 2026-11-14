import { describe, expect, it } from 'vitest';
import { parseImprovements } from './improvements';
import { holdsLesson, personaLessonLine } from './memory-line';
import { RUN_JOURNAL_NOTE, type JournalEntry } from './persona-journal';
import { parseJournal, withJournalEntries, withRoundEntry } from './persona-journal-file';
import { withRoundProposal } from './round-proposal';

/** The pure halves of the runs' persona writes (req-225, req-226): the duplicate lesson, the merged journal entry, the proposal text. */

const lesson = (text: string, persona = 'ben'): string => personaLessonLine({ date: '2026-11-14', ticket: 'T-0007', persona, model: 'sonnet', lesson: text });

const entry = (over: Partial<JournalEntry> = {}): JournalEntry => ({
  at: '2026-11-14T10:05:00Z',
  ticket: 'T-0007',
  persona: 'ben',
  harness: 'claude-code',
  model: 'sonnet',
  gate: 'red',
  costUsd: 0.42,
  signals: ['red-gate'],
  friction: null,
  finding: { cause: 'prompt', text: 'the brief named no test command' },
  note: null,
  ...over,
});

const runNote = (over: Partial<JournalEntry> = {}): JournalEntry =>
  entry({ at: '2026-11-14T10:02:00Z', gate: 'none', costUsd: null, signals: [], friction: 'guessed the test command', finding: null, note: RUN_JOURNAL_NOTE, ...over });

describe('holdsLesson (req-226)', () => {
  const memory = `# Memory\n\n${lesson('Run the repo verify script.')}\n- 2026-11-14 · you · never touch the generated client\n`;

  it('finds the same lesson of the same persona, whatever its date, ticket, case or full stop', () => {
    expect(holdsLesson(memory, personaLessonLine({ date: '2026-11-15', ticket: 'T-0009', persona: 'ben', model: 'opus', lesson: 'run the repo  verify script' }))).toBe(true);
  });

  it('a new lesson, another persona or an owner line is not a duplicate', () => {
    expect(holdsLesson(memory, lesson('keep commits small'))).toBe(false);
    expect(holdsLesson(memory, lesson('Run the repo verify script.', 'ralf'))).toBe(false);
    expect(holdsLesson(memory, '- 2026-11-14 · you · never touch the generated client')).toBe(false);
  });
});

describe('withRoundEntry (req-226): one journal entry per run', () => {
  it("takes the place of the run's own journal_write entry and keeps its note as the friction", () => {
    const file = withJournalEntries(null, [runNote()]);
    const [merged, ...rest] = parseJournal(withRoundEntry(file, entry(), '2026-11-14T10:00:00.000Z'));
    expect(rest).toEqual([]);
    expect(merged).toMatchObject({ at: '2026-11-14T10:05:00Z', gate: 'red', friction: 'guessed the test command', note: null, finding: { cause: 'prompt' } });
  });

  it("the round's own friction wins over the run's note", () => {
    const [merged] = parseJournal(withRoundEntry(withJournalEntries(null, [runNote()]), entry({ friction: 'no test command' }), '2026-11-14T10:00:00Z'));
    expect(merged?.friction).toBe('no test command');
  });

  it("an earlier run's note, another ticket or a plain entry stay — the round's entry is appended", () => {
    const file = withJournalEntries(null, [runNote({ at: '2026-11-13T09:00:00Z' }), runNote({ ticket: 'T-0008' }), entry({ at: '2026-11-14T10:01:00Z' })]);
    expect(parseJournal(withRoundEntry(file, entry(), '2026-11-14T10:00:00Z'))).toHaveLength(4);
  });
});

describe('withRoundProposal (req-169, shared by both writers since req-225)', () => {
  const prompt = '# Ben\n\nRun the tests.\n';

  it('a prompt.md proposal stores the prompt with its edits applied, as an open card with the next id', () => {
    const written = withRoundProposal(null, prompt, { persona: 'ben', target: 'prompt.md', title: 'Name the test command', content: '', edits: [{ old: 'Run the tests.', new: 'Run `npm test`.' }], evidence: 'the journal head', at: '2026-11-14T10:05:00.000Z' });
    expect(written.ok).toBe(true);
    const file = parseImprovements(written.ok ? written.text : '');
    expect(file.proposals).toEqual([expect.objectContaining({ id: written.ok ? written.id : '', state: 'open', target: 'prompt.md', content: '# Ben\n\nRun `npm test`.', evidence: ['the journal head'] })]);
  });

  it('a model proposal keeps its id; edits that do not apply or a missing prompt refuse', () => {
    expect(withRoundProposal(null, null, { persona: 'ben', target: 'models.default', title: 'Stronger', content: 'opus', evidence: 'e', at: '2026-11-14T10:05:00Z' }).ok).toBe(true);
    expect(withRoundProposal(null, prompt, { persona: 'ben', target: 'prompt.md', title: 't', content: '', edits: [{ old: 'absent', new: 'x' }], evidence: 'e', at: 'x' })).toMatchObject({ ok: false });
    expect(withRoundProposal(null, null, { persona: 'ben', target: 'prompt.md', title: 't', content: '', edits: [{ old: 'a', new: 'b' }], evidence: 'e', at: 'x' })).toEqual({ ok: false, error: 'the persona has no prompt.md to edit' });
  });
});
