import { describe, expect, it } from 'vitest';
import type { TicketIssue } from '../contracts/tickets';
import { parsePlanParts, renderPlanParts, type PlanPart } from './plan-parts';
import { parseTicketPoolKeys } from './ticket-pool-keys';

describe('parseTicketPoolKeys — class, model, size, allowance (req-170)', () => {
  it('reads the valid keys; a dricket x- value arrives as text and reads the same', () => {
    const issues: TicketIssue[] = [];
    expect(parseTicketPoolKeys({ class: 'A', model: 'claude-opus-4-1', size: 'M', allowance: 2.5 }, issues)).toEqual({ class: 'heavy', model: 'claude-opus-4-1', size: 'M', allowance: 2.5 });
    expect(parseTicketPoolKeys({ class: 'Super  Heavy' }, issues)).toEqual({ class: 'super heavy' });
    expect(parseTicketPoolKeys({ allowance: '$4.20', size: 'S' }, issues)).toEqual({ allowance: 4.2, size: 'S' });
    expect(issues).toEqual([]);
  });

  it('warns on a value outside the grammar and reads it as unset', () => {
    const issues: TicketIssue[] = [];
    expect(parseTicketPoolKeys({ class: '#1', size: 'XL', allowance: 'lots' }, issues)).toEqual({});
    expect(issues.map((issue) => issue.message)).toEqual([
      'class must be a class name such as heavy or light — read as no class pin',
      'size must be S, M or L — read as no size',
      'allowance must be an amount in USD (2.50) — read as the default',
    ]);
  });
});

describe("a plan part's size (req-170)", () => {
  it('round-trips through the chapter; a bad size warns', () => {
    const parts: PlanPart[] = [
      { title: 'Hunks', done: false, persona: 'ben', reason: null, chain: [], size: 'S' },
      { title: 'Panel rows', done: false, persona: 'ben', reason: null, chain: [], size: 'L' },
    ];
    const text = `## Plan\n\n${renderPlanParts(parts)}`;
    expect(text).toContain('  size: S');
    expect(parsePlanParts(text).parts.map((part) => part.size)).toEqual(['S', 'L']);
    expect(parsePlanParts('## Plan\n\n### Parts\n\n- [ ] A\n  size: huge\n- [ ] B\n').warnings).toEqual(['part "A": size "huge" is not S, M or L']);
  });
});
