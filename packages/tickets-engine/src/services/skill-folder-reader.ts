import type { SkillOrigin } from '../contracts/skills';
import { isSkillName, ownSkillsDir, parseSkillMarkdown, SHARED_SKILLS_DIR, SKILL_FILE, type ParsedSkill } from '../core/skill';
import type { SkillFileSystem } from './skill-file-system';

/** One skill found in a home: where it lives, its text and its parse. */
export interface SkillRecord {
  readonly name: string;
  readonly origin: SkillOrigin;
  /** A flat `<name>.md` the migration has not turned into a folder. */
  readonly legacy: boolean;
  /** The folder (`.../<name>`), or the flat file's own path when legacy. */
  readonly path: string;
  /** The file whose text is the skill: `<path>/SKILL.md`, or the flat file. */
  readonly file: string;
  readonly text: string;
  readonly parsed: ParsedSkill;
}

/** The skills a persona can switch on: one per name, own over shared. */
export interface AvailableSkills {
  readonly records: readonly SkillRecord[];
  /** Names an own skill takes from a shared one. */
  readonly overriding: ReadonlySet<string>;
}

/**
 * Reads the skill homes (req-172, D-46's order): the shared pool
 * `tickets/_meta/skills/` and a persona's own `personas/<id>/skills/`. A
 * skill is a folder with a `SKILL.md`; a flat `<name>.md` still reads for
 * one release (the migrator turns it into a folder), and a folder beats a
 * flat file of its name. Reads only — never writes, never logs.
 */
export class SkillFolderReader {
  constructor(private readonly fs: SkillFileSystem) {}

  /** Every skill in one home, sorted by name. */
  async home(dir: string, origin: SkillOrigin): Promise<readonly SkillRecord[]> {
    const entries = await this.fs.list(dir);
    const records = new Map<string, SkillRecord>();
    for (const entry of entries) {
      const name = entry.dir ? entry.name : entry.name.endsWith('.md') ? entry.name.slice(0, -3) : '';
      // the entries list folders first, so a folder is read before a flat file of its name
      if (!isSkillName(name) || (!entry.dir && records.has(name))) {
        continue;
      }
      const record = entry.dir ? await this.folderSkill(dir, name, origin) : await this.flatSkill(dir, name, origin);
      if (record !== null) {
        records.set(name, record);
      }
    }
    return [...records.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Own over shared, one record per name; `personaId` null reads the shared pool alone. */
  async available(personaId: string | null): Promise<AvailableSkills> {
    const shared = await this.home(SHARED_SKILLS_DIR, 'shared');
    const own = personaId === null ? [] : await this.home(ownSkillsDir(personaId), 'own');
    const byName = new Map<string, SkillRecord>(shared.map((record) => [record.name, record]));
    const sharedNames = new Set(byName.keys());
    const overriding = new Set<string>();
    for (const record of own) {
      if (sharedNames.has(record.name)) {
        overriding.add(record.name);
      }
      byName.set(record.name, record);
    }
    return { records: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)), overriding };
  }

  private async folderSkill(dir: string, name: string, origin: SkillOrigin): Promise<SkillRecord | null> {
    const file = `${dir}/${name}/${SKILL_FILE}`;
    const text = await this.fs.readText(file);
    return text === null ? null : { name, origin, legacy: false, path: `${dir}/${name}`, file, text, parsed: parseSkillMarkdown(text) };
  }

  private async flatSkill(dir: string, name: string, origin: SkillOrigin): Promise<SkillRecord | null> {
    const file = `${dir}/${name}.md`;
    const text = await this.fs.readText(file);
    return text === null ? null : { name, origin, legacy: true, path: file, file, text, parsed: parseSkillMarkdown(text) };
  }
}
