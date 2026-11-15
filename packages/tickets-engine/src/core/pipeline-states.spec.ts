import { describe, expect, it } from 'vitest';
import { parsePipeline } from './ticket-board';
import { DEFAULT_PIPELINE_TEXT, LIFECYCLE_PIPELINE_PROSE, STANDARD_FLOW_LINE } from './pipeline-states';

describe('the persona board pipeline "Initialize board" writes', () => {
  it('is the three lifecycle columns and the standard flow, nothing of a working column', () => {
    const parsed = parsePipeline(DEFAULT_PIPELINE_TEXT);
    expect(parsed.error).toBeNull();
    expect(parsed.phases.map((p) => [p.id, p.title])).toEqual([
      ['inbox', 'Inbox'],
      ['prioritized', 'Prioritized'],
      ['done', 'Done'],
    ]);
    expect(parsed.phases.every((p) => p.color === null)).toBe(true);
    expect(parsed.flow?.map((e) => e.persona)).toEqual(['paul', 'ben', 'ralf', 'tessa', 'you']);
    expect(STANDARD_FLOW_LINE).toBe('paul:shape; ben; ralf; tessa; you');
  });

  it('ends in the lifecycle prose', () => {
    expect(DEFAULT_PIPELINE_TEXT.endsWith(`---\n${LIFECYCLE_PIPELINE_PROSE}`)).toBe(true);
  });
});
