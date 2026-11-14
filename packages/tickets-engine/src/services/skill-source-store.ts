import type { SkillSourceRef } from '../contracts/skills';
import { parseSkillSources, recordId, SKILL_SOURCES_FILE, skillSourcesText, type SkillSourceRecord, type SkillSourcesParse } from '../core/skill-sources-file';
import type { SkillFileSystem } from './skill-file-system';

/**
 * `tickets/_meta/skill-sources.md` on disk (req-289): read, and written back
 * with one source added, replaced or removed, or one skill name dropped. The
 * commit is the caller's; every write returns the path it changed.
 */
export class SkillSourceStore {
  constructor(private readonly fs: SkillFileSystem) {}

  async read(): Promise<SkillSourcesParse> {
    return parseSkillSources(await this.fs.readText(SKILL_SOURCES_FILE));
  }

  /** Which source brought each shared skill, by skill name. */
  async provenance(): Promise<ReadonlyMap<string, SkillSourceRecord>> {
    const { sources } = await this.read();
    return new Map(sources.flatMap((source) => source.skills.map((name) => [name, source] as const)));
  }

  /** The record with `id` replaced by `next` (added when absent, removed when null). */
  async put(id: string, next: SkillSourceRecord | null): Promise<string> {
    const { sources, prose } = await this.read();
    const rest = sources.filter((source) => recordId(source) !== id);
    const updated = next === null ? rest : [...rest, next].sort((a, b) => recordId(a).localeCompare(recordId(b)));
    await this.fs.writeFile(SKILL_SOURCES_FILE, skillSourcesText(updated, prose));
    return SKILL_SOURCES_FILE;
  }

  /** Drops a skill name from the source that lists it (the folder was replaced or deleted); null when no source did. */
  async dropSkill(name: string): Promise<string | null> {
    const { sources, prose } = await this.read();
    if (!sources.some((source) => source.skills.includes(name))) {
      return null;
    }
    const updated = sources.map((source) => ({ ...source, skills: source.skills.filter((skill) => skill !== name) }));
    await this.fs.writeFile(SKILL_SOURCES_FILE, skillSourcesText(updated, prose));
    return SKILL_SOURCES_FILE;
  }
}

export function sourceRefOf(record: SkillSourceRecord): SkillSourceRef {
  return { repo: record.repo, path: record.path, ref: record.ref, commit: record.commit };
}
