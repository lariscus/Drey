/**
 * The follow-up proposals a worker ends its last message with (owner
 * request 2026-11-14, outside the list): work it found that is not part of
 * the step. The grammar mirrors `QUESTION:` / `BLOCKED:` — a line-start
 * marker, then one bullet per proposal with indented detail lines:
 *
 *     FOLLOWUPS:
 *     - Cache the heading tree per note
 *       why: the outline rebuilds it on every keystroke (src/app/outline.ts)
 *       priority: low
 *
 * The worker writes nothing to the board. The runner keeps what this
 * parser reads in `run.json`; the engine then files one pending Pia card
 * per proposal, and only the owner's confirm creates a ticket. The parser
 * is tolerant (an unreadable line is skipped, never a guess) and bounded:
 * a worker cannot flood the owner's inbox.
 */

export const FOLLOWUPS_MARKER = 'FOLLOWUPS:';

/** The most proposals one run may file; the rest is dropped. */
export const MAX_FOLLOWUPS = 5;

const TITLE_CAP = 120;
const WHY_CAP = 600;

/** One proposed ticket as the worker wrote it. */
export interface FollowupDraft {
  readonly title: string;
  /** Why the work is worth a ticket; may be empty. */
  readonly why: string;
  /** A priority word the worker named, lowercased; checked against the board's vocabulary when filed. */
  readonly priority: string | null;
}

const BULLET = /^\s*(?:[-*]|\d+[.)])\s+(\S.*?)\s*$/;
const FIELD = /^\s+(why|reason|priority)\s*:\s*(.*?)\s*$/i;

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function cut(value: string, cap: number): string {
  return value.length <= cap ? value : `${value.slice(0, cap - 1).trimEnd()}…`;
}

/**
 * The proposals of the text's LAST line-start `FOLLOWUPS:` marker, in
 * order, at most {@link MAX_FOLLOWUPS}, titles distinct. Reading stops at
 * the first unindented line that is no bullet (closing prose). A marker in
 * running prose does not count; `FOLLOWUPS: none` reads as no proposals.
 */
export function parseFollowups(text: string): readonly FollowupDraft[] {
  const lines = text.split('\n');
  let at = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i]!.trimStart().toUpperCase().startsWith(FOLLOWUPS_MARKER)) {
      at = i;
    }
  }
  if (at === -1) {
    return [];
  }

  const drafts: { title: string; why: string; priority: string | null }[] = [];
  for (const line of lines.slice(at + 1)) {
    if (line.trim() === '') {
      continue;
    }
    const current = drafts[drafts.length - 1];
    const field = current === undefined ? null : FIELD.exec(line);
    if (current !== undefined && field !== null) {
      const value = oneLine(field[2]!);
      if (field[1]!.toLowerCase() === 'priority') {
        current.priority = value === '' ? null : value.toLowerCase();
      } else {
        current.why = value;
      }
      continue;
    }
    const bullet = BULLET.exec(line);
    if (bullet !== null) {
      drafts.push({ title: cut(oneLine(bullet[1]!), TITLE_CAP), why: '', priority: null });
      continue;
    }
    if (current !== undefined && /^\s/.test(line)) {
      // A wrapped detail line continues the reason.
      current.why = oneLine(`${current.why} ${line}`);
      continue;
    }
    if (current !== undefined) {
      break; // closing prose after the list
    }
  }

  const seen = new Set<string>();
  const out: FollowupDraft[] = [];
  for (const draft of drafts) {
    const key = draft.title.toLowerCase();
    if (draft.title === '' || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push({ title: draft.title, why: cut(draft.why, WHY_CAP), priority: draft.priority });
    if (out.length === MAX_FOLLOWUPS) {
      break;
    }
  }
  return out;
}
