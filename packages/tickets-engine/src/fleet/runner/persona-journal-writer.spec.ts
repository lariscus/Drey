import { describe, expect, it } from 'vitest';
import type { JournalEntry } from '../../core/persona/persona-journal';
import { parseJournal } from '../../core/persona/persona-journal-file';
import { MemoryFileSystem } from '../ports/memory-file-system.fake';
import { PersonaJournalWriter } from './persona-journal-writer';

const ENTRY: JournalEntry = {
  at: '2026-11-09T12:00:00Z',
  ticket: 'T-0102',
  persona: 'ben',
  harness: 'claude-code',
  model: 'sonnet',
  gate: 'red',
  costUsd: 0.5,
  signals: ['red-gate'],
  friction: null,
  finding: null,
  note: null,
};

describe('PersonaJournalWriter (req-169)', () => {
  it("appends to the persona's reviews.md, creating it with its header", async () => {
    const fs = new MemoryFileSystem();
    const writer = new PersonaJournalWriter(fs, () => undefined);
    expect(await writer.append('V:/vault', ENTRY)).toBe(true);
    expect(await writer.append('V:/vault', { ...ENTRY, at: '2026-11-10T12:00:00Z' })).toBe(true);
    const text = fs.files.get('V:/vault/tickets/_meta/personas/ben/reviews.md') as string;
    expect(text.startsWith('# Reviews\n')).toBe(true);
    expect(parseJournal(text)).toHaveLength(2);
  });

  it('a failure is a log line', async () => {
    const logs: string[] = [];
    const fs = Object.assign(new MemoryFileSystem(), {
      readTextOrNull: async (): Promise<string | null> => {
        throw new Error('locked');
      },
    });
    expect(await new PersonaJournalWriter(fs, (m) => logs.push(m)).append('V:/vault', ENTRY)).toBe(false);
    expect(logs).toEqual(['persona ben: journal append failed — locked']);
  });
});
