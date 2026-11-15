/**
 * The one `## Skills` block (req-172, R8; its exact shape is in
 * `specs/classifier-spec.md`, "The Skills block"). A chain run's instruction
 * composer, the 1:1 brief and the free session brief all render a persona's
 * selected skills through this function and no other: the body of each
 * skill, in full, under its name, in the order the persona's `skills:` list
 * names them. Pure — this module also runs in the renderer.
 */

export interface SkillBody {
  readonly name: string;
  readonly text: string;
}

export const SKILLS_HEADING = '## Skills';
export const SKILLS_LEAD = "Your persona's skills, loaded in full. Use them where they apply.";

/** The block, or null when the persona carries no skill with a body. */
export function skillsSection(skills: readonly SkillBody[] | undefined): string | null {
  const carried = (skills ?? []).filter((skill) => skill.text.trim() !== '');
  if (carried.length === 0) {
    return null;
  }
  return [SKILLS_HEADING, SKILLS_LEAD, ...carried.map((skill) => `### ${skill.name}\n\n${skill.text.trim()}`)].join('\n\n');
}
