import { describe, expect, it } from 'vitest';
import { answersFromText, answersText, formText } from './question-forms';

describe('question forms — what the owner answers', () => {
  const pick = { key: 'q0', header: 'Merge', question: 'How?', options: [{ label: 'Rebase' }, { label: 'Merge' }], multiple: false };
  const many = { key: 'q1', header: 'Checks', question: 'Which?', options: [{ label: 'lint' }, { label: 'tests' }], multiple: true };

  it('maps a typed answer to a choice by number or label, else keeps the words', () => {
    expect(answersFromText([pick], '2')).toEqual({ q0: 'Merge' });
    expect(answersFromText([pick], 'rebase')).toEqual({ q0: 'Rebase' });
    expect(answersFromText([pick], 'squash it, please')).toEqual({ q0: 'squash it, please' });
  });

  it('takes one line per question, commas for a multiple choice', () => {
    expect(answersFromText([pick, many], '1\n1, tests')).toEqual({ q0: 'Rebase', q1: ['lint', 'tests'] });
    expect(answersFromText([pick, many], '1')).toEqual({ q0: 'Rebase' });
  });

  it('says the questions and the answers in one line each', () => {
    expect(formText([pick])).toBe('How?');
    expect(formText([pick, many])).toBe('How? (+1 more)');
    expect(answersText([pick], { q0: 'Rebase' })).toBe('Rebase');
    expect(answersText([pick, many], { q1: ['lint'] })).toBe('Merge: —; Checks: lint');
  });
});
