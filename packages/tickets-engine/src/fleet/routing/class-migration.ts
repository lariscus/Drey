import { classNameOf, DEFAULT_CLASS_NAMES } from '../protocol';
import type { MigrationConfigFile } from './pool-migration';

/** The marker `service.json` keeps once the classes of req-287 replaced A · B · C. */
export const CLASS_LIST_MIGRATION = 'classes.v3';

type Entry = Record<string, unknown>;

const entriesOf = (raw: unknown): readonly Entry[] => (Array.isArray(raw) ? (raw as unknown[]).map((item) => (item !== null && typeof item === 'object' ? (item as Entry) : {})) : []);

/** The sessions the old rows of a class served in all; null when none named any. */
function sessionsOfClass(rows: readonly Entry[], name: string): number | null {
  const counts = rows.filter((row) => classNameOf(row['class']) === name).map((row) => row['sessions']);
  const numbers = counts.filter((value): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0);
  return numbers.length === 0 ? null : numbers.reduce((sum, value) => sum + value, 0);
}

/**
 * `service.json`'s root after the move of req-287: every model row's letter
 * becomes its name (A heavy, B standard, C light) and loses its `sessions`;
 * the class list is written out — the shipped four, each class capped at
 * the sessions its old rows served together (the slots at class level).
 * An existing `classes` key is kept as the owner wrote it.
 */
export function classesMigrated(root: Readonly<Entry>): Entry {
  const rows = entriesOf(root['models']);
  const models = rows.map((row) => {
    const { sessions: _moved, ...rest } = row;
    const name = classNameOf(row['class']);
    return name === null ? rest : { ...rest, class: name };
  });
  const classes = Array.isArray(root['classes'])
    ? root['classes']
    : DEFAULT_CLASS_NAMES.map((name) => {
        const sessions = sessionsOfClass(rows, name);
        return sessions === null ? { name } : { name, sessions };
      });
  return { ...root, classes, ...(Array.isArray(root['models']) ? { models } : {}) };
}

/**
 * The one-time move of the class letters into the owner's list (req-287):
 * written once, marked, never again — a file that does not parse is left
 * alone and asked again at the next start.
 */
export class ClassMigration {
  constructor(
    private readonly file: MigrationConfigFile,
    private readonly log: (message: string) => void,
  ) {}

  /** True when it wrote the file (the caller reloads). */
  async run(): Promise<boolean> {
    const { root, error } = await this.file.read();
    const done = Array.isArray(root['migrations']) && (root['migrations'] as unknown[]).includes(CLASS_LIST_MIGRATION);
    if (error !== null || done) {
      return false;
    }
    const written = await this.file.update((current) => ({
      ...classesMigrated(current),
      migrations: [...(Array.isArray(current['migrations']) ? (current['migrations'] as unknown[]) : []), CLASS_LIST_MIGRATION],
    }));
    if (written.ok) {
      this.log('service.json: the classes A · B · C became heavy · standard · light, super heavy joined above them; the model rows’ sessions are their class’s cap now');
    }
    return written.ok;
  }
}
