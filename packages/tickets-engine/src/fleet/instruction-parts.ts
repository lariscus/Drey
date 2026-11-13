/**
 * What the ship brief (`instruction.ts`) and the scout brief
 * (`scout-instruction.ts`) share: the composed result's shape, the stable
 * head both open with, and the persona line.
 */

/** One capped section of the instruction — the caller logs each application. */
export interface Truncation {
  readonly section: 'diffStat' | 'gateFailure';
  readonly originalSize: number;
}

export interface ComposedInstruction {
  readonly text: string;
  readonly truncations: readonly Truncation[];
  /**
   * What a resumed session that already holds this brief is prompted
   * with (req-80): who/where, the diff stat, the gate failure, the gate
   * and the discipline — never the instructions, template or plan again.
   */
  readonly continuation: string;
  /** The stable parts serialized — the caller hashes them into `RunRequest.briefDigest` (this module also runs in the renderer). */
  readonly stable: string;
}

/** The ticket's project as the brief names it (req-282): its name and its purpose (the record's body). */
export interface BriefProject {
  readonly name: string;
  readonly purpose: string;
}

/** The fields of a brief's stable head, as both brief inputs carry them. */
export interface BriefHeadSource {
  readonly repoInstructions: string | null;
  readonly prompt: string | null;
  readonly skillsSection?: string | null;
  /** req-282: the ticket's project; null/absent = Unassigned, no section. */
  readonly project?: BriefProject | null;
  readonly plan: string | null;
}

/**
 * The stable head of a brief, each part trimmed — '' when absent or blank,
 * which is what the `stable` digest input carries for a missing part.
 */
export interface BriefHead {
  readonly repoInstructions: string;
  readonly prompt: string;
  readonly skills: string;
  /** The `## Project` section, '' when the project has no purpose (or the ticket none). */
  readonly project: string;
  readonly plan: string;
}

/** The text trimmed; '' for null/undefined. */
export function trimmed(text: string | null | undefined): string {
  return text?.trim() ?? '';
}

/** A one-element list for a present part, an empty one for null. */
export function optional(part: string | null): string[] {
  return part !== null ? [part] : [];
}

export function briefHead(source: BriefHeadSource): BriefHead {
  return {
    repoInstructions: trimmed(source.repoInstructions),
    prompt: trimmed(source.prompt),
    skills: trimmed(source.skillsSection),
    project: projectSection(source.project),
    plan: trimmed(source.plan),
  };
}

/**
 * req-282 (ADR-0097 later change): the project's purpose as a short section,
 * so a worker knows what the thing is without re-deriving it from the repo.
 * A project without a purpose adds nothing — the brief stays byte-identical.
 */
export function projectSection(project: BriefProject | null | undefined): string {
  const purpose = trimmed(project?.purpose);
  if (project === null || project === undefined || purpose === '') {
    return '';
  }
  return [`## Project`, `This ticket belongs to the project "${project.name.trim()}".`, purpose].join('\n\n');
}

/**
 * The head's sections in brief order: the repo's agent instructions
 * verbatim, the phase template (or the persona's prompt), the persona's
 * skills, the ticket's `## Project` (req-282), `## Plan` verbatim — each
 * only when non-blank.
 */
export function headParts(head: BriefHead): string[] {
  const parts: string[] = [];
  for (const part of [head.repoInstructions, head.prompt, head.skills, head.project]) {
    if (part !== '') {
      parts.push(part);
    }
  }
  if (head.plan !== '') {
    parts.push(`## Plan\n\n${head.plan}`);
  }
  return parts;
}

/** The persona's `## Memory` slice as given (untrimmed), or null when blank. */
export function memoryOf(section: string | null | undefined): string | null {
  return section != null && section.trim() !== '' ? section : null;
}

// `core/persona.ts`'s PERSONAS_DIR, repeated: this module is bundled into the
// plugin renderer, which may not pull a runtime `yaml` import (ADR-0044 rule 1).
const PERSONAS_DIR = 'tickets/_meta/personas';

/** The brief's persona line (D-60), or null for a ring run. */
export function personaLine(personaId: string | null | undefined, role: string | null | undefined): string | null {
  const id = personaId?.trim() ?? '';
  if (id === '') {
    return null;
  }
  const roleText = role?.trim() ?? '';
  return (
    `Your persona: ${id}${roleText !== '' ? ` (${roleText})` : ''} — its folder is ${PERSONAS_DIR}/${id}/ in the tickets repo.`
  );
}
