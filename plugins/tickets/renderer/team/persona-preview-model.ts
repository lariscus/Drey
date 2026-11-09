// i18n: catalog
/**
 * The Instructions block's start-of-run figure and the preview's parts, pure
 * half (R11, req-238). The engine counts the brief a run would start with
 * from the files on disk (`personaPromptPreview`); the editor holds text
 * that may not be saved. The page's figure is the engine's total with the
 * instructions' share swapped for the draft's, counted by the same family
 * rule (`core/token-count.ts`), so it follows every keystroke and is still
 * an estimate (`≈`). DOM-free.
 */
import { estimateTokens } from '../../../../packages/tickets-engine/src/core/token-count';
import type { MessageKey } from '../../../../shared/i18n/types';
import type { PromptPreview } from './persona-seams';

/** The tokens of the brief at the start of a run, with `draftPrompt` as the persona's instructions. */
export function atStartTokensOf(preview: PromptPreview, draftPrompt: string): number {
  const saved = preview.parts.find((part) => part.name === 'instructions')?.tokens ?? 0;
  return Math.max(0, preview.tokens - saved + estimateTokens(draftPrompt.trim(), preview.tokenizer));
}

const PART_KEYS: Readonly<Record<string, MessageKey>> = {
  instructions: 'persona.preview.part.instructions',
  skills: 'persona.preview.part.skills',
  memory: 'persona.preview.part.memory',
  rest: 'persona.preview.part.rest',
};

/** One part of the brief as the preview draws it; a part the page has no word for shows the engine's own name. */
export interface PartLine {
  readonly name: string;
  readonly key: MessageKey | null;
  readonly tokens: number;
}

export function partLinesOf(preview: PromptPreview): readonly PartLine[] {
  return preview.parts.map((part) => ({ name: part.name, key: PART_KEYS[part.name] ?? null, tokens: part.tokens }));
}

/** What the request names: the persona's first step (the engine's default when it has none) and its strongest model. */
export function previewRequestOf(phases: readonly string[] | undefined, pool: readonly string[]): { readonly step?: string; readonly model?: string } {
  const step = phases?.[0];
  const model = pool[0];
  return { ...(step === undefined ? {} : { step }), ...(model === undefined ? {} : { model }) };
}
