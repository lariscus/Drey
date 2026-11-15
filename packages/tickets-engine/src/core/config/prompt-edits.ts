/**
 * A persona prompt change as edits, not as a whole new text (req-280, T5):
 * the improvement aggregator and the closing round propose `prompt.md`
 * changes as exact replacements `{old, new}` against the current file, so
 * a proposal cannot silently drop what it never quoted. The engine applies
 * the edits when the proposal is written and stores the resulting text —
 * the owner's diff and the accept path read a whole text as before. Each
 * `old` must occur exactly once in the text as the earlier edits left it;
 * otherwise the whole proposal is refused.
 */

export interface PromptEdit {
  readonly old: string;
  readonly new: string;
}

/** The most edits one proposal may carry. */
export const MAX_PROMPT_EDITS = 10;

/** The edits of a raw proposal, or null when it carries none that are well-formed. */
export function parsePromptEdits(raw: unknown): readonly PromptEdit[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_PROMPT_EDITS) {
    return null;
  }
  const edits: PromptEdit[] = [];
  for (const entry of raw as unknown[]) {
    if (typeof entry !== 'object' || entry === null) {
      return null;
    }
    const obj = entry as Record<string, unknown>;
    if (typeof obj['old'] !== 'string' || typeof obj['new'] !== 'string' || obj['old'] === '' || obj['old'] === obj['new']) {
      return null;
    }
    edits.push({ old: obj['old'].replace(/\r\n/g, '\n'), new: obj['new'].replace(/\r\n/g, '\n') });
  }
  return edits;
}

export type PromptEditResult = { readonly ok: true; readonly text: string } | { readonly ok: false; readonly error: string };

/** How often `part` occurs in `text`, overlaps not counted. */
function occurrences(text: string, part: string): number {
  return text.split(part).length - 1;
}

/** Applies the edits in order; each `old` must match exactly once where it is applied. */
export function applyPromptEdits(text: string, edits: readonly PromptEdit[]): PromptEditResult {
  let out = text.replace(/\r\n/g, '\n');
  for (const [i, edit] of edits.entries()) {
    const found = occurrences(out, edit.old);
    if (found !== 1) {
      return { ok: false, error: `edit ${i + 1}: its old text occurs ${found} times in prompt.md, it must occur exactly once` };
    }
    out = out.replace(edit.old, () => edit.new);
  }
  return { ok: true, text: out };
}
