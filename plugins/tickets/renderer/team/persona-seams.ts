// i18n: catalog
/**
 * The two client seams of the Persona page that wait for req-172 (skills as
 * Agent Skills, R8): where the page reads a persona's skills and where it
 * asks for the assembled prompt. Both are named here so the wiring is one
 * file: today's implementations read what the vault already holds (D-46's
 * `skills:` names, nearest folder first) and know no prompt assembler; the
 * req-172 routes (`personaSkills`, `skillUpload`, `personaPromptPreview`,
 * `contracts/skills.ts` on its branch) replace them without a change to the
 * blocks. Follow-up rows: req-237 (skills), req-238 (prompt preview).
 */
import type { DreyPluginApi } from '../../../../shared/plugin-api/renderer';

/** One skill row as the page draws it. */
export interface SkillInfo {
  readonly name: string;
  /** The folder-relative file the skill lives in, as shown under its name. */
  readonly path: string;
  /** `own` = the persona's folder, `shared` = the crew's `_meta/skills/`. */
  readonly origin: 'own' | 'shared';
  /** An estimate; null when unknown. */
  readonly tokens: number | null;
}

export interface PersonaSkillsSeam {
  /** The skills these names resolve to; a name no folder holds is left out. */
  list(personaId: string, names: readonly string[]): Promise<readonly SkillInfo[]>;
}

/** The assembled brief a run would start with (req-172's `personaPromptPreview`). */
export interface PromptPreview {
  readonly text: string;
  readonly tokens: number;
}

export interface PromptPreviewSeam {
  /** Null while no engine route assembles the prompt: the page then draws no preview button. */
  preview(personaId: string): Promise<PromptPreview | null>;
  readonly available: boolean;
}

/** About four characters to a token: the page's stand-in until the engine counts (req-172); drawn with `≈`. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.trim().length / 4);
}

const SKILL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** D-46's reading: the persona's own `skills/` first, then the crew's `_meta/skills/`; a name is `<name>.md` or `<name>/SKILL.md`. */
export function vaultSkillsSeam(api: DreyPluginApi, vaultId: string | null): PersonaSkillsSeam {
  const read = async (path: string): Promise<string | null> => {
    if (vaultId === null) {
      return null;
    }
    try {
      return (await api.vault.readFile(path, { vaultId })).content;
    } catch {
      return null;
    }
  };
  return {
    list: async (personaId, names) => {
      const found = await Promise.all(
        names.map(async (name): Promise<SkillInfo | null> => {
          if (!SKILL_NAME.test(name)) {
            return null;
          }
          for (const [origin, base] of [['own', `tickets/_meta/personas/${personaId}/skills`], ['shared', 'tickets/_meta/skills']] as const) {
            for (const rel of [`${base}/${name}/SKILL.md`, `${base}/${name}.md`]) {
              const text = await read(rel);
              if (text !== null && text.trim() !== '') {
                return { name, path: rel.replace('tickets/_meta/', ''), origin, tokens: estimateTokens(text) };
              }
            }
          }
          return null;
        }),
      );
      return found.filter((skill): skill is SkillInfo => skill !== null);
    },
  };
}

/** No engine route assembles the prompt yet: nothing to preview. */
export const noPromptPreview: PromptPreviewSeam = { available: false, preview: async () => null };
