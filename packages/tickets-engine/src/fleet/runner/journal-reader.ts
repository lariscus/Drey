import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import { PERSONAS_DIR } from '../../core/persona/persona';
import { JOURNAL_FILE, type JournalEntry } from '../../core/persona/persona-journal';
import { parseJournal } from '../../core/persona/persona-journal-file';

/**
 * Every persona journal of the tickets vaults the runner's records name
 * (req-169) — the report's input. The same plain-fs vault read the context
 * pack uses; an unreadable folder or file reads as no entries.
 */
export class JournalReader {
  async entriesOf(vaultPaths: readonly string[]): Promise<readonly JournalEntry[]> {
    const entries: JournalEntry[] = [];
    for (const vault of new Set(vaultPaths)) {
      const root = path.join(vault, PERSONAS_DIR);
      const personas = await fsp.readdir(root).catch(() => [] as string[]);
      for (const persona of personas.filter((name) => /^[a-z0-9][a-z0-9-]{0,63}$/.test(name))) {
        const text = await fsp.readFile(path.join(root, persona, JOURNAL_FILE), 'utf8').catch(() => null);
        if (text !== null) {
          entries.push(...parseJournal(text));
        }
      }
    }
    return entries;
  }
}
