import { describe, expect, it } from 'vitest';
import { composeInstruction, type InstructionInput } from './assignment';
import { loadDisciplineTexts } from './discipline-texts';

/** req-78: the run a red gate sent the ticket to reads what went red where, the failure, and the return. */

const D = await loadDisciplineTexts();

function input(over: Partial<InstructionInput> = {}): InstructionInput {
  return {
    disciplines: D,
    ticketId: 'T-0001',
    title: 'Add the thing',
    repo: 'drey',
    branch: 't/T-0001',
    worktreePath: 'W:/wt/T-0001',
    phase: 'active',
    description: 'It should work.',
    plan: 'Step one.',
    prompt: 'You are Paul, the planner.',
    acceptance: ['npm test'],
    repoInstructions: null,
    diffStat: null,
    gateFailure: null,
    caps: { gateFailureLines: 40, gateFailureBytes: 4_096, diffStatLines: 50, diffStatBytes: 4_096 },
    ...over,
  };
}

const ENTRIES = ['paul', 'ben', 'ralf', 'tessa(on-red paul)', 'you'];

describe('the brief of a red gate’s target (req-78)', () => {
  it('names the red position, carries the failure, the question for decisions and the return', () => {
    const text = composeInstruction(input({ chain: { at: 1, length: 5, entries: ENTRIES, redBack: { from: 4, persona: 'tessa', failure: 'npm test\nFAIL search.spec.ts' } } })).text;
    expect(text).toContain('Sent back by a red gate: the machine gate of position 4 (tessa) went red, and that position sends the ticket back to you.');
    expect(text).toContain('ask with `QUESTION:`');
    expect(text).toContain('the ticket goes straight back to position 4; the positions between are not run again.');
    expect(text).toContain('FAIL search.spec.ts');
    expect(text).toContain('4. tessa(on-red paul)');
  });

  it('points at the status log when the failure is no longer known, and says nothing without a red gate', () => {
    expect(composeInstruction(input({ chain: { at: 1, length: 5, entries: ENTRIES, redBack: { from: 4, persona: 'tessa', failure: null } } })).text).toContain("The failure is in the ticket's status log.");
    expect(composeInstruction(input({ chain: { at: 1, length: 5, entries: ENTRIES } })).text).not.toContain('Sent back by a red gate');
  });
});
