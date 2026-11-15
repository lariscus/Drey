import { sharedSkillDir, SHARED_SKILLS_DIR } from '../core/skills/skill';
import type { SkillFileSystem } from './skill-file-system';
import type { FetchedSkill } from './skill-source-fetcher';

export interface FolderChange {
  readonly changed: readonly string[];
  readonly deleted: readonly string[];
}

/**
 * Puts a source's fetched skills into the shared pool (req-289): the folders
 * the source brought before leave, the fetched ones are written in their
 * place, byte for byte. Returns exactly the files that changed and that went,
 * for the one commit; the record and the commit are the caller's.
 */
export class SkillSourceWriter {
  constructor(private readonly fs: SkillFileSystem) {}

  /** The names in the pool that some folder (or a legacy flat file) already holds. */
  async taken(names: readonly string[]): Promise<readonly string[]> {
    const entries = await this.fs.list(SHARED_SKILLS_DIR);
    const present = new Set(entries.map((entry) => (entry.dir ? entry.name : entry.name.replace(/\.md$/, ''))));
    return names.filter((name) => present.has(name));
  }

  /** `previous` are the source's old folders; every one of them and every fetched folder is replaced. */
  async replace(previous: readonly string[], skills: readonly FetchedSkill[]): Promise<FolderChange> {
    const old = await this.removeFolders([...new Set([...previous, ...skills.map((skill) => skill.name)])]);
    const changed: string[] = [];
    for (const skill of skills) {
      for (const file of skill.files) {
        const rel = `${sharedSkillDir(skill.name)}/${file.path}`;
        await this.fs.writeFile(rel, file.data);
        changed.push(rel);
      }
    }
    return { changed, deleted: old.filter((rel) => !changed.includes(rel)) };
  }

  /** Removes the folders of `names` from the pool; returns the files that went. */
  async removeFolders(names: readonly string[]): Promise<readonly string[]> {
    const gone: string[] = [];
    for (const name of names) {
      const folder = sharedSkillDir(name);
      gone.push(...(await this.fs.files(folder)).map((file) => `${folder}/${file}`));
      await this.fs.remove(folder);
    }
    return gone;
  }
}
