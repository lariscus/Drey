/**
 * The shared prompt fragments' pure half (req-280, T2): the placeholders and
 * their expansion — no file system, so the run composer and anything a
 * plugin renderer bundles (`fleet/instruction.ts` via `fleet/assignment.ts`)
 * can import it. Reading the fragment files is `core/prompt-file.ts`.
 */

/** The shared fragments a prompt pulls in by placeholder. */
export interface PromptFragments {
  readonly planFormat: string;
  readonly chainGrammar: string;
}

/** The placeholder each fragment replaces. */
export const FRAGMENT_PLACEHOLDERS: Readonly<Record<keyof PromptFragments, string>> = {
  planFormat: '{{plan-format}}',
  chainGrammar: '{{chain-grammar}}',
};

/** A prompt text with every fragment placeholder replaced; null stays null. */
export function expandFragments<T extends string | null>(text: T, fragments: PromptFragments): T {
  if (text === null) {
    return text;
  }
  let out: string = text;
  for (const key of Object.keys(FRAGMENT_PLACEHOLDERS) as (keyof PromptFragments)[]) {
    out = out.replaceAll(FRAGMENT_PLACEHOLDERS[key], fragments[key]);
  }
  return out as T;
}
