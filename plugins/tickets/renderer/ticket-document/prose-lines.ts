/**
 * The ticket document's prose, the pure half (boards 9a, 7a v2): which line
 * breaks of the file are soft — a paragraph wrapped in the file reads as one
 * paragraph on the page — and where the Log's quoted timestamps stand, so the
 * page can show them as a time. Offsets index the text; nothing here knows
 * CodeMirror.
 */
import { fencedLineFlags } from '../../../../shared/markdown/fences';

export interface TextSpan {
  readonly from: number;
  readonly to: number;
}

/** One paragraph whose lines the file wraps: its extent and the line breaks inside it. */
export interface WrappedParagraph extends TextSpan {
  /** Each break runs from the end of a line's text (its `\r` included) to the first non-blank of the next. */
  readonly breaks: readonly TextSpan[];
}

/** A line that starts a block of its own: it never continues the paragraph above. */
const BLOCK_START = /^ {0,3}(?:#{1,6}(?:\s|$)|[-*+][ \t]|\d{1,9}[.)][ \t]|>|\||<|`{3}|~{3}|(?:[-*_][ \t]*){3,}$)/;
/** A line after which nothing joins: a heading, a table row, a rule, a block of HTML. */
const BLOCK_ONLY = /^ {0,3}(?:#{1,6}(?:\s|$)|\||<|(?:[-*_][ \t]*){3,}$)/;
/** Two trailing spaces or a backslash: Markdown's own hard break. */
const HARD_BREAK = /(?: {2,}|\\)$/;

/**
 * The paragraphs of `text` (from `start` on) that the file wraps over more
 * than one line. A line joins the one above when both carry prose: neither
 * blank nor fenced, the upper one no heading, table row or hard break, the
 * lower one starting no block of its own (heading, list item, quote, table,
 * fence, rule, HTML) and not indented as code.
 */
export function wrappedParagraphsOf(text: string, start = 0): WrappedParagraph[] {
  const lines = text.split('\n');
  const fenced = fencedLineFlags(lines);
  const out: WrappedParagraph[] = [];
  let open: { from: number; to: number; breaks: TextSpan[] } | null = null;
  let offset = 0;
  for (const [index, raw] of lines.entries()) {
    const from = offset;
    offset += raw.length + 1;
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const next = lines[index + 1];
    const nextLine = next === undefined ? '' : next.endsWith('\r') ? next.slice(0, -1) : next;
    const joins =
      from >= start &&
      next !== undefined &&
      !fenced[index] &&
      !fenced[index + 1] &&
      line.trim() !== '' &&
      nextLine.trim() !== '' &&
      !BLOCK_ONLY.test(line) &&
      !HARD_BREAK.test(line) &&
      !BLOCK_START.test(nextLine) &&
      !/^(?: {4}|\t)/.test(nextLine);
    if (!joins) {
      if (open !== null) {
        open.to = from + line.length;
        out.push(open);
        open = null;
      }
      continue;
    }
    const lead = nextLine.length - nextLine.trimStart().length;
    open ??= { from, to: from, breaks: [] };
    open.breaks.push({ from: from + line.length, to: offset + lead });
  }
  return out;
}

/** One Log entry's timestamp: the span of the stamp as written (its quotes included) and the instant. */
export interface LogStamp extends TextSpan {
  readonly at: Date;
}

const LOG_STAMP = /^([ \t]*-[ \t]+)('?)(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)\2(?=\s|$)/;

/** The timestamps that open the Log's entries (`- '2026-10-18T11:12:12Z' agent@legion — …`) inside `range`. */
export function logStampsOf(text: string, range: TextSpan): LogStamp[] {
  const out: LogStamp[] = [];
  let offset = range.from;
  const body = text.slice(range.from, range.to);
  for (const raw of body.split('\n')) {
    const match = LOG_STAMP.exec(raw);
    if (match !== null) {
      const at = new Date(match[3]!);
      if (!Number.isNaN(at.getTime())) {
        const from = offset + match[1]!.length;
        out.push({ from, to: from + match[2]!.length * 2 + match[3]!.length, at });
      }
    }
    offset += raw.length + 1;
  }
  return out;
}
