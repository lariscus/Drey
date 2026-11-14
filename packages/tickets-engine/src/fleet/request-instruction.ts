import { stripPromptVersion } from '../core/default-prompts';
import { ticketSections } from '../core/ticket-files';
import { composeInstruction, composeScoutInstruction, type InstructionInput, type ScoutInstructionInput } from './assignment';
import { personaMemorySection } from './context-pack';
import { skillsSection } from './skills-section';
import type { ComposedInstruction } from './instruction-parts';
import { DEFAULT_FLEET_CAPS, type InteractiveMode } from './protocol';
import type { ComposeRunInput, PersonaDispatch } from './request';
import type { RunPlan } from './request-plan';

export type PersonaParts = Pick<InstructionInput, 'skillsSection' | 'memorySection' | 'personaId' | 'personaRole' | 'readOnly'>;

/** The worker's brief: an exploration brief for a scout ticket, the build brief otherwise. */
export function composeRunInstruction(plan: RunPlan): ComposedInstruction {
  return plan.scout ? composeScoutInstruction(scoutInstructionInput(plan)) : composeInstruction(shipInstructionInput(plan));
}

function scoutInstructionInput(plan: RunPlan): ScoutInstructionInput {
  const { input } = plan;
  const sections = ticketSections(input.ticketText);
  return {
    disciplines: input.disciplines,
    ticketId: input.card.id,
    title: titleOf(input),
    readGround: plan.readGround,
    repoName: input.repo?.name ?? null,
    ticketFile: plan.ticketFile,
    phase: input.card.phase,
    description: sections.description,
    plan: sections.plan,
    prompt: runPrompt(input),
    repoInstructions: input.repoInstructions,
    ...(plan.extras.readGrounds.length > 0 ? { extraRepos: plan.extras.readGrounds } : {}),
    ...interactivePart(input),
    ...personaInstructionParts(input.persona ?? null),
    ...projectPart(input),
  };
}

function shipInstructionInput(plan: RunPlan): InstructionInput {
  const { input } = plan;
  const repo = input.repo!;
  const sections = ticketSections(input.ticketText);
  const extras = plan.extras.worktrees;
  return {
    disciplines: input.disciplines,
    ticketId: input.card.id,
    title: titleOf(input),
    repo: repo.name,
    branch: plan.branch,
    worktreePath: plan.worktreePath,
    phase: input.card.phase,
    description: sections.description,
    plan: sections.plan,
    handover: sections.handover,
    prompt: runPrompt(input),
    acceptance: plan.acceptance,
    ticketFile: plan.ticketFile,
    ...(input.dk !== undefined ? { ticketFileIsCopy: true } : {}),
    ...(repo.link !== undefined && repo.link.length > 0 ? { links: repo.link } : {}),
    ...(extras.length > 0 ? { extraRepos: extras.map((r) => ({ name: r.name, worktreePath: r.worktreePath, base: r.baseRef })) } : {}),
    repoInstructions: input.repoInstructions,
    diffStat: input.diffStat,
    gateFailure: input.gateFailure,
    caps: input.caps ?? DEFAULT_FLEET_CAPS,
    ...interactivePart(input),
    ...personaInstructionParts(input.persona ?? null),
    ...projectPart(input),
    ...(plan.reviewCheckout !== null ? { reviewCheckout: plan.reviewCheckout } : {}),
    ...(input.cursor !== undefined ? { chain: chainPartOf(input.cursor) } : {}),
  };
}

/** req-257: the brief's chain part from the run's cursor; req-78: with the red gate that sent the ticket here. */
function chainPartOf(cursor: NonNullable<ComposeRunInput['cursor']>): NonNullable<InstructionInput['chain']> {
  return { at: cursor.at, length: cursor.length, entries: cursor.entries ?? [], ...(cursor.redBack !== undefined ? { redBack: cursor.redBack } : {}) };
}

function titleOf(input: ComposeRunInput): string {
  return input.card.meta.title ?? input.card.id;
}

/**
 * The persona's prompt is the instruction base when it has one; else the
 * phase's prompt stands. req-258's interactive mode wrapper: on a dialog run
 * the column's interactive prompt (the shape dialog's interview-first
 * protocol) follows the persona's prompt instead of being displaced by it.
 */
function runPrompt(input: ComposeRunInput): string | null {
  const persona = input.persona ?? null;
  const personaPrompt = persona !== null && persona.prompt !== null && persona.prompt.trim() !== '' ? persona.prompt : null;
  // req-280: a board-started run reads the vault prompt raw — its version marker is for the drift check, never for the model.
  const phasePrompt = input.promptText === null ? null : stripPromptVersion(input.promptText);
  if (personaPrompt === null) {
    return phasePrompt;
  }
  const own = stripPromptVersion(personaPrompt);
  return input.interactive !== undefined && phasePrompt !== null && phasePrompt.trim() !== '' ? `${own.trimEnd()}\n\n${phasePrompt.trim()}` : own;
}

/** req-282: the ticket's project for the brief's `## Project`; nothing for an Unassigned ticket. */
function projectPart(input: ComposeRunInput): Pick<InstructionInput, 'project'> {
  return input.project !== undefined && input.project !== null ? { project: { name: input.project.name, purpose: input.project.purpose } } : {};
}

function interactivePart(input: ComposeRunInput): { interactive?: InteractiveMode } {
  return input.interactive !== undefined ? { interactive: input.interactive } : {};
}

/** The persona's skills, memory slice, id and role for the brief; nothing on a ring dispatch. */
export function personaInstructionParts(persona: PersonaDispatch | null): PersonaParts {
  if (persona === null) {
    return {};
  }
  return {
    skillsSection: skillsSection(persona.skills),
    memorySection: personaMemorySection(persona.memory),
    personaId: persona.id,
    personaRole: persona.role ?? null,
    ...(persona.run?.readOnly === true ? { readOnly: true } : {}),
  };
}
