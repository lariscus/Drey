import type { SkillLibraryData, SkillLibraryRow, SkillSourceView, SkillUser } from '../contracts/skill-library';
import type { Persona } from '../core/persona/persona';
import { ownSkillsDir, SHARED_SKILLS_DIR } from '../core/skills/skill';
import { recordId, type SkillSourceRecord } from '../core/skills/skill-sources-file';
import { tokenizerFor } from '../core/config/token-count';
import type { SkillKit } from './skill-kit';
import type { SkillRecord } from './skill-folder-reader';
import { sourceRefOf } from './skill-source-store';
import type { UpdateLook } from './skill-update-checks';

/** What the last look found for a source; the lister never asks GitHub itself. */
export type LookOf = (record: SkillSourceRecord) => UpdateLook;

interface RowInput {
  readonly record: SkillRecord;
  readonly persona: string | null;
  readonly users: readonly Persona[];
  readonly source: SkillSourceRecord | null;
}

const userOf = (persona: Persona): SkillUser => ({ id: persona.id, title: persona.title, color: persona.color });

/**
 * The Skills library's listing (req-289, board 7o): the shared pool — each
 * skill with its GitHub source when one brought it — and every persona's own
 * skills, one row each, with the personas that use it: a persona uses a
 * shared skill when its `skills:` names it and no own skill of that name
 * hides it. Then the sources, each with what the last look found.
 */
export class SkillLibraryLister {
  constructor(
    private readonly kit: SkillKit,
    private readonly lookOf: LookOf,
  ) {}

  async list(personas: readonly Persona[]): Promise<SkillLibraryData> {
    const kit = this.kit;
    const { sources } = await kit.sources.read();
    const byName = new Map(sources.flatMap((source) => source.skills.map((name) => [name, source] as const)));
    const owns = new Map<string, readonly SkillRecord[]>();
    for (const persona of personas) {
      owns.set(persona.id, await kit.reader.home(ownSkillsDir(persona.id), 'own'));
    }
    const hides = (persona: Persona, name: string): boolean => (owns.get(persona.id) ?? []).some((record) => record.name === name);
    const rows: SkillLibraryRow[] = [];
    for (const record of await kit.reader.home(SHARED_SKILLS_DIR, 'shared')) {
      const users = personas.filter((persona) => persona.skills.includes(record.name) && !hides(persona, record.name));
      rows.push(await this.rowOf({ record, persona: null, users, source: byName.get(record.name) ?? null }));
    }
    for (const persona of personas) {
      for (const record of owns.get(persona.id) ?? []) {
        rows.push(await this.rowOf({ record, persona: persona.id, users: persona.skills.includes(record.name) ? [persona] : [], source: null }));
      }
    }
    rows.sort((a, b) => a.name.localeCompare(b.name) || (a.persona ?? '').localeCompare(b.persona ?? ''));
    return { sources: sources.map((source) => this.sourceView(source)), skills: rows };
  }

  private sourceView(source: SkillSourceRecord): SkillSourceView {
    return { ...sourceRefOf(source), id: recordId(source), skills: source.skills, fetched: source.fetched, ...this.lookOf(source) };
  }

  private async rowOf(input: RowInput): Promise<SkillLibraryRow> {
    const { record, persona, users, source } = input;
    const view = await this.kit.lister.viewOf(record, false, false, tokenizerFor('claude-code', null));
    return {
      name: record.name,
      description: view.description,
      origin: record.origin,
      persona,
      source: source === null ? null : sourceRefOf(source),
      updateAvailable: source === null ? null : this.lookOf(source).updateAvailable,
      tokens: view.tokens,
      size: view.size,
      usedBy: users.map(userOf),
    };
  }
}
