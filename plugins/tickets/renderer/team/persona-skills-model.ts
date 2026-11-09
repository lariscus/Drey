// i18n: catalog
/**
 * The page's Skills block, pure half (R11, req-171; over the engine's
 * listing since req-237): one row per skill the engine lists — the persona's
 * own folder and the shared pool, `on` for those in the record's `skills:`
 * — plus a row for every name the record holds that no folder does (so the
 * owner can switch it off). DOM-free.
 */
import type { SkillErrorCode, SkillListData, SkillView } from '../../../../packages/tickets-engine/src/contracts/skills';
import type { SkillsFailure } from './persona-seams';

/** A skill's folder name as a row's name: `go-conventions` -> `Go conventions`. */
export function skillTitleOf(id: string): string {
  const words = id.replace(/[-_]+/g, ' ').trim();
  return words === '' ? id : words[0]!.toUpperCase() + words.slice(1);
}

export interface SkillRow {
  readonly name: string;
  readonly title: string;
  /** Where the skill lives, as the mockup shows it; null for a name no folder holds. */
  readonly path: string | null;
  readonly origin: 'own' | 'shared' | null;
  /** Estimated tokens of what a run loads; null for a name no folder holds. */
  readonly tokens: number | null;
  readonly on: boolean;
  /** Only an own skill is deleted from here. */
  readonly removable: boolean;
}

/** `_meta/skills/<name>/SKILL.md` or `personas/<id>/skills/<name>/SKILL.md`; a flat file not yet migrated shows as `<name>.md`. */
export function skillPathOf(skill: Pick<SkillView, 'name' | 'origin' | 'legacy'>, persona: string): string {
  const base = skill.origin === 'own' ? `personas/${persona}/skills` : '_meta/skills';
  return skill.legacy ? `${base}/${skill.name}.md` : `${base}/${skill.name}/SKILL.md`;
}

export function skillRowsOf(list: SkillListData, persona: string): readonly SkillRow[] {
  const rows: SkillRow[] = list.skills.map((skill) => ({
    name: skill.name,
    title: skillTitleOf(skill.name),
    path: skillPathOf(skill, persona),
    origin: skill.origin,
    tokens: skill.tokens,
    on: skill.on,
    removable: skill.origin === 'own',
  }));
  for (const name of list.missing) {
    rows.push({ name, title: skillTitleOf(name), path: null, origin: null, tokens: null, on: true, removable: false });
  }
  return rows;
}

/** What the block's head counts: the skills on, all that are available, the estimated tokens the ones on cost a run. */
export function skillCountsOf(list: SkillListData): { readonly on: number; readonly total: number; readonly tokens: number } {
  return { on: list.skills.filter((skill) => skill.on).length + list.missing.length, total: list.skills.length + list.missing.length, tokens: list.selectedTokens };
}

/** The catalog key of an engine refusal; an unknown code or a transport failure has none and shows the text it came with. */
export function failureKeyOf(failure: SkillsFailure): `skills.error.${SkillErrorCode}` | null {
  return failure.code === null ? null : `skills.error.${failure.code}`;
}
