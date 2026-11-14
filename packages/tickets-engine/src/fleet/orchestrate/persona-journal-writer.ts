import { PERSONAS_DIR } from '../../core/persona';
import { JOURNAL_FILE, type JournalEntry } from '../../core/persona-journal';
import { withJournalEntries, withRoundEntry } from '../../core/persona-journal-file';
import type { FileSystem } from '../ports/file-system';
import { messageOf } from './live-run';

/**
 * The runner's half of the persona journal (R14, req-169): one entry per
 * noteworthy run appended to `tickets/_meta/personas/<persona>/reviews.md`.
 * The same plain write the memory lesson takes; a failure is a log line,
 * never a thrown error. Given the run's start, a `journal_write` entry of the
 * run (req-226) takes the round's entry in its place.
 */
export class PersonaJournalWriter {
  constructor(
    private readonly fs: FileSystem,
    private readonly log: (message: string) => void,
  ) {}

  async append(vaultPath: string, entry: JournalEntry, runStartedAt?: string): Promise<boolean> {
    try {
      const abs = this.fs.join(vaultPath, PERSONAS_DIR, entry.persona, JOURNAL_FILE);
      const existing = await this.fs.readTextOrNull(abs);
      await this.fs.mkdirp(this.fs.dirname(abs));
      await this.fs.writeText(abs, runStartedAt === undefined ? withJournalEntries(existing, [entry]) : withRoundEntry(existing, entry, runStartedAt));
      return true;
    } catch (error) {
      this.log(`persona ${entry.persona}: journal append failed — ${messageOf(error)}`);
      return false;
    }
  }
}
