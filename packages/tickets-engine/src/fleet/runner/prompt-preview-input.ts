import type { InstructionInput } from './instruction';
import type { DisciplineTexts } from './discipline-texts';
import { personaInstructionParts } from './request-instruction';
import { DEFAULT_FLEET_CAPS } from '../protocol';
import type { PersonaDispatch } from './request';

/**
 * The input of the prompt preview (req-143, req-172): the instruction a run
 * of this persona starts with, built by the very composer a run uses
 * (`composeInstruction`) from the persona's real parts — prompt, skills,
 * memory slice — and, for everything a ticket would supply, a marked
 * placeholder. The page shows this text and its token count; nothing in it is
 * a second copy of the brief.
 */

export const PREVIEW_TICKET = {
  ticketId: 'T-0000',
  title: '<ticket title>',
  branch: '<branch>',
  worktreePath: '<worktree>',
  description: '<what and why of the ticket>',
} as const;

export function previewInstructionInput(persona: PersonaDispatch, step: string, disciplines: DisciplineTexts): InstructionInput {
  const prompt = persona.prompt !== null && persona.prompt.trim() !== '' ? persona.prompt : null;
  return {
    ...PREVIEW_TICKET,
    disciplines,
    repo: null,
    phase: step,
    plan: null,
    prompt,
    acceptance: [],
    repoInstructions: null,
    diffStat: null,
    gateFailure: null,
    caps: DEFAULT_FLEET_CAPS,
    ...personaInstructionParts(persona),
  };
}
