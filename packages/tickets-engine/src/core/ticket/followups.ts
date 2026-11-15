/**
 * The follow-up proposals a worker ends its last message with (req-299):
 * work it found that is not part of the step. The grammar mirrors
 * `QUESTION:` / `BLOCKED:` — a line-start marker, then one bullet per
 * proposal with indented detail lines:
 *
 *     FOLLOWUPS:
 *     - Cache the heading tree per note
 *       why: the outline rebuilds it on every keystroke (src/app/outline.ts)
 *       priority: low
 *
 * The worker writes nothing to the board. The runner keeps what this
 * parser reads on the run's record (`RunInfo.followups`); once the run is
 * done the engine files one pending Mission Control card per proposal, and
 * only the owner's confirm creates a ticket. The parser is tolerant (an
 * unreadable line is skipped, never a guess) and bounded: a worker cannot
 * flood the owner's inbox.
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

interface MutableDraft {
  title: string;
  why: string;
  priority: string | null;
}

const BULLET = /^\s*(?:[-*]|\d+[.)])\s+(\S.*?)\s*$/;
const FIELD = /^\s+(why|reason|priority)\s*:\s*(.*?)\s*$/i;

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function cut(value: string, cap: number): string {
  return value.length <= cap ? value : `${value.slice(0, cap - 1).trimEnd()}…`;
}

/** The index of the LAST line that starts with the marker, or -1. */
function markerLine(lines: readonly string[]): number {
  let at = -1;
  lines.forEach((line, i) => {
    if (line.trimStart().toUpperCase().startsWith(FOLLOWUPS_MARKER)) {
      at = i;
    }
  });
  return at;
}

/** Applies one `why:` / `priority:` line to its bullet. */
function applyField(draft: MutableDraft, key: string, raw: string): void {
  const value = oneLine(raw);
  if (key.toLowerCase() === 'priority') {
    draft.priority = value === '' ? null : value.toLowerCase();
  } else {
    draft.why = value;
  }
}

/** The bullets below the marker line, in order; reading ends at the first unindented line that is no bullet (closing prose). */
function bulletsBelow(lines: readonly string[]): MutableDraft[] {
  const drafts: MutableDraft[] = [];
  for (const line of lines) {
    if (line.trim() === '') {
      continue;
    }
    const current = drafts[drafts.length - 1];
    const field = current === undefined ? null : FIELD.exec(line);
    if (current !== undefined && field !== null) {
      applyField(current, field[1]!, field[2]!);
      continue;
    }
    const bullet = BULLET.exec(line);
    if (bullet !== null) {
      drafts.push({ title: cut(oneLine(bullet[1]!), TITLE_CAP), why: '', priority: null });
      continue;
    }
    if (current === undefined || !/^\s/.test(line)) {
      break;
    }
    current.why = oneLine(`${current.why} ${line}`); // a wrapped detail line continues the reason
  }
  return drafts;
}

/**
 * The proposals of the text's LAST line-start `FOLLOWUPS:` marker, in
 * order, at most {@link MAX_FOLLOWUPS}, titles distinct (case-insensitively).
 * A marker in running prose does not count; text on the marker's own line
 * (`FOLLOWUPS: none`) reads as no proposals.
 */
export function parseFollowups(text: string): readonly FollowupDraft[] {
  const lines = text.split('\n');
  const at = markerLine(lines);
  if (at === -1 || lines[at]!.trimStart().slice(FOLLOWUPS_MARKER.length).trim() !== '') {
    return [];
  }
  const seen = new Set<string>();
  const out: FollowupDraft[] = [];
  for (const draft of bulletsBelow(lines.slice(at + 1))) {
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
