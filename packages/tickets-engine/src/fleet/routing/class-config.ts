/**
 * The `classes` of `service.json` (req-287, board 7l v3; machine scope,
 * R13): the owner's class list, strongest first, each with at most N of
 * its sessions at once. A machine without the key runs the shipped list
 * (super heavy · heavy · standard · light) with no class cap. An entry is
 * a name (`"heavy"`) or `{ name, sessions }`; a broken one is left out
 * with its reason, a name given twice counts once.
 */
import { classNameOf, DEFAULT_CLASS_NAMES, type ClassConfig } from '../protocol';

export const DEFAULT_CLASSES: readonly ClassConfig[] = DEFAULT_CLASS_NAMES.map((name) => ({ name, sessions: null }));

type Entry = Record<string, unknown>;

function sessionsOf(raw: unknown, name: string, errors: string[]): number | null {
  if (raw === undefined || raw === null) {
    return null;
  }
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0) {
    return raw;
  }
  errors.push(`class "${name}": sessions must be a whole number of 0 or more`);
  return null;
}

function classOf(raw: unknown, errors: string[]): ClassConfig | null {
  const entry = (typeof raw === 'string' ? { name: raw } : raw !== null && typeof raw === 'object' ? raw : {}) as Entry;
  const name = classNameOf(entry['name']);
  if (name === null) {
    errors.push(`a class needs a name of letters, digits, spaces or '-' (got ${JSON.stringify(entry['name'] ?? null)})`);
    return null;
  }
  return { name, sessions: sessionsOf(entry['sessions'], name, errors) };
}

/** The class list as parsed; the shipped one when the key is absent or holds no class. */
export function classesOf(raw: unknown, errors: string[]): readonly ClassConfig[] {
  if (!Array.isArray(raw)) {
    return DEFAULT_CLASSES;
  }
  const classes: ClassConfig[] = [];
  for (const item of raw as unknown[]) {
    const parsed = classOf(item, errors);
    if (parsed !== null && !classes.some((c) => c.name === parsed.name)) {
      classes.push(parsed);
    }
  }
  return classes.length === 0 ? DEFAULT_CLASSES : classes;
}

/** The list as `service.json` stores it. */
export function classKeysOf(classes: readonly ClassConfig[]): readonly Entry[] {
  return classes.map((c) => (c.sessions === null ? { name: c.name } : { name: c.name, sessions: c.sessions }));
}

/**
 * The ranking of a class list (req-287, R10): 0 is the strongest. A class
 * the list does not hold ranks below every listed one — it is never taken
 * for a stronger class than one the owner keeps.
 */
export class ClassOrder {
  private readonly names: readonly string[];

  constructor(classes: readonly ClassConfig[]) {
    this.names = classes.map((c) => c.name);
  }

  rank(name: string): number {
    const at = this.names.indexOf(name);
    return at < 0 ? this.names.length : at;
  }

  /** The stronger of two classes. */
  stronger(a: string, b: string): string {
    return this.rank(a) <= this.rank(b) ? a : b;
  }

  /** The lightest class of the set that is stronger than `than`; null when none is. */
  lightestAbove(held: Iterable<string>, than: string): string | null {
    return [...held].filter((c) => this.rank(c) < this.rank(than)).sort((a, b) => this.rank(b) - this.rank(a))[0] ?? null;
  }

  has(name: string): boolean {
    return this.names.includes(name);
  }
}
