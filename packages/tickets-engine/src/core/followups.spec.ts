import { describe, expect, it } from 'vitest';
import { MAX_FOLLOWUPS, parseFollowups } from './followups';

describe('parseFollowups', () => {
  it('reads bullets with why and priority', () => {
    const text = [
      'All green.',
      'FOLLOWUPS:',
      '- Cache the heading tree',
      '  why: the outline rebuilds it on every keystroke',
      '  priority: Low',
      '- Drop the dead export',
    ].join('\n');
    expect(parseFollowups(text)).toEqual([
      { title: 'Cache the heading tree', why: 'the outline rebuilds it on every keystroke', priority: 'low' },
      { title: 'Drop the dead export', why: '', priority: null },
    ]);
  });

  it('accepts other bullet styles and the reason key, case-insensitively', () => {
    const text = 'followups:\n* One\n  Reason: r1\n1. Two\n2) Three';
    expect(parseFollowups(text).map((d) => d.title)).toEqual(['One', 'Two', 'Three']);
    expect(parseFollowups(text)[0]!.why).toBe('r1');
  });

  it('joins wrapped detail lines into the reason', () => {
    const text = 'FOLLOWUPS:\n- One\n  why: first line\n    second line';
    expect(parseFollowups(text)[0]!.why).toBe('first line second line');
  });

  it('takes the last marker and stops at closing prose', () => {
    const text = 'FOLLOWUPS:\n- Old\nFOLLOWUPS:\n- New\n\nThat is all from me.\n- not a proposal';
    expect(parseFollowups(text).map((d) => d.title)).toEqual(['New']);
  });

  it('reads nothing from prose, from "none", or from a text without the marker', () => {
    expect(parseFollowups('Done. FOLLOWUPS: none')).toEqual([]);
    expect(parseFollowups('FOLLOWUPS: none')).toEqual([]);
    expect(parseFollowups('FOLLOWUPS:')).toEqual([]);
    expect(parseFollowups('just a message')).toEqual([]);
  });

  it('keeps titles distinct and bounds the list and the text', () => {
    const many = ['FOLLOWUPS:', '- Same', '- same', ...Array.from({ length: 9 }, (_, i) => `- Item ${String(i)}`)].join('\n');
    const parsed = parseFollowups(many);
    expect(parsed).toHaveLength(MAX_FOLLOWUPS);
    expect(parsed.filter((d) => d.title.toLowerCase() === 'same')).toHaveLength(1);
    const long = parseFollowups(`FOLLOWUPS:\n- ${'x'.repeat(300)}\n  why: ${'y'.repeat(900)}`)[0]!;
    expect(long.title.length).toBeLessThanOrEqual(120);
    expect(long.why.length).toBeLessThanOrEqual(600);
  });

  it('survives a BLOCKED line after the list', () => {
    const text = 'FOLLOWUPS:\n- One\nBLOCKED: merge conflict';
    expect(parseFollowups(text).map((d) => d.title)).toEqual(['One']);
  });
});
