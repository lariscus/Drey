/**
 * The persona memory's line form (R4/R14, req-169): every lesson carries its
 * author and its evidence.
 *
 *     - 2026-11-09 · T-0102 · ben/sonnet · run the repo's own test script, not vitest directly
 *     - 2026-11-09 · you · never touch the generated client
 *
 * A persona's lesson names the ticket it came from and `<persona>/<model>`;
 * the owner's line says `you`. Lines written before req-169 (the old
 * per-run outcome lines, hand-written lessons) stay readable as they are:
 * their author reads as unknown, nothing is rewritten. The pin marker and
 * the file's cap are the persona store's (`services/persona-store.ts`).
 */

export type MemoryAuthor =
  | { readonly kind: 'owner' }
  | { readonly kind: 'persona'; readonly persona: string; readonly model: string }
  | { readonly kind: 'unknown' };

export interface MemoryLine {
  readonly date: string | null;
  readonly ticket: string | null;
  readonly author: MemoryAuthor;
  /** The lesson itself — the line without its evidence. */
  readonly lesson: string;
}

/** The pin marker a pinned entry carries at its line's end (U4). */
export const MEMORY_PIN_MARKER = ' [pinned]';
/** A lesson is one line, bounded. */
export const MEMORY_LESSON_MAX = 300;

const OWNER = /^(\d{4}-\d{2}-\d{2}) · you · (.+)$/;
const PERSONA = /^(\d{4}-\d{2}-\d{2}) · (T-\d{4,}|—) · ([a-z0-9][a-z0-9-]{0,63})\/(\S+) · (.+)$/;
const DATED = /^(\d{4}-\d{2}-\d{2}) · (?:(T-\d{4,}) · )?(.+)$/;

/** One entry's text (bullet and pin marker already stripped) read into its parts. */
export function parseMemoryLine(text: string): MemoryLine {
  const owner = OWNER.exec(text);
  if (owner !== null) {
    return { date: owner[1]!, ticket: null, author: { kind: 'owner' }, lesson: owner[2]!.trim() };
  }
  const persona = PERSONA.exec(text);
  if (persona !== null) {
    return {
      date: persona[1]!,
      ticket: persona[2] === '—' ? null : persona[2]!,
      author: { kind: 'persona', persona: persona[3]!, model: persona[4]! },
      lesson: persona[5]!.trim(),
    };
  }
  const dated = DATED.exec(text);
  if (dated !== null) {
    return { date: dated[1]!, ticket: dated[2] ?? null, author: { kind: 'unknown' }, lesson: dated[3]!.trim() };
  }
  return { date: null, ticket: null, author: { kind: 'unknown' }, lesson: text.trim() };
}

function flat(text: string): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length <= MEMORY_LESSON_MAX ? one : `${one.slice(0, MEMORY_LESSON_MAX - 1).trimEnd()}…`;
}

/** A persona's lesson as its stored line. */
export function personaLessonLine(input: { readonly date: string; readonly ticket: string | null; readonly persona: string; readonly model: string; readonly lesson: string }): string {
  return `- ${input.date} · ${input.ticket ?? '—'} · ${input.persona}/${input.model.replace(/\s+/g, '-')} · ${flat(input.lesson)}`;
}

/** The owner's lesson as its stored line; a text that already names its author keeps it. */
export function ownerLessonLine(date: string, lesson: string): string {
  const text = flat(lesson.startsWith('- ') ? lesson.slice(2) : lesson);
  return parseMemoryLine(text).author.kind !== 'unknown' ? `- ${text}` : `- ${date} · you · ${text}`;
}

/** One memory entry: the line's text without bullet and pin marker, and whether it is pinned. */
export interface MemoryEntryText {
  readonly text: string;
  readonly pinned: boolean;
}

/** The memory file's entries in file order (oldest first): below a `#` header, no blanks. */
export function memoryEntriesOf(fileText: string): readonly MemoryEntryText[] {
  if (fileText.trim() === '') {
    return [];
  }
  const lines = fileText.replace(/\r\n/g, '\n').split('\n');
  const hasHeader = (lines[0] ?? '').startsWith('#');
  return (hasHeader ? lines.slice(1) : lines)
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const pinned = line.trimEnd().endsWith(MEMORY_PIN_MARKER);
      const bare = (pinned ? line.trimEnd().slice(0, -MEMORY_PIN_MARKER.length) : line).trim();
      return { text: bare.startsWith('- ') ? bare.slice(2).trim() : bare, pinned };
    });
}
