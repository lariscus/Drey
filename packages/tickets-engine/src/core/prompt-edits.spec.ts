import { describe, expect, it } from 'vitest';
import { applyPromptEdits, MAX_PROMPT_EDITS, parsePromptEdits } from './prompt-edits';

/** req-280 (T5): a persona prompt change is a set of exact edits, never a blind whole-text replacement. */

const PROMPT = '## Who Ben is\n\nBen builds.\n\n## How Ben works\n\n- He tests.\n';

describe('parsePromptEdits', () => {
  it('reads well-formed edits and folds CRLF', () => {
    expect(parsePromptEdits([{ old: 'He tests.', new: 'He tests\r\nfirst.' }])).toEqual([{ old: 'He tests.', new: 'He tests\nfirst.' }]);
  });

  it('refuses no edits, too many, an empty or unchanged old text, and non-strings', () => {
    expect(parsePromptEdits([])).toBeNull();
    expect(parsePromptEdits('He tests.')).toBeNull();
    expect(parsePromptEdits(Array.from({ length: MAX_PROMPT_EDITS + 1 }, (_, i) => ({ old: `a${i}`, new: 'b' })))).toBeNull();
    expect(parsePromptEdits([{ old: '', new: 'x' }])).toBeNull();
    expect(parsePromptEdits([{ old: 'same', new: 'same' }])).toBeNull();
    expect(parsePromptEdits([{ old: 'x', new: 3 }])).toBeNull();
  });
});

describe('applyPromptEdits', () => {
  it('applies the edits in order, keeping everything they do not quote', () => {
    const result = applyPromptEdits(PROMPT, [
      { old: 'Ben builds.', new: 'Ben builds in small commits.' },
      { old: '- He tests.', new: '- He tests.\n- He runs the gate himself.' },
    ]);
    expect(result).toEqual({ ok: true, text: '## Who Ben is\n\nBen builds in small commits.\n\n## How Ben works\n\n- He tests.\n- He runs the gate himself.\n' });
  });

  it('refuses an old text that is missing or not unique, naming the edit', () => {
    expect(applyPromptEdits(PROMPT, [{ old: 'He reviews.', new: 'x' }])).toEqual({ ok: false, error: expect.stringContaining('edit 1: its old text occurs 0 times') });
    expect(applyPromptEdits(PROMPT, [{ old: 'Ben', new: 'Bea' }])).toEqual({ ok: false, error: expect.stringContaining('occurs 3 times') });
  });

  it('takes a replacement literally ($ patterns stay text)', () => {
    expect(applyPromptEdits('cost: X', [{ old: 'X', new: '$& and $1' }])).toEqual({ ok: true, text: 'cost: $& and $1' });
  });
});
