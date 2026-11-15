import { describe, expect, it } from 'vitest';
import { parsePersonaFile } from '../core/persona/persona';
import { estimateTokens } from '../core/config/token-count';
import { composeInstruction } from '../fleet/runner/instruction';
import { previewInstructionInput } from '../fleet/runner/prompt-preview-input';
import { loadDisciplineTexts } from '../fleet/runner/discipline-texts';
import { loadCrewPrompts } from './crew-prompts';
import { PromptPreview } from './prompt-preview';
import { MemorySkillFileSystem } from './skill-file-system.fake';

/** req-279: the real shipped discipline texts — the comparison below must compose the same bytes the service loads. */
const DISCIPLINES = await loadDisciplineTexts();

const PERSONA_FILE = '---\ntitle: Ben\nrole: builder\nworker: claude-code\nmodels:\n  default: opus\n  pool: [opus]\nskills: [review, ghost]\n---\n';
const files = {
  'tickets/_meta/personas/ben/prompt.md': 'Be terse and exact.',
  'tickets/_meta/personas/ben/memory.md': '# Memory\n\n- 2026-11-01 · T-0001 · always run the linter first\n',
  'tickets/_meta/skills/review/SKILL.md': '---\nname: review\ndescription: Reviews\n---\n\nLook at the diff first.\n',
};

const ben = parsePersonaFile('ben', PERSONA_FILE);

describe('PromptPreview', () => {
  it('builds the brief with the very composer a run uses, from the persona\'s real prompt, skills and memory', async () => {
    const data = await new PromptPreview(new MemorySkillFileSystem(files)).build(ben, { step: 'build', model: null });
    const expected = composeInstruction(
      previewInstructionInput(
        { id: 'ben', role: 'builder', worker: 'claude-code', model: 'opus', prompt: files['tickets/_meta/personas/ben/prompt.md'], memory: files['tickets/_meta/personas/ben/memory.md'], skills: [{ name: 'review', text: 'Look at the diff first.' }] },
        'build',
        DISCIPLINES,
      ),
    );
    expect(data.text).toBe(expected.text);
    expect(data.text).toContain('Be terse and exact.');
    expect(data.text).toContain('## Skills');
    expect(data.text).toContain('### review\n\nLook at the diff first.');
    expect(data.text).toContain('## Memory');
    expect(data.text).toContain('The ticket sits in the "build" phase');
  });

  it('counts the text with the family of the persona\'s model and says which', async () => {
    const data = await new PromptPreview(new MemorySkillFileSystem(files)).build(ben, { step: 'build', model: null });
    expect(data.tokenizer).toEqual({ id: 'claude-estimate', family: 'anthropic', exact: false, model: 'opus' });
    expect(data.tokens).toBe(estimateTokens(data.text, data.tokenizer));
    const other = await new PromptPreview(new MemorySkillFileSystem(files)).build(ben, { step: 'build', model: 'opencode/qwen3-coder' });
    expect(other.tokenizer).toMatchObject({ id: 'openai-estimate', model: 'qwen3-coder' });
    expect(other.tokens).toBeLessThan(data.tokens);
  });

  it('splits the count into the persona prompt, the skills, the memory and the rest; the parts add up to the total', async () => {
    const data = await new PromptPreview(new MemorySkillFileSystem(files)).build(ben, { step: 'review', model: null });
    expect(data.parts.map((p) => p.name)).toEqual(['instructions', 'skills', 'memory', 'rest']);
    expect(data.parts.every((p) => p.tokens > 0)).toBe(true);
    expect(data.parts.reduce((sum, p) => sum + p.tokens, 0)).toBe(data.tokens);
    expect(data.skills).toEqual([{ name: 'review', tokens: estimateTokens('### review\n\nLook at the diff first.', data.tokenizer) }]);
  });

  it('a persona with no files still previews: the block and the memory are simply absent', async () => {
    const bare = parsePersonaFile('ben', '---\ntitle: Ben\nworker: opencode\nmodels:\n  default: glm\n---\n');
    const data = await new PromptPreview(new MemorySkillFileSystem()).build(bare, { step: 'build', model: null });
    expect(data.text).not.toContain('## Skills');
    expect(data.text).not.toContain('## Memory');
    expect(data.tokenizer.family).toBe('openai-compatible');
    expect(data.parts.slice(0, 3).map((p) => p.tokens)).toEqual([0, 0, 0]);
  });

  it('reports a selected skill that has no text instead of failing', async () => {
    const data = await new PromptPreview(new MemorySkillFileSystem(files)).build(ben, { step: 'build', model: null });
    expect(data.warnings).toEqual(['no text for skill ghost']);
  });
});

describe('PromptPreview — Mission Control\'s persona (req-281, req-296)', () => {
  const pia = parsePersonaFile('pia', '---\ntitle: Pia\nkind: mission\nrole: custom\nskills: [board-triage]\n---\n');
  const piaFiles = {
    'tickets/_meta/personas/pia/prompt.md': 'Pia steers.',
    'tickets/_meta/personas/pia/memory.md': '- Answers first.\n',
    'tickets/_meta/personas/pia/skills/board-triage/SKILL.md': '---\nname: board-triage\n---\nSort the inbox.\n',
  };

  it('previews her Mission Control system message — her part, then the mission prompt — not a run brief', async () => {
    const crew = await loadCrewPrompts();
    const data = await new PromptPreview(new MemorySkillFileSystem(piaFiles)).build(pia, { step: 'build', model: null });
    expect(data.text.startsWith('Pia steers.\n\n## Memory')).toBe(true);
    expect(data.text).toContain('### board-triage\n\nSort the inbox.');
    expect(data.text).toContain(crew.mission.trim());
    expect(data.text).not.toContain('The ticket sits in the');
  });

  it('counts her skills in the tokens at start, and the parts add up', async () => {
    const data = await new PromptPreview(new MemorySkillFileSystem(piaFiles)).build(pia, { step: 'build', model: null });
    const without = await new PromptPreview(new MemorySkillFileSystem(piaFiles)).build({ ...pia, skills: [] }, { step: 'build', model: null });
    expect(data.tokens).toBeGreaterThan(without.tokens);
    expect(data.skills.map((skill) => skill.name)).toEqual(['board-triage']);
    expect(data.parts.reduce((sum, part) => sum + part.tokens, 0)).toBe(data.tokens);
  });
});
