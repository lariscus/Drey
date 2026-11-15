import { MAX_IMPROVEMENT_CONTENT, nextImprovementId, parseImprovements, renderImprovements } from '../persona/improvements';
import { applyPromptEdits, type PromptEdit } from '../config/prompt-edits';

/** A closing round's proposal as the writers take it (R11, req-169). */
export interface RoundProposalInput {
  readonly persona: string;
  readonly target: 'prompt.md' | 'models.default';
  readonly title: string;
  readonly content: string;
  readonly edits?: readonly PromptEdit[];
  readonly evidence: string;
  /** ISO stamp of the proposal. */
  readonly at: string;
}

export type RoundProposalText = { readonly ok: true; readonly id: string; readonly text: string } | { readonly ok: false; readonly error: string };

/** The stored text of a proposal: the model id, or prompt.md with the edits applied (req-280). */
function contentOf(input: RoundProposalInput, currentPrompt: string | null): { ok: true; content: string } | { ok: false; error: string } {
  if (input.target !== 'prompt.md') {
    return { ok: true, content: input.content };
  }
  if (currentPrompt === null || currentPrompt.trim() === '' || input.edits === undefined) {
    return { ok: false, error: 'the persona has no prompt.md to edit' };
  }
  const applied = applyPromptEdits(currentPrompt, input.edits);
  if (!applied.ok) {
    return { ok: false, error: applied.error };
  }
  if (applied.text.length > MAX_IMPROVEMENT_CONTENT) {
    return { ok: false, error: `the edited prompt.md exceeds ${MAX_IMPROVEMENT_CONTENT} characters` };
  }
  return { ok: true, content: applied.text };
}

/**
 * `improvements.md` with one more OPEN proposal (R11, req-169): the round
 * proposes, it never adopts. A prompt.md proposal stores the persona's
 * current prompt with the edits applied; edits that do not apply refuse
 * (nothing is written). Pure — both writers (the engine's and the runner's
 * standalone fallback) read the two files and write the text back.
 */
export function withRoundProposal(existingImprovements: string | null, currentPrompt: string | null, input: RoundProposalInput): RoundProposalText {
  const content = contentOf(input, currentPrompt);
  if (!content.ok) {
    return content;
  }
  const existing = existingImprovements ?? '';
  const file = parseImprovements(existing);
  const id = nextImprovementId(existing);
  const proposals = [
    ...file.proposals,
    { id, state: 'open' as const, target: input.target, title: input.title, evidence: [input.evidence], content: content.content, lesson: null, at: input.at, decidedAt: null },
  ];
  return { ok: true, id, text: renderImprovements(input.persona, { lastAggregation: file.lastAggregation, proposals }) };
}
