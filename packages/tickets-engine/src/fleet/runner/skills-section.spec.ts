import { describe, expect, it } from 'vitest';
import { composeInstruction } from './instruction';
import { composeFreeSessionBrief } from '../session/free-session-brief';
import { composeOneOnOneBrief } from '../session/one-on-one-brief';
import { previewInstructionInput } from './prompt-preview-input';
import { loadDisciplineTexts } from './discipline-texts';
import { skillsSection } from './skills-section';

/** req-279: the real shipped discipline texts, so the briefs here are the bytes a run sends. */
const DISCIPLINES = await loadDisciplineTexts();

const SKILLS = [
  { name: 'review', text: '  Look at the diff first.\n' },
  { name: 'git', text: 'Commit small.' },
];

const BLOCK = [
  '## Skills',
  "Your persona's skills, loaded in full. Use them where they apply.",
  '### review\n\nLook at the diff first.',
  '### git\n\nCommit small.',
].join('\n\n');

describe('skillsSection — the one ## Skills block', () => {
  it('has the exact shape of specs/classifier-spec.md: heading, lead, each skill under its name, in order', () => {
    expect(skillsSection(SKILLS)).toBe(BLOCK);
  });

  it('is absent for no skills, and a skill with a blank body is left out', () => {
    expect(skillsSection(undefined)).toBeNull();
    expect(skillsSection([])).toBeNull();
    expect(skillsSection([{ name: 'empty', text: '  ' }])).toBeNull();
    expect(skillsSection([{ name: 'empty', text: '' }, SKILLS[1]!])).toContain('### git');
    expect(skillsSection([{ name: 'empty', text: '' }, SKILLS[1]!])).not.toContain('### empty');
  });
});

/** Every session kind renders the same block (R8): the run's composer, the 1:1 and the free session. */
describe('the three session kinds carry the same block', () => {
  const persona = { id: 'ben', role: 'builder', worker: 'claude-code', model: 'opus', prompt: 'Be terse.', memory: '', skills: SKILLS };

  it("the chain run's composer puts it right behind the persona's prompt, before the plan", () => {
    const { text } = composeInstruction({ ...previewInstructionInput(persona, 'build', DISCIPLINES), plan: 'The plan.' });
    expect(text).toContain(BLOCK);
    expect(text.indexOf('Be terse.')).toBeLessThan(text.indexOf('## Skills'));
    expect(text.indexOf('## Skills')).toBeLessThan(text.indexOf('## Plan'));
  });

  it('a changed skill changes the stable digest; no skills leaves the brief without the block', () => {
    const base = composeInstruction(previewInstructionInput(persona, 'build', DISCIPLINES));
    const edited = composeInstruction(previewInstructionInput({ ...persona, skills: [{ name: 'review', text: 'Different.' }] }, 'build', DISCIPLINES));
    const none = composeInstruction(previewInstructionInput({ ...persona, skills: [] }, 'build', DISCIPLINES));
    expect(edited.stable).not.toBe(base.stable);
    expect(none.text).not.toContain('## Skills');
  });

  it('the 1:1 brief carries it', () => {
    const brief = composeOneOnOneBrief({ id: 'ben', title: 'Ben', role: 'builder', prompt: 'Be terse.', skills: SKILLS, memory: null, runs: [], conversation: [], tools: [], workingDirectory: 'E:/T' });
    expect(brief).toContain(BLOCK);
  });

  it('the free session brief carries it', () => {
    const brief = composeFreeSessionBrief({ title: 'Ben', role: 'builder', prompt: 'Be terse.', skills: SKILLS, workingDirectory: 'E:/T', permissionMode: 'read-only', ticketsVault: false });
    expect(brief).toContain(BLOCK);
  });
});
