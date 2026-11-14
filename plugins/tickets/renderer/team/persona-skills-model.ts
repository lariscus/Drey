// i18n: catalog
/**
 * The page's Skills block, pure half (R11, req-171; over the engine's
 * listing since req-237): one row per skill the engine lists — the persona's
 * own folder and the shared pool, `on` for those in the record's `skills:`
 * — plus a row for every name the record holds that no folder does (so the
 * owner can switch it off); the ones on come first. DOM-free.
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
  /** The frontmatter's description: the row's tooltip, never a line of its own; '' for a name no folder holds. */
  readonly description: string;
  /** Where the skill lives, as the mockup shows it; null for a name no folder holds. */
  readonly path: string | null;
  readonly origin: 'own' | 'shared' | null;
  /** Estimated tokens of what a run loads; null for a name no folder holds. */
  readonly tokens: number | null;
  readonly on: boolean;
  /** Only an own skill is deleted from here. */
  readonly removable: boolean;
  /** req-288: where it comes from, as the row's line and the library list show it. */
  readonly source: SkillSource;
}

/**
 * Where a skill comes from (req-288, board 7k v3): `own` (the persona's
 * folder), `shared` (`_meta/skills/`) or a GitHub source with its ref, and
 * whether the source has a newer ref. The seam for req-289 (the skills
 * library with GitHub sources): a listing whose skill carries `source`
 * (`{ repo, path?, ref? }`) and `updateAvailable` reads as a GitHub skill;
 * until the engine sends them every skill is own or shared.
 */
export interface SkillSource {
  readonly kind: 'own' | 'shared' | 'github';
  /** The library list's column: `own`, `shared`, `github.com/acme/skills`. */
  readonly label: string;
  /** The row's line: `shared · test-first`, `github.com/acme/skills · go-conventions@v1.4`. */
  readonly line: string;
  readonly updateAvailable: boolean;
}

/** The GitHub fields a req-289 listing may carry on a skill (absent before it). */
interface GithubFields {
  readonly source?: { readonly repo?: unknown; readonly ref?: unknown } | null;
  readonly updateAvailable?: unknown;
}

export function skillSourceOf(skill: Pick<SkillView, 'name' | 'origin'> & GithubFields): SkillSource {
  const repo = typeof skill.source?.repo === 'string' && skill.source.repo !== '' ? skill.source.repo : null;
  if (repo !== null) {
    const label = repo.startsWith('github.com/') ? repo : `github.com/${repo}`;
    const ref = typeof skill.source?.ref === 'string' && skill.source.ref !== '' ? `@${skill.source.ref}` : '';
    return { kind: 'github', label, line: `${label} · ${skill.name}${ref}`, updateAvailable: skill.updateAvailable === true || typeof skill.updateAvailable === 'string' };
  }
  const kind = skill.origin === 'own' ? 'own' : 'shared';
  return { kind, label: kind, line: `${kind} · ${skill.name}`, updateAvailable: false };
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
    description: skill.description,
    path: skillPathOf(skill, persona),
    origin: skill.origin,
    tokens: skill.tokens,
    on: skill.on,
    removable: skill.origin === 'own',
    source: skillSourceOf(skill),
  }));
  for (const name of list.missing) {
    rows.push({ name, title: skillTitleOf(name), description: '', path: null, origin: null, tokens: null, on: true, removable: false, source: { kind: 'shared', label: '', line: name, updateAvailable: false } });
  }
  // The skills that are on first, as the mockup has it; the engine's order (by name) holds within each group.
  return [...rows.filter((row) => row.on), ...rows.filter((row) => !row.on)];
}

/** What the block's head counts: the skills on, all that are available, the estimated tokens the ones on cost a run. */
export function skillCountsOf(list: SkillListData): { readonly on: number; readonly total: number; readonly tokens: number } {
  return { on: list.skills.filter((skill) => skill.on).length + list.missing.length, total: list.skills.length + list.missing.length, tokens: list.selectedTokens };
}

/** The catalog key of an engine refusal; an unknown code or a transport failure has none and shows the text it came with. */
export function failureKeyOf(failure: SkillsFailure): `skills.error.${SkillErrorCode}` | null {
  return failure.code === null ? null : `skills.error.${failure.code}`;
}

/** What a failure says: the catalog's line for its code, else the text it came with, else the catalog's `internal` line. */
export function failureTextOf(t: (key: `skills.error.${SkillErrorCode}`) => string, failure: SkillsFailure): string {
  const key = failureKeyOf(failure);
  return key !== null ? t(key) : failure.error !== '' ? failure.error : t('skills.error.internal');
}

/** req-288 (board 7k v3): the persona's rows are the skills it carries; the others, its own ones included, are in the library. */
export function personaSkillRowsOf(rows: readonly SkillRow[]): readonly SkillRow[] {
  return rows.filter((row) => row.on);
}

/** req-288: the library list of *Add from library*: every skill there is, filtered by the search on name, title and description. */
export function librarySkillsOf(rows: readonly SkillRow[], query: string): readonly SkillRow[] {
  const needle = query.trim().toLowerCase();
  const found = rows.filter((row) => row.origin !== null).sort((a, b) => a.title.localeCompare(b.title));
  return needle === '' ? found : found.filter((row) => `${row.name} ${row.title} ${row.description} ${row.source.label}`.toLowerCase().includes(needle));
}
