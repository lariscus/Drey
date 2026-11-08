/**
 * The words every adapter writes into a run's stream (ADR-0075): the
 * activity line, the tool call's line, the lines an edit changes, the
 * markers a turn ends with (`QUESTION:`, `BLOCKED:`) and the lead-ins of
 * thinking and tool results.
 */
import { BLOCKED_MARKER, QUESTION_MARKER } from '../protocol';

/** The stream lead-in of a worker's thinking (the takeover transcript shows it quoted). */
export const THINK_PREFIX = 'thinking › ';

/** How much of one thought the stream keeps — whole, short of a runaway (req-54). */
export const THINK_MAX = 8_000;

/** A tool's outcome rides the stream as a note with this lead-in (the `⎿` line under its call). */
export const RESULT_PREFIX = 'result › ';

/** Collapses a text to the one-line activity the board shows. */
export function activityLine(text: string): string {
  const first = text.split('\n').find((line) => line.trim() !== '') ?? '';
  const flat = first.replace(/\s+/g, ' ').trim();
  return flat.length > 140 ? `${flat.slice(0, 139)}…` : flat;
}

/** The input keys that name what a tool call works on, in the order they win. */
const TARGET_KEYS = ['path', 'filePath', 'file_path', 'command', 'pattern'] as const;

/** One line for a tool call: `read src/a.ts`, `shell git status`, `grep prepareWorktree`. */
export function toolActivity(name: string | undefined, input: Readonly<Record<string, unknown>> | undefined): string {
  const questions = input?.['questions'];
  if (name === 'question' && Array.isArray(questions)) {
    // OpenCode's `question` tool: the line is what it asks, not a bare "question".
    const first = (questions[0] as { question?: unknown } | undefined)?.question;
    return activityLine(`asks ${typeof first === 'string' ? first : 'the owner'}`);
  }
  const target = TARGET_KEYS.map((key) => input?.[key]).find((value) => value !== undefined && value !== null) ?? '';
  return activityLine(`${name ?? 'tool'} ${typeof target === 'string' ? target : ''}`);
}

/** The lines in a text: none for an empty one. */
const lineCount = (text: unknown): number => (typeof text === 'string' && text !== '' ? text.split('\n').length : 0);

/**
 * The lines an edit-like tool call adds and removes, read off its input:
 * `Edit` (old/new string), `MultiEdit` (a list of them), `Write` (the whole
 * file counts as added). Null for every other tool and input shape.
 */
export function editChanges(name: string | undefined, input: Record<string, unknown> | undefined): { added: number; removed: number } | null {
  if (name === undefined || input === undefined) {
    return null;
  }
  switch (name.toLowerCase()) {
    case 'edit':
      return { added: lineCount(input['new_string']), removed: lineCount(input['old_string']) };
    case 'multiedit': {
      const edits = Array.isArray(input['edits']) ? (input['edits'] as Array<Record<string, unknown>>) : [];
      return edits.reduce<{ added: number; removed: number }>((sum, edit) => ({ added: sum.added + lineCount(edit['new_string']), removed: sum.removed + lineCount(edit['old_string']) }), { added: 0, removed: 0 });
    }
    case 'write':
      return { added: lineCount(input['content']), removed: 0 };
    default:
      return null;
  }
}

/**
 * The text from the LAST line-start occurrence of `marker` to the end of
 * the message, trimmed. A marker buried mid-message still counts; one in
 * running prose (`Done. QUESTION: none`) does not.
 */
function lastMarkerText(text: string, marker: string): string | null {
  const lines = text.split('\n');
  let at = -1;
  lines.forEach((line, i) => {
    if (line.trimStart().toUpperCase().startsWith(marker)) {
      at = i;
    }
  });
  if (at === -1) {
    return null;
  }
  const marked = `${lines[at]!.trimStart().slice(marker.length)}\n${lines.slice(at + 1).join('\n')}`.trim();
  return marked === '' ? null : marked;
}

/**
 * The question a turn's last message asks the owner (the LAST line-start
 * `QUESTION:`), or null. The W2 ASKING shape rides every brief and stays
 * the primary path; this is the fallback.
 */
export function questionOf(text: string): string | null {
  return lastMarkerText(text, QUESTION_MARKER);
}

/** Why the worker declared the step incomplete (`BLOCKED:`), parsed like `questionOf`. A question wins over it. */
export function blockedOf(text: string): string | null {
  return lastMarkerText(text, BLOCKED_MARKER);
}

/** One line for a permission request: what the tool wants to do, on what. */
export function permissionText(request: { readonly action?: string; readonly resources?: readonly string[]; readonly message?: string }): string {
  const what = [request.action ?? 'tool', ...(request.resources ?? [])].join(' ').trim();
  const message = request.message?.trim() ?? '';
  return message !== '' && message !== what ? `${what} — ${message}` : what;
}
