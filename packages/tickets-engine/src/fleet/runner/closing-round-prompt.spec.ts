import { describe, expect, it } from 'vitest';
import { CLOSING_LESSON_MAX, closingRoundPrompt, parseClosingAnswer, type ClosingRoundFacts } from './closing-round-prompt';

const FACTS: ClosingRoundFacts = {
  ticketId: 'T-0102',
  gate: 'red',
  gateFailure: 'npm run verify:unit — 3 failed',
  signals: ['red-gate', 'retry', 'steer', 'cost', 'friction'],
  steerCount: 2,
  costUsd: 4.2,
  typicalCostUsd: 0.9,
  friction: 'no test command in the brief',
};

describe('closingRoundPrompt (req-169)', () => {
  it('names the verdict and one line per signal, then the one JSON shape', () => {
    const prompt = closingRoundPrompt(FACTS);
    expect(prompt).toContain('The step on T-0102 is over: the machine gate is red.');
    expect(prompt).toContain('- the machine gate failed: npm run verify:unit — 3 failed');
    expect(prompt).toContain('- this run repeated a step whose previous run failed its gate');
    expect(prompt).toContain('- the owner stepped in 2 times while you worked');
    expect(prompt).toContain("- it cost $4.20; this persona's typical run costs $0.90");
    expect(prompt).toContain('- you reported friction: "no test command in the brief"');
    expect(prompt).toContain('{"finding":{"cause":"model|prompt|task|environment","text":"..."},"friction":"...","lesson":"...","proposal":null}');
  });

  it('asks only for the signals raised', () => {
    const prompt = closingRoundPrompt({ ...FACTS, gate: 'green', signals: ['steer'], steerCount: 1 });
    expect(prompt).toContain('- the owner stepped in 1 time while you worked');
    expect(prompt).not.toContain('machine gate failed');
  });
});

describe('parseClosingAnswer (req-169)', () => {
  it('reads the object, fences and prose around it tolerated', () => {
    const answer = parseClosingAnswer('Sure:\n```json\n{"finding":{"cause":"model","text":"lost track of the diff"},"friction":"none","lesson":"re-read the diff before the gate","proposal":{"target":"models.default","title":"Try opus","content":"opus"}}\n```');
    expect(answer).toEqual({
      finding: { cause: 'model', text: 'lost track of the diff' },
      friction: null,
      lesson: 're-read the diff before the gate',
      proposal: { target: 'models.default', title: 'Try opus', content: 'opus' },
    });
  });

  it('reads a prompt.md proposal as edits, and refuses one that carries a whole text instead (req-280)', () => {
    const edits = parseClosingAnswer('{"proposal":{"target":"prompt.md","title":"Read the plan first","edits":[{"old":"Orient first.","new":"Read the plan first."}]}}');
    expect(edits?.proposal).toEqual({ target: 'prompt.md', title: 'Read the plan first', content: '', edits: [{ old: 'Orient first.', new: 'Read the plan first.' }] });
    expect(parseClosingAnswer('{"proposal":{"target":"prompt.md","title":"t","content":"the whole new prompt"}}')?.proposal).toBeNull();
  });

  it('says when no gate ran (a blocked step, a scout run)', () => {
    expect(closingRoundPrompt({ ticketId: 'T-1', gate: 'none', gateFailure: null, signals: ['friction'], steerCount: 0, costUsd: null, typicalCostUsd: null, friction: 'x' })).toContain('The step on T-1 is over: no machine gate ran.');
  });

  it('drops what does not validate instead of guessing', () => {
    expect(parseClosingAnswer('no json here')).toBeNull();
    expect(parseClosingAnswer('{"finding":{"cause":"luck","text":"x"},"proposal":{"target":"skill","title":"t","content":"c"}}')).toEqual({
      finding: null,
      friction: null,
      lesson: null,
      proposal: null,
    });
  });

  it('caps the lesson at one bounded line', () => {
    const answer = parseClosingAnswer(JSON.stringify({ lesson: `a\n${'x'.repeat(500)}` }));
    expect(answer?.lesson?.length).toBe(CLOSING_LESSON_MAX);
    expect(answer?.lesson?.includes('\n')).toBe(false);
  });
});
