/**
 * One reader for the prompt files beside the pipeline prompts (req-279,
 * req-280): the run-brief disciplines (`prompts/disciplines/`), the crew
 * chat prompts (`prompts/crew/`) and the shared fragments
 * (`prompts/fragments/`). CRLF folds, the `drey-prompt-version` marker line
 * goes (the marker is for the drift check, never for the model), exactly
 * the one trailing newline the files carry is dropped. A missing or empty
 * file throws, naming the file — a brief without its discipline would run
 * blind.
 *
 * The fragments (req-280, T2) are the texts several prompts share — the
 * plan format and the chain grammar — written once and pulled into a
 * prompt by its placeholder (`{{plan-format}}`, `{{chain-grammar}}`).
 */
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { SHIPPED_PROMPTS_DIR, stripPromptVersion } from './default-prompts';
import { expandFragments, FRAGMENT_PLACEHOLDERS, type PromptFragments } from './prompt-fragments';

export { expandFragments, FRAGMENT_PLACEHOLDERS, type PromptFragments };

/** Reads one prompt file below `dir`; `what` names the family in the error ("discipline", "crew prompt", "fragment"). */
export async function readPromptFile(dir: string, rel: string, what: string): Promise<string> {
  const text = await fsp.readFile(path.join(dir, rel), 'utf8').catch(() => null);
  if (text === null) {
    throw new Error(`the ${what} ${rel} is missing from ${dir}`);
  }
  const stripped = stripPromptVersion(text.replace(/\r\n/g, '\n')).replace(/\n$/, '');
  if (stripped.trim() === '') {
    throw new Error(`the ${what} ${rel} in ${dir} is empty`);
  }
  return stripped;
}

const FRAGMENT_FILES: Readonly<Record<keyof PromptFragments, string>> = {
  planFormat: 'plan-format.md',
  chainGrammar: 'chain-grammar.md',
  flowProposal: 'flow-proposal.md',
};

/** Every shared fragment, from `<dir>/fragments/`. */
export async function loadPromptFragments(dir: string): Promise<PromptFragments> {
  return {
    planFormat: await readPromptFile(dir, path.join('fragments', FRAGMENT_FILES.planFormat), 'fragment'),
    chainGrammar: await readPromptFile(dir, path.join('fragments', FRAGMENT_FILES.chainGrammar), 'fragment'),
    flowProposal: await readPromptFile(dir, path.join('fragments', FRAGMENT_FILES.flowProposal), 'fragment'),
  };
}

/**
 * A persona prompt for a 1:1 or a free session: a seeded persona's
 * prompt.md carries its step prompt, placeholders included — they expand
 * from the shipped fragments. A text without a placeholder reads nothing.
 */
export async function expandShippedFragments(text: string, dir: string = SHIPPED_PROMPTS_DIR): Promise<string> {
  const named = Object.values(FRAGMENT_PLACEHOLDERS).some((placeholder) => text.includes(placeholder));
  return named ? expandFragments(text, await loadPromptFragments(dir)) : text;
}

