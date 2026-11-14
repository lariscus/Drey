import { parseDocument, stringify } from 'yaml';
import { splitFrontmatter } from '../../../../shared/frontmatter';
import type { SkillSourceRef } from '../contracts/skills';
import { isSkillName } from './skill';
import { isRefName, normalizeSourcePath, parseGithubRepo, sourceIdOf } from './skill-source';

/**
 * `tickets/_meta/skill-sources.md` (req-289, `specs/ticket-schema.md`): the
 * GitHub sources of the skills library — per source the repository, the
 * folder, the ref the owner asked for, the commit it was fetched at, when,
 * and the skill folders of `_meta/skills/` it brought. The file sits beside
 * the skills folder, not in it, so no skill folder carries anything Drey
 * wrote. An entry that does not read is dropped with a warning; the owner's
 * prose below the fence is kept.
 */

export const SKILL_SOURCES_FILE = 'tickets/_meta/skill-sources.md';

export interface SkillSourceRecord extends SkillSourceRef {
  /** When the files were fetched (ISO). */
  readonly fetched: string;
  /** The skill folders it brought, by name, sorted. */
  readonly skills: readonly string[];
}

export interface SkillSourcesParse {
  readonly sources: readonly SkillSourceRecord[];
  readonly warnings: readonly string[];
  /** The text below the frontmatter, kept on a write. */
  readonly prose: string;
}

const DEFAULT_PROSE = 'The GitHub sources of the skills library: each source and the skill folders in `skills/` it brought. Drey writes this file on Fetch, Update and Remove.\n';

export function recordId(record: Pick<SkillSourceRecord, 'repo' | 'path'>): string {
  return sourceIdOf(record.repo, record.path);
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

function recordOf(raw: unknown, index: number): SkillSourceRecord | string {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return `source ${index + 1} is not a mapping`;
  }
  const map = raw as Record<string, unknown>;
  const repo = parseGithubRepo(text(map['repo']));
  const path = normalizeSourcePath(text(map['path']));
  const ref = text(map['ref']);
  const commit = text(map['commit']);
  const skills = Array.isArray(map['skills']) ? map['skills'].map(text).filter(isSkillName) : [];
  if (repo === null || path === null || !isRefName(ref) || !/^[0-9a-f]{7,64}$/.test(commit)) {
    return `source ${index + 1} needs a github.com repo, a ref and a commit`;
  }
  return { repo: repo.repo, path, ref, commit, fetched: text(map['fetched']), skills: [...new Set(skills)].sort() };
}

/** The frontmatter's `sources` list ([] when absent), or null when the YAML does not parse. */
function sourcesListOf(yamlText: string): readonly unknown[] | null {
  const doc = parseDocument(yamlText);
  if (doc.errors.length > 0) {
    return null;
  }
  const root: unknown = doc.toJS();
  const list = root !== null && typeof root === 'object' ? (root as Record<string, unknown>)['sources'] : undefined;
  return Array.isArray(list) ? list : [];
}

export function parseSkillSources(file: string | null): SkillSourcesParse {
  if (file === null) {
    return { sources: [], warnings: [], prose: DEFAULT_PROSE };
  }
  const { yamlText, body } = splitFrontmatter(file.replace(/\r\n?/g, '\n'));
  const list = sourcesListOf(yamlText ?? '');
  const sources: SkillSourceRecord[] = [];
  const warnings: string[] = list === null ? ['skill-sources.md does not parse'] : [];
  const seen = new Set<string>();
  for (const [index, raw] of (list ?? []).entries()) {
    const record = recordOf(raw, index);
    if (typeof record === 'string') {
      warnings.push(`skill-sources.md: ${record}`);
    } else if (!seen.has(recordId(record))) {
      seen.add(recordId(record));
      sources.push(record);
    }
  }
  return { sources, warnings, prose: body.trim() === '' ? DEFAULT_PROSE : body.replace(/^\n+/, '') };
}

export function skillSourcesText(sources: readonly SkillSourceRecord[], prose: string): string {
  const entries = sources.map((source) => ({ repo: source.repo, path: source.path, ref: source.ref, commit: source.commit, fetched: source.fetched, skills: [...source.skills] }));
  const yaml = stringify({ sources: entries }, { lineWidth: 0 });
  return `---\n${yaml}---\n\n${prose.endsWith('\n') ? prose : `${prose}\n`}`;
}
