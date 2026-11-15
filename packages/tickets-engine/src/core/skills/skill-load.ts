import { declaredNameOf, isSkillName, ownSkillsDir, parseSkillMarkdown, SHARED_SKILLS_DIR, SKILL_FILE, type ParsedSkill } from './skill';

/**
 * What a run loads of a persona's selected skills (D-46, R8): every session
 * kind — a chain run, a 1:1, a free session — reads them through this one
 * function and renders them through the one `## Skills` block
 * (`fleet/skills-section.ts`). Only the body is loaded (the frontmatter is
 * the listing's, not the model's), in full; progressive loading is a later row.
 */

/** One skill as a brief carries it: its name and its body, frontmatter stripped. */
export interface PersonaSkill {
  readonly name: string;
  readonly text: string;
}

export interface LoadedSkills {
  readonly skills: readonly PersonaSkill[];
  /** Names with no readable body, or that would leave the skill folders; reported, never guessed. */
  readonly missing: readonly string[];
  /** Lines for the log: a frontmatter name that differs from its folder (the folder wins). */
  readonly warnings: readonly string[];
}

/** Nearest first: the persona's own folder, then the crew's shared one; a folder before a legacy flat file. */
function candidatesOf(personaId: string, name: string): readonly string[] {
  return [ownSkillsDir(personaId), SHARED_SKILLS_DIR].flatMap((base) => [`${base}/${name}/${SKILL_FILE}`, `${base}/${name}.md`]);
}

async function firstSkill(read: (rel: string) => Promise<string | null>, candidates: readonly string[]): Promise<ParsedSkill | null> {
  for (const rel of candidates) {
    const text = await read(rel).catch(() => null);
    const parsed = text === null ? null : parseSkillMarkdown(text);
    if (parsed !== null && parsed.body !== '') {
      return parsed;
    }
  }
  return null;
}

export async function loadPersonaSkills(
  read: (rel: string) => Promise<string | null>,
  personaId: string,
  names: readonly string[],
): Promise<LoadedSkills> {
  const skills: PersonaSkill[] = [];
  const missing: string[] = [];
  const warnings: string[] = [];
  for (const name of names) {
    const found = isSkillName(name) ? await firstSkill(read, candidatesOf(personaId, name)) : null;
    if (found === null) {
      missing.push(name);
      continue;
    }
    const declared = declaredNameOf(found, name);
    if (declared !== null) {
      warnings.push(`skill ${name}: the frontmatter calls it "${declared}" - the folder name wins`);
    }
    skills.push({ name, text: found.body });
  }
  return { skills, missing, warnings };
}
