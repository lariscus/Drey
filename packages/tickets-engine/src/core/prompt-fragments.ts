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
  /** E10-5b: what the plan format adds while the board proposes a flow for every plan (`flow-proposal.md`). */
  readonly flowProposal: string;
}

/** The placeholder each fragment replaces. */
export const FRAGMENT_PLACEHOLDERS: Readonly<Record<keyof PromptFragments, string>> = {
  planFormat: '{{plan-format}}',
  chainGrammar: '{{chain-grammar}}',
  flowProposal: '{{flow-proposal}}',
};

/** What a prompt's expansion depends on besides the fragments. */
export interface FragmentOptions {
  /** The board's `propose-flow:` switch (E10-5b): on, the plan format closes with the flow proposal; `{{flow-proposal}}` places it by hand. */
  readonly proposeFlow?: boolean;
}

/** A prompt text with every fragment placeholder replaced; null stays null. */
export function expandFragments<T extends string | null>(text: T, fragments: PromptFragments, options: FragmentOptions = {}): T {
  if (text === null) {
    return text;
  }
  let out: string = text;
  for (const key of Object.keys(FRAGMENT_PLACEHOLDERS) as (keyof PromptFragments)[]) {
    const proposal = options.proposeFlow === true ? fragments.flowProposal : '';
    const replacement = key === 'flowProposal' ? proposal : key === 'planFormat' && proposal !== '' ? `${fragments.planFormat}\n\n${proposal}` : fragments[key];
    out = out.replaceAll(FRAGMENT_PLACEHOLDERS[key], replacement);
  }
  return out as T;
}
