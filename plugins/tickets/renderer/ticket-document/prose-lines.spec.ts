import { describe, expect, it } from 'vitest';
import { logStampsOf, wrappedParagraphsOf } from './prose-lines';

const joined = (text: string, start = 0): string[] =>
  wrappedParagraphsOf(text, start).map((paragraph) => {
    let out = '';
    let at = paragraph.from;
    for (const soft of paragraph.breaks) {
      out += `${text.slice(at, soft.from)} `;
      at = soft.to;
    }
    return out + text.slice(at, paragraph.to);
  });

describe('wrappedParagraphsOf', () => {
  it('joins a paragraph the file wraps into one line of prose', () => {
    const text = '## Description\n\nSave the page.\nRelated: ADR-0042 has no bookmark management — the\nproposed sync is dropped.\n\nSource: roadmap.\n';
    expect(joined(text)).toEqual(['Save the page. Related: ADR-0042 has no bookmark management — the proposed sync is dropped.']);
  });

  it('keeps the CRLF of the file inside the break and skips the next line’s indent', () => {
    const text = 'one\r\n  two\r\n';
    const [paragraph] = wrappedParagraphsOf(text);
    expect(paragraph!.breaks).toEqual([{ from: 3, to: 7 }]);
    expect(joined(text)).toEqual(['one two']);
  });

  it('never joins a heading, a list item, a quote, a table, a rule, a fence or a hard break', () => {
    const text = [
      '# Title',
      'text under the title',
      '- item one',
      '- item two',
      '> quote',
      '| a | b |',
      '| - | - |',
      'hard break  ',
      'after the break',
      '```',
      'code one',
      'code two',
      '```',
      'last',
      '***',
    ].join('\n');
    expect(joined(text)).toEqual([]);
  });

  it('lets a list item run on into its lazy continuation', () => {
    expect(joined('- a long item\n  that wraps\n- next')).toEqual(['- a long item that wraps']);
  });

  it('leaves the frontmatter alone', () => {
    const text = '---\nid: t-1\ntitle: x\n---\nbody one\nbody two\n';
    expect(joined(text, text.indexOf('body'))).toEqual(['body one body two']);
  });
});

describe('logStampsOf', () => {
  it('finds each entry’s quoted or bare stamp inside the Log', () => {
    const text = "## Log\r\n\r\n- '2026-10-18T11:12:12Z' agent@legion:opencode — created in inbox\r\n- 2026-10-19T08:00:00Z you — moved\r\n- no stamp here\r\n";
    const range = { from: text.indexOf('\n'), to: text.length };
    const stamps = logStampsOf(text, range);
    expect(stamps.map((stamp) => text.slice(stamp.from, stamp.to))).toEqual(["'2026-10-18T11:12:12Z'", '2026-10-19T08:00:00Z']);
    expect(stamps[0]!.at.toISOString()).toBe('2026-10-18T11:12:12.000Z');
  });

  it('skips a date that does not parse', () => {
    const text = "- '2026-13-45T99:99:99Z' x — y";
    expect(logStampsOf(text, { from: 0, to: text.length })).toEqual([]);
  });
});
