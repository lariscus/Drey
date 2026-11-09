import { describe, expect, it } from 'vitest';
import { parseThread, threadPathFor } from './persona-thread';

/**
 * The retired persona thread (req-168): only its reader stays, for the one
 * migration into the persona's first 1:1 session. The reader forgives: a
 * broken line is skipped, never a guess (ADR-0076's asymmetric tolerance).
 */

describe('threadPathFor', () => {
  it('addresses the persona thread under the personas dir', () => {
    expect(threadPathFor('pia')).toBe('tickets/_meta/personas/pia/thread.md');
  });
});

describe('parseThread', () => {
  it('reads the owner messages back, file order', () => {
    const text = [
      '---',
      'title: "Pia"',
      "created: '2026-11-03T09:00:00.000Z'",
      '---',
      '',
      "- '2026-11-03T09:01:00.000Z' owner — first lesson",
      "- '2026-11-03T09:05:00.000Z' owner — second lesson",
      '',
    ].join('\n');
    expect(parseThread(text)).toEqual([
      { at: '2026-11-03T09:01:00.000Z', role: 'owner', text: 'first lesson' },
      { at: '2026-11-03T09:05:00.000Z', role: 'owner', text: 'second lesson' },
    ]);
  });

  it('skips broken lines and stray prose, never guesses', () => {
    const text = [
      '---',
      'title: "Pia"',
      '---',
      '',
      'hand-written prose between messages',
      '- broken line without a stamp',
      "- '2026-11-03T09:01:00.000Z' owner — the one readable message",
    ].join('\n');
    expect(parseThread(text)).toEqual([{ at: '2026-11-03T09:01:00.000Z', role: 'owner', text: 'the one readable message' }]);
  });

  it('reads a headerless file too, and an empty file as no messages', () => {
    expect(parseThread("- '2026-11-03T09:01:00.000Z' owner — only the line\n")).toEqual([
      { at: '2026-11-03T09:01:00.000Z', role: 'owner', text: 'only the line' },
    ]);
    expect(parseThread('---\ntitle: "Pia"\n---\n\n')).toEqual([]);
    expect(parseThread('')).toEqual([]);
  });
});
