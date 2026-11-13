import { describe, expect, it } from 'vitest';
import { composeInstruction, composeScoutInstruction, type InstructionInput } from './assignment';
import { loadDisciplineTexts } from './discipline-texts';

/** req-282 (ADR-0097 later change): the project's purpose rides the brief's stable head as `## Project`. */

const D = await loadDisciplineTexts();
const PROJECT = { name: 'Drey', purpose: 'A local note app and its Crew.' };

function input(over: Partial<InstructionInput> = {}): InstructionInput {
  return {
    disciplines: D,
    ticketId: 'T-0001',
    title: 'Add the thing',
    repo: 'drey',
    branch: 't/T-0001',
    worktreePath: 'W:/wt/T-0001',
    phase: 'building',
    description: 'It should work.',
    plan: 'Step one.',
    prompt: 'You are the build step.',
    acceptance: ['npm test'],
    repoInstructions: 'Repo rules.',
    diffStat: null,
    gateFailure: null,
    caps: { gateFailureLines: 40, gateFailureBytes: 4_096, diffStatLines: 50, diffStatBytes: 4_096 },
    ...over,
  };
}

describe('the brief and the project', () => {
  it('carries the purpose as ## Project after the prompt and before ## Plan, and in the stable digest input', () => {
    const composed = composeInstruction(input({ project: PROJECT }));
    const section = '## Project\n\nThis ticket belongs to the project "Drey".\n\nA local note app and its Crew.';
    expect(composed.text).toContain(section);
    expect(composed.text.indexOf('You are the build step.')).toBeLessThan(composed.text.indexOf(section));
    expect(composed.text.indexOf(section)).toBeLessThan(composed.text.indexOf('## Plan'));
    expect(composed.stable).toContain('A local note app and its Crew.');
    expect(composed.continuation).not.toContain('## Project');
  });

  it('leaves the brief byte-identical for an Unassigned ticket or a project without a purpose', () => {
    const plain = composeInstruction(input());
    expect(composeInstruction(input({ project: null }))).toEqual(plain);
    expect(composeInstruction(input({ project: { name: 'Drey', purpose: '  \n' } }))).toEqual(plain);
    expect(plain.text).not.toContain('## Project');
  });

  it('rides the scout brief too', () => {
    const scout = composeScoutInstruction({
      disciplines: D,
      ticketId: 'T-0002',
      title: 'Look around',
      readGround: 'R:/drey',
      repoName: 'drey',
      ticketFile: 'V:/vault/T-0002.md',
      phase: 'scouting',
      description: 'What is there?',
      plan: null,
      prompt: 'You are the scout.',
      repoInstructions: null,
      project: PROJECT,
    });
    expect(scout.text).toContain('This ticket belongs to the project "Drey".');
  });
});
