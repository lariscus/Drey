import type { PromptPartTokens, TokenizerView } from '../contracts/skills';
import { PERSONAS_DIR, splitPoolEntry, type Persona } from '../core/persona';
import { loadPersonaSkills } from '../core/skill-load';
import { estimateTokens, tokenizerFor } from '../core/token-count';
import { personaMemorySection } from '../fleet/context-pack';
import { composeInstruction } from '../fleet/instruction';
import { previewInstructionInput } from '../fleet/prompt-preview-input';
import { personaRunSettingsOf } from '../core/persona-settings';
import { loadDisciplineTexts, type DisciplineTexts } from '../fleet/discipline-texts';
import { skillsSection } from '../fleet/skills-section';
import type { SkillFileSystem } from './skill-file-system';
import { loadCrewPrompts, type CrewPrompts } from './crew-prompts';
import { missionPersonaText } from './mission-persona-text';

export interface PromptPreviewData {
  readonly step: string;
  readonly text: string;
  readonly tokens: number;
  readonly tokenizer: TokenizerView;
  readonly parts: readonly PromptPartTokens[];
  readonly skills: readonly PromptPartTokens[];
  /** Lines for the log: skills that did not load, names the folder overrode. */
  readonly warnings: readonly string[];
}

/**
 * Assembles the brief a run of a persona would start with and counts it
 * (req-143, req-172): the persona's own files are read, the skills loaded
 * through `loadPersonaSkills`, and the text is built by `composeInstruction` —
 * the code a run uses, fed placeholders for the ticket's parts
 * (`fleet/prompt-preview-input.ts`). The count is the estimate of
 * `core/token-count.ts` for the family of the persona's model (or the
 * `model` asked for).
 */
export class PromptPreview {
  /** req-279: the discipline texts of the previewed brief (`prompts/disciplines/`), loaded once from the shipped files. */
  private disciplinesOnce: Promise<DisciplineTexts> | null = null;
  /** req-281: the crew's chat prompts (the mission prompt of Pia's preview), loaded once. */
  private crewOnce: Promise<CrewPrompts> | null = null;

  constructor(private readonly fs: SkillFileSystem) {}

  private disciplines(): Promise<DisciplineTexts> {
    this.disciplinesOnce ??= loadDisciplineTexts();
    return this.disciplinesOnce;
  }

  private crew(): Promise<CrewPrompts> {
    this.crewOnce ??= loadCrewPrompts();
    return this.crewOnce;
  }

  /**
   * req-281/296: Mission Control's persona starts no run — her preview is
   * the system message of a Mission Control turn without the board digest:
   * her part ({@link missionPersonaText}: instructions, memory, skills) and
   * the mission prompt.
   */
  private async mission(persona: Persona, step: string): Promise<PromptPreviewData> {
    const dir = `${PERSONAS_DIR}/${persona.id}`;
    const [prompt, memory, loaded, crew] = await Promise.all([
      this.fs.readText(`${dir}/prompt.md`),
      this.fs.readText(`${dir}/memory.md`),
      loadPersonaSkills((rel) => this.fs.readText(rel), persona.id, persona.skills),
      this.crew(),
    ]);
    const own = missionPersonaText({ prompt: prompt ?? '', memory: memory ?? '', skills: loaded.skills });
    const text = [own ?? '', crew.mission].filter((part) => part.trim() !== '').join('\n\n');
    const tokenizer = tokenizerFor('api', persona.chatModel ?? '');
    const tokens = estimateTokens(text, tokenizer);
    const instructions = estimateTokens((prompt ?? '').trim(), tokenizer);
    const skills = estimateTokens(skillsSection(loaded.skills) ?? '', tokenizer);
    const memoryTokens = estimateTokens(personaMemorySection(memory ?? '') ?? '', tokenizer);
    return {
      step,
      text,
      tokens,
      tokenizer,
      parts: [
        { name: 'instructions', tokens: instructions },
        { name: 'skills', tokens: skills },
        { name: 'memory', tokens: memoryTokens },
        { name: 'rest', tokens: Math.max(0, tokens - instructions - skills - memoryTokens) },
      ],
      skills: loaded.skills.map((skill) => ({ name: skill.name, tokens: estimateTokens(`### ${skill.name}\n\n${skill.text}`, tokenizer) })),
      warnings: [...loaded.warnings, ...(loaded.missing.length > 0 ? [`no text for skill ${loaded.missing.join(', ')}`] : [])],
    };
  }

  async build(persona: Persona, options: { readonly step: string; readonly model: string | null }): Promise<PromptPreviewData> {
    if (persona.kind === 'mission') {
      return this.mission(persona, options.step);
    }
    const dir = `${PERSONAS_DIR}/${persona.id}`;
    const [prompt, memory, loaded] = await Promise.all([
      this.fs.readText(`${dir}/prompt.md`),
      this.fs.readText(`${dir}/memory.md`),
      loadPersonaSkills((rel) => this.fs.readText(rel), persona.id, persona.skills),
    ]);
    const entry = splitPoolEntry(options.model ?? persona.models.default);
    const tokenizer = tokenizerFor(entry.provider ?? persona.worker, entry.model);
    const composed = composeInstruction(
      previewInstructionInput(
        { id: persona.id, role: persona.role, worker: entry.provider ?? persona.worker, model: entry.model, prompt, memory: memory ?? '', skills: loaded.skills, run: personaRunSettingsOf(persona) },
        options.step,
        await this.disciplines(),
      ),
    );
    const tokens = estimateTokens(composed.text, tokenizer);
    const instructions = estimateTokens((prompt ?? '').trim(), tokenizer);
    const skills = estimateTokens(skillsSection(loaded.skills) ?? '', tokenizer);
    const memoryTokens = estimateTokens(personaMemorySection(memory ?? '') ?? '', tokenizer);
    return {
      step: options.step,
      text: composed.text,
      tokens,
      tokenizer,
      parts: [
        { name: 'instructions', tokens: instructions },
        { name: 'skills', tokens: skills },
        { name: 'memory', tokens: memoryTokens },
        { name: 'rest', tokens: Math.max(0, tokens - instructions - skills - memoryTokens) },
      ],
      skills: loaded.skills.map((skill) => ({ name: skill.name, tokens: estimateTokens(`### ${skill.name}\n\n${skill.text}`, tokenizer) })),
      warnings: [...loaded.warnings, ...(loaded.missing.length > 0 ? [`no text for skill ${loaded.missing.join(', ')}`] : [])],
    };
  }
}
