import { personaMemorySection } from '../fleet/context-pack';
import { skillsSection, type SkillBody } from '../fleet/skills-section';

/** What of Mission Control's persona rides her turns (req-269, req-294, req-296). */
export interface MissionPersonaParts {
  /** `prompt.md`; '' = none. */
  readonly prompt: string;
  /** `memory.md`; '' = none. */
  readonly memory: string;
  /** Her enabled skills with their bodies, in `skills:` order. */
  readonly skills: readonly SkillBody[];
}

/**
 * The persona part of a Mission Control turn's system message: her
 * instructions, then her `## Memory` slice (the same slice a run's
 * instruction carries), then her `## Skills` block (the one block every
 * session kind renders). Each part is left out when empty; null when all
 * are. Pure — the turn and the Persona page's preview share it, so the
 * preview counts what a turn sends.
 */
export function missionPersonaText(parts: MissionPersonaParts): string | null {
  const blocks = [parts.prompt.replace(/\r\n/g, '\n').trim(), personaMemorySection(parts.memory) ?? '', skillsSection(parts.skills) ?? ''].filter((block) => block !== '');
  return blocks.length === 0 ? null : blocks.join('\n\n');
}
