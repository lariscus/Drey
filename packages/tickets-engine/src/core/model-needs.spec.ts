import { describe, expect, it } from 'vitest';
import type { TicketIssue } from '../contracts/tickets';
import { mergeNeeds, needsText, parseNeeds } from './model-needs';
import { parsePlanParts, renderPlanParts } from './plan-parts';
import { parseTicketPoolKeys } from './ticket-pool-keys';

describe('the needs grammar (req-178)', () => {
  it.each([
    ['image', { image: true }],
    ['image, tools', { image: true, tools: true }],
    [['image', 'context-200k'], { image: true, contextTokens: 200_000 }],
    ['context-1m; output-32k', { contextTokens: 1_000_000, outputTokens: 32_000 }],
    ['output-8192', { outputTokens: 8192 }],
    ['Image', { image: true }],
  ])('reads %j', (raw, needs) => {
    expect(parseNeeds(raw)).toEqual({ needs, unknown: [] });
  });

  it('reports a token outside the grammar and keeps the rest; nothing valid reads as no needs', () => {
    expect(parseNeeds('image, video')).toEqual({ needs: { image: true }, unknown: ['video'] });
    expect(parseNeeds('')).toEqual({ needs: null, unknown: [] });
    expect(parseNeeds(42)).toEqual({ needs: null, unknown: [] });
  });

  it('writes the canonical line that reads back the same', () => {
    const needs = { image: true, tools: true, contextTokens: 200_000, outputTokens: 1_500 };
    expect(needsText(needs)).toBe('image, tools, context-200k, output-1500');
    expect(parseNeeds(needsText(needs)).needs).toEqual(needs);
    expect(needsText(null)).toBe('');
  });

  it('merges a phase and a ticket: every capability, the larger size', () => {
    expect(mergeNeeds({ image: true, contextTokens: 100_000 }, { tools: true, contextTokens: 200_000 })).toEqual({ image: true, tools: true, contextTokens: 200_000 });
    expect(mergeNeeds(null, { image: true })).toEqual({ image: true });
    expect(mergeNeeds(undefined, null)).toBeNull();
  });
});

describe('where needs: is read (req-178)', () => {
  it('a ticket key; an unknown token warns', () => {
    const issues: TicketIssue[] = [];
    expect(parseTicketPoolKeys({ needs: 'image, context-200k' }, issues)).toEqual({ needs: { image: true, contextTokens: 200_000 } });
    expect(parseTicketPoolKeys({ needs: 'smell' }, issues)).toEqual({});
    expect(issues.map((i) => i.message)).toEqual(['needs: smell is not image, tools, context-<n> or output-<n> — left out']);
  });

  it("a plan part's detail round-trips through the chapter", () => {
    const text = `## Plan\n\n${renderPlanParts([
      { title: 'Screenshot proof', done: false, persona: 'ben', reason: null, chain: [], size: 'S', needs: { image: true } },
      { title: 'Plain', done: false, persona: null, reason: null, chain: [] },
    ])}`;
    expect(text).toContain('  needs: image');
    expect(parsePlanParts(text).parts.map((part) => part.needs ?? null)).toEqual([{ image: true }, null]);
    expect(parsePlanParts('## Plan\n\n### Parts\n\n- [ ] A\n  needs: video\n- [ ] B\n').warnings).toEqual(['part "A": need "video" is not image, tools, context-<n> or output-<n>']);
  });
});
