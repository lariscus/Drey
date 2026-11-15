/**
 * The crew's chat prompts (req-279): real files in
 * `packages/tickets-engine/prompts/crew/`, shipped beside the compiled
 * engine like the pipeline step prompts — one obvious place to edit
 * every prompt text the crew's chats speak. The reader (`prompt-file.ts`)
 * folds CRLF, drops the `drey-prompt-version` marker line and the one
 * trailing newline; the shared fragments a prompt names by placeholder
 * (`{{chain-grammar}}`, `{{plan-format}}` — req-280) are expanded here, so
 * the text the bridge sends is complete and stable (the prompt cache
 * prefix depends on stable bytes). A missing or empty file throws at
 * composition, naming the file: an installation without them is broken,
 * not a degraded mode.
 */
import path from 'node:path';
import { SHIPPED_PROMPTS_DIR } from '../core/default-prompts';
import { expandFragments, loadPromptFragments, readPromptFile } from '../core/prompt-file';

/** The three chat prompts: Mission Control's turns, shape and the improvement aggregator. */
export interface CrewPrompts {
  readonly mission: string;
  readonly shape: string;
  readonly aggregator: string;
}

const CREW_FILES: readonly (keyof CrewPrompts)[] = ['mission', 'shape', 'aggregator'];

/**
 * The interview-first protocol of a dialog run (the owner plans or refines a ticket in a conversation):
 * `crew/dialog.md`, which follows the persona's prompt (req-307: no vault copy, no version drift).
 */
export async function loadDialogPrompt(dir: string = SHIPPED_PROMPTS_DIR): Promise<string> {
  const fragments = await loadPromptFragments(dir);
  return expandFragments(await readPromptFile(dir, path.join('crew', 'dialog.md'), 'crew prompt'), fragments);
}

/** Every crew prompt, from the shipped prompts dir by default, its fragments expanded. */
export async function loadCrewPrompts(dir: string = SHIPPED_PROMPTS_DIR): Promise<CrewPrompts> {
  const prompts: Record<keyof CrewPrompts, string> = { mission: '', shape: '', aggregator: '' };
  for (const name of CREW_FILES) {
    prompts[name] = await readPromptFile(dir, path.join('crew', `${name}.md`), 'crew prompt');
  }
  const fragments = await loadPromptFragments(dir);
  for (const name of CREW_FILES) {
    prompts[name] = expandFragments(prompts[name], fragments);
  }
  return prompts;
}
