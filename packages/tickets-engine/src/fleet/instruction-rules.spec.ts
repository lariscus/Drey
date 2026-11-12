import { describe, expect, it } from 'vitest';
import { composeInstruction, composeScoutInstruction, type InstructionInput } from './assignment';
import { loadDisciplineTexts } from './discipline-texts';

/**
 * req-280 (T2): the shared rules each come from one discipline file, and
 * the composer picks them by run kind — a step prompt carries its role
 * only. The real shipped texts, so a brief here is the bytes a run sends.
 */

const D = await loadDisciplineTexts();

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
    plan: null,
    prompt: 'You are the build step.',
    acceptance: ['npm test'],
    ticketFile: 'V:/vault/_workcopy/T-0001.ticket.md',
    repoInstructions: null,
    diffStat: null,
    gateFailure: null,
    caps: { gateFailureLines: 40, gateFailureBytes: 4_096, diffStatLines: 50, diffStatBytes: 4_096 },
    ...over,
  };
}

/** How often `part` occurs in `text`. */
function count(text: string, part: string): number {
  return text.split(part).length - 1;
}

describe('composeInstruction — the shared rules by run kind (req-280)', () => {
  it('a writing run gets working, writing, the ticket file, the handover, language, precedence, completion and signals — each once', () => {
    const text = composeInstruction(input()).text;
    for (const part of [D.working, D.writing, D.ticketFile, D.handover, D.language, D.precedence, D.completion, D.signals, D.asking]) {
      expect(count(text, part)).toBe(1);
    }
    expect(text).not.toContain(D.readOnly);
    expect(text).toContain('The machine gate runs exactly these after you finish:\n- `npm test`');
  });

  it('a review run is read-only: no writing rules, no ticket-file duties, no handover', () => {
    const text = composeInstruction(input({ reviewCheckout: 'V:/vault/_worktrees/T-0001-review' })).text;
    expect(text).toContain(D.readOnly);
    expect(text).not.toContain(D.writing);
    expect(text).not.toContain(D.ticketFile);
    expect(text).not.toContain(D.handover);
    expect(text).toContain(D.signals);
    expect(text).toContain('in the worktree at the commit you reviewed');
  });

  it('a persona instructed read-only (req-258) gets the read-only rules without a review checkout', () => {
    const text = composeInstruction(input({ personaId: 'tessa', personaRole: 'tester', readOnly: true })).text;
    expect(text).toContain(D.readOnly);
    expect(text).not.toContain(D.writing);
    expect(text).not.toContain(D.handover);
    expect(text).toContain('Work checkout: W:/wt/T-0001');
  });

  it('a dialog writes the plan but hands over nothing: no handover, the dialog discipline instead of completion', () => {
    const text = composeInstruction(input({ interactive: 'plan' })).text;
    expect(text).toContain(D.writing);
    expect(text).toContain(D.ticketFile);
    expect(text).not.toContain(D.handover);
    expect(text).toContain(D.interactive);
    expect(text).not.toContain(D.completion);
  });

  it('a resume repeats the closing (gate, completion, signals) but not the shared rules', () => {
    const composed = composeInstruction(input());
    expect(composed.continuation).toContain(D.signals);
    expect(composed.continuation).toContain(D.completion);
    expect(composed.continuation).not.toContain(D.working);
    expect(composed.continuation).not.toContain(D.writing);
  });

  it('expands the plan-format placeholder of the step prompt, whatever its source', () => {
    const text = composeInstruction(input({ prompt: 'Write the plan.\n\n{{plan-format}}' })).text;
    expect(text).not.toContain('{{plan-format}}');
    expect(text).toContain(D.fragments.planFormat);
  });

  it('the protocol markers reach the brief substituted, never as placeholders', () => {
    const text = composeInstruction(input()).text;
    expect(text).not.toContain('{{blocked}}');
    expect(text).not.toContain('{{question}}');
    expect(text).toContain('`BLOCKED: <reason in one line>`');
  });
});

describe('composeScoutInstruction — the shared rules of an exploration (req-280)', () => {
  it('gets working, language, precedence, the scout discipline and the signals — never the writing rules', () => {
    const text = composeScoutInstruction({
      disciplines: D,
      ticketId: 'T-0002',
      title: 'Why is it slow?',
      readGround: 'R:/repo',
      repoName: 'drey',
      ticketFile: 'V:/vault/_workcopy/T-0002.ticket.md',
      phase: 'prioritized',
      description: 'Find out.',
      plan: null,
      prompt: 'You are the scout.',
      repoInstructions: null,
    }).text;
    for (const part of [D.working, D.language, D.precedence, D.scout, D.signals, D.asking]) {
      expect(count(text, part)).toBe(1);
    }
    expect(text).not.toContain(D.writing);
    expect(text).not.toContain(D.handover);
  });
});
