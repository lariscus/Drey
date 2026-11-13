/**
 * A capability class (req-287, ADR-0095 later change): a name from the
 * owner's class list in Settings → Models — shipped as `super heavy` ·
 * `heavy` · `standard` · `light`, strongest first. The list lives in the
 * machine's `service.json` (`classes`); a ticket's `class:`, a persona's
 * `min-class:` and a phase's `min-class:` name one of its classes. The old
 * letters are read as their names — A is heavy, B standard, C light — and
 * never written again.
 */

/** A class's name, lower case, as the owner keeps it (`super heavy`). */
export type ClassName = string;

/** The list a machine without a `classes` key runs with, strongest first. */
export const DEFAULT_CLASS_NAMES: readonly ClassName[] = ['super heavy', 'heavy', 'standard', 'light'];

/** The letters of req-170 as the names they became (req-287). */
export const LEGACY_CLASS_NAMES: Readonly<Record<'A' | 'B' | 'C', ClassName>> = { A: 'heavy', B: 'standard', C: 'light' };

const NAME = /^[a-z][a-z0-9-]*(?: [a-z0-9-]+)*$/;
const MAX_NAME = 24;

/** A raw value as a class name: trimmed, single spaces, lower case, a letter A/B/C as its name; null when it is no name. */
export function classNameOf(raw: unknown): ClassName | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed === 'A' || trimmed === 'B' || trimmed === 'C') {
    return LEGACY_CLASS_NAMES[trimmed];
  }
  const name = trimmed.replace(/\s+/g, ' ').toLowerCase();
  return name.length <= MAX_NAME && NAME.test(name) ? name : null;
}

/** A plan part's size (S/M/L) as the class it asks for: S → light, M → standard, L → heavy. */
export const SIZE_CLASS_NAMES: Readonly<Record<'S' | 'M' | 'L', ClassName>> = { S: 'light', M: 'standard', L: 'heavy' };
