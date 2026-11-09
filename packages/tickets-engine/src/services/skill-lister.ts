import type { SkillListData, SkillView, TokenizerView } from '../contracts/skills';
import { declaredNameOf, descriptionFromBody } from '../core/skill';
import { estimateTokens } from '../core/token-count';
import { skillsSection } from '../fleet/skills-section';
import type { SkillFileSystem } from './skill-file-system';
import type { SkillFolderReader, SkillRecord } from './skill-folder-reader';

/**
 * The listing the Skills tab and the phone show (req-172, req-137): every
 * skill a persona can reach — own over shared, one row per name — with its
 * switch (`on` = the name is in the persona's `skills:` list), size, an
 * estimated token count of what a run would load of it, and what the
 * `## Skills` block of the selection costs together.
 */
export class SkillLister {
  constructor(
    private readonly reader: SkillFolderReader,
    private readonly fs: SkillFileSystem,
  ) {}

  /** `personaId` null lists the shared pool alone (every `on` false). */
  async list(personaId: string | null, selected: readonly string[], tokenizer: TokenizerView): Promise<SkillListData> {
    const { records, overriding } = await this.reader.available(personaId);
    const on = new Set(selected);
    const skills: SkillView[] = [];
    for (const record of records) {
      skills.push(await this.viewOf(record, on.has(record.name), overriding.has(record.name), tokenizer));
    }
    const present = new Set(records.map((record) => record.name));
    const byName = new Map(records.map((record) => [record.name, record] as const));
    // the block lists the skills in the order the persona's own list names them
    const bodies = selected.flatMap((name) => (byName.has(name) ? [{ name, text: byName.get(name)!.parsed.body }] : []));
    const section = skillsSection(bodies);
    return {
      persona: personaId,
      skills,
      missing: selected.filter((name) => !present.has(name)),
      selectedTokens: section === null ? 0 : estimateTokens(section, tokenizer),
      tokenizer,
    };
  }

  private async viewOf(record: SkillRecord, on: boolean, overridesShared: boolean, tokenizer: TokenizerView): Promise<SkillView> {
    const { parsed } = record;
    return {
      name: record.name,
      description: parsed.description ?? descriptionFromBody(parsed.body),
      origin: record.origin,
      on,
      overridesShared,
      legacy: record.legacy,
      size: new TextEncoder().encode(record.text).byteLength,
      tokens: estimateTokens(`### ${record.name}\n\n${parsed.body}`, tokenizer),
      files: record.legacy ? 0 : Math.max(0, (await this.fs.files(record.path)).length - 1),
      allowedTools: parsed.allowedTools,
      license: parsed.license,
      declaredName: declaredNameOf(parsed, record.name),
    };
  }
}
