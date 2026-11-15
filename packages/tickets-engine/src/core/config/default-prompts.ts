import { promises as fsp } from 'node:fs';
import path from 'node:path';

/**
 * The prompts Drey ships beside the compiled engine: the run-brief
 * disciplines (`prompts/disciplines/`), the crew chat prompts
 * (`prompts/crew/`) and the shared fragments (`prompts/fragments/`),
 * copied beside the package by `scripts/build-plugins.mjs`.
 */

/** `packages/tickets-engine/prompts/` from the source tree and from `dist-electron/packages/tickets-engine/`. */
export const SHIPPED_PROMPTS_DIR = path.join(__dirname, '..', '..', '..', 'prompts');

/**
 * The version marker a shipped prompt opens with (`<!-- drey-prompt-version: N -->`).
 * The marker line never reaches the model (`stripPromptVersion`).
 */
const PROMPT_VERSION_LINE = /^<!--\s*drey-prompt-version:\s*(\d+)\s*-->[ \t]*\r?\n/;

/** A prompt text's version; 0 when it carries no marker. */
export function promptVersion(text: string): number {
  const match = PROMPT_VERSION_LINE.exec(text);
  return match === null ? 0 : Number(match[1]);
}

/** The prompt text without its version marker line. */
export function stripPromptVersion(text: string): string {
  return text.replace(PROMPT_VERSION_LINE, '');
}

