import { isSkillName, migratedSkillText, ownSkillsDir, SHARED_SKILLS_DIR, SKILL_FILE } from '../core/skills/skill';
import type { EngineHost, EngineVault } from './host';
import type { SkillCommitter } from './skill-committer';
import type { SkillFileSystem } from './skill-file-system';

/** What one migration pass did, for the log and the specs. */
export interface SkillMigration {
  /** `shared/<name>` or `<persona>/<name>`: flat files turned into folders. */
  readonly migrated: readonly string[];
  /** Flat files dropped because a folder of the same name already won. */
  readonly shadowed: readonly string[];
}

interface HomeChange {
  readonly changed: string[];
  readonly deleted: string[];
  readonly migrated: string[];
  readonly shadowed: string[];
}

const COMMIT_MESSAGE = 'skills: migrate flat skill files to Agent Skills folders';

/**
 * The one-time migration of the legacy flat skills (req-172, R8): a
 * `<name>.md` in a skills home becomes `<name>/SKILL.md` with a generated
 * frontmatter, the old text byte for byte as the body. Where a folder of the
 * name already exists it wins and the flat file is dropped (git keeps it).
 * Every home — the shared pool and each persona's own — in one pass, one
 * logged commit; a vault with nothing flat is left untouched, so running it
 * again changes nothing.
 */
export class SkillMigrator {
  constructor(
    private readonly fs: SkillFileSystem,
    private readonly committer: SkillCommitter,
    private readonly host: Pick<EngineHost, 'log'>,
  ) {}

  async run(vault: EngineVault, personaIds: readonly string[]): Promise<SkillMigration> {
    const homes: readonly (readonly [string, string])[] = [['shared', SHARED_SKILLS_DIR], ...personaIds.map((id) => [id, ownSkillsDir(id)] as const)];
    const total: HomeChange = { changed: [], deleted: [], migrated: [], shadowed: [] };
    for (const [label, dir] of homes) {
      const part = await this.migrateHome(label, dir);
      total.changed.push(...part.changed);
      total.deleted.push(...part.deleted);
      total.migrated.push(...part.migrated);
      total.shadowed.push(...part.shadowed);
    }
    if (total.changed.length + total.deleted.length === 0) {
      return { migrated: [], shadowed: [] };
    }
    const warning = await this.committer.commit(vault, total, COMMIT_MESSAGE);
    this.host.log(`skills: migrated ${total.migrated.join(', ') || 'nothing'}${total.shadowed.length > 0 ? `; dropped shadowed ${total.shadowed.join(', ')}` : ''}${warning === null ? '' : ` (${warning})`}`, warning === null ? 'info' : 'warn');
    return { migrated: total.migrated, shadowed: total.shadowed };
  }

  private async migrateHome(label: string, dir: string): Promise<HomeChange> {
    const out: HomeChange = { changed: [], deleted: [], migrated: [], shadowed: [] };
    for (const entry of await this.fs.list(dir)) {
      const name = !entry.dir && entry.name.endsWith('.md') ? entry.name.slice(0, -3) : '';
      if (!isSkillName(name) || name.toLowerCase() === 'readme') {
        continue;
      }
      const flat = `${dir}/${entry.name}`;
      const folderFile = `${dir}/${name}/${SKILL_FILE}`;
      if ((await this.fs.readText(folderFile)) !== null) {
        await this.fs.remove(flat);
        out.deleted.push(flat);
        out.shadowed.push(`${label}/${name}`);
        continue;
      }
      const text = await this.fs.readText(flat);
      if (text === null || text.trim() === '') {
        continue;
      }
      await this.fs.writeFile(folderFile, migratedSkillText(name, text));
      await this.fs.remove(flat);
      out.changed.push(folderFile);
      out.deleted.push(flat);
      out.migrated.push(`${label}/${name}`);
    }
    return out;
  }
}
