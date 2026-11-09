// i18n: catalog
/**
 * The page's Skills block, pure half (R11, req-171): one row per skill with
 * its switch. A switch on = the name is in the record's `skills:`; the rows
 * are the skills the record named when the page loaded plus any the owner
 * switched on since, so a skill switched off stays in view until it is
 * saved. DOM-free.
 */
import type { SkillInfo } from './persona-seams';

/** A skill's folder name as a row's name: `go-conventions` -> `Go conventions`. */
export function skillTitleOf(id: string): string {
  const words = id.replace(/[-_]+/g, ' ').trim();
  return words === '' ? id : words[0]!.toUpperCase() + words.slice(1);
}

export interface SkillLine {
  readonly name: string;
  readonly title: string;
  readonly path: string | null;
  readonly origin: 'own' | 'shared' | null;
  readonly tokens: number | null;
  readonly on: boolean;
}

export function skillLinesOf(loaded: readonly string[], draft: readonly string[], infos: readonly SkillInfo[]): readonly SkillLine[] {
  const names = [...new Set([...loaded, ...draft])];
  return names.map((name) => {
    const info = infos.find((entry) => entry.name === name);
    return { name, title: skillTitleOf(name), path: info?.path ?? null, origin: info?.origin ?? null, tokens: info?.tokens ?? null, on: draft.includes(name) };
  });
}

/** The `skills:` list after one switch; the order of the record is kept, a newly switched-on skill goes last. */
export function skillsToggled(draft: readonly string[], name: string, on: boolean): readonly string[] {
  if (on) {
    return draft.includes(name) ? draft : [...draft, name];
  }
  return draft.filter((entry) => entry !== name);
}
