import type { SkippedSkill } from '../contracts/skill-library';
import type { SkillErrorCode } from '../contracts/skills';
import { MAX_SKILL_BYTES, MAX_SKILL_FILES, validateSkillBundle, type SkillBundleFile } from '../core/skills/skill-bundle';
import { skillsInTree, type FoundSkill, type GithubRepo } from '../core/skills/skill-source';
import { GithubError, type GithubClient } from './github-client';

/** One skill folder read from the repository, validated like an upload: its name and its files, relative to the folder. */
export interface FetchedSkill {
  readonly name: string;
  readonly folder: string;
  readonly files: readonly SkillBundleFile[];
}

export type FetchOutcome =
  | { readonly ok: true; readonly commit: string; readonly skills: readonly FetchedSkill[]; readonly skipped: readonly SkippedSkill[] }
  | { readonly ok: false; readonly code: SkillErrorCode; readonly error: string };

const refuse = (code: SkillErrorCode, error: string): FetchOutcome => ({ ok: false, code, error });

/**
 * Reads a source's skills from GitHub (req-289): the ref's commit, its file
 * tree, the skill folders under the path, and each folder's files — every
 * folder through the upload's own validation (`validateSkillBundle`: a
 * `SKILL.md` with a description and a body, the size bounds). A folder that
 * fails is skipped and said; nothing reaches the disk here.
 */
export class SkillSourceFetcher {
  constructor(private readonly github: GithubClient) {}

  async fetch(repo: GithubRepo, path: string, ref: string): Promise<FetchOutcome> {
    try {
      const commit = await this.github.commitOf(repo, ref);
      const tree = await this.github.treeOf(repo, commit.tree);
      if (tree.truncated) {
        return refuse('too_large', `${repo.repo} is too large to read in one tree — name a smaller path`);
      }
      const found = skillsInTree(tree.entries, path, repo.name);
      const skipped: SkippedSkill[] = found.skipped.map((entry) => ({
        folder: entry.folder,
        code: entry.reason === 'bad_name' ? 'bad_name' : 'too_large',
        error: entry.reason === 'bad_name' ? 'the folder name is no skill name' : 'a source brings at most 50 skills',
      }));
      if (found.skills.length === 0) {
        return skipped.length > 0 ? refuse(skipped[0]!.code, `no skill under ${path === '' ? 'the root' : path} could be taken: ${skipped[0]!.error}`) : refuse('no_skill', `no SKILL.md under ${path === '' ? 'the root' : path} at ${ref}`);
      }
      const skills: FetchedSkill[] = [];
      for (const skill of found.skills) {
        const read = await this.readSkill(repo, commit.sha, skill);
        if ('code' in read) {
          skipped.push(read);
        } else {
          skills.push(read);
        }
      }
      return { ok: true, commit: commit.sha, skills, skipped };
    } catch (error) {
      return error instanceof GithubError ? refuse(error.code, error.message) : refuse('fetch_failed', error instanceof Error ? error.message : String(error));
    }
  }

  private async readSkill(repo: GithubRepo, commit: string, skill: FoundSkill): Promise<FetchedSkill | SkippedSkill> {
    const bytes = skill.files.reduce((sum, file) => sum + file.size, 0);
    if (skill.files.length > MAX_SKILL_FILES || bytes > MAX_SKILL_BYTES) {
      return { folder: skill.folder, code: 'too_large', error: `a skill holds at most ${MAX_SKILL_FILES} files and ${MAX_SKILL_BYTES / 1024 / 1024} MiB` };
    }
    const files: SkillBundleFile[] = [];
    for (const file of skill.files) {
      const full = skill.folder === '' ? file.path : `${skill.folder}/${file.path}`;
      files.push({ path: file.path, data: await this.github.fileOf(repo, commit, full) });
    }
    const bundle = validateSkillBundle(files, skill.name);
    return bundle.ok ? { name: bundle.name, folder: skill.folder, files: bundle.files } : { folder: skill.folder, code: bundle.code, error: bundle.error };
  }
}
