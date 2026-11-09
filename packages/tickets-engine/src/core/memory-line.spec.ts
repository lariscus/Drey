import { describe, expect, it } from 'vitest';
import { memoryEntriesOf, ownerLessonLine, parseMemoryLine, personaLessonLine } from './memory-line';

describe('the memory line form (R4/R14, req-169)', () => {
  it("writes a persona's lesson with ticket and persona/model, the owner's with you", () => {
    expect(personaLessonLine({ date: '2026-11-09', ticket: 'T-0102', persona: 'ben', model: 'claude sonnet', lesson: 'run the repo\'s\n verify script' })).toBe(
      "- 2026-11-09 · T-0102 · ben/claude-sonnet · run the repo's verify script",
    );
    expect(ownerLessonLine('2026-11-09', 'never touch the generated client')).toBe('- 2026-11-09 · you · never touch the generated client');
  });

  it('an owner line that already names its author keeps it', () => {
    expect(ownerLessonLine('2026-11-10', '- 2026-11-09 · you · already formed')).toBe('- 2026-11-09 · you · already formed');
  });

  it('reads author and evidence back', () => {
    expect(parseMemoryLine('2026-11-09 · T-0102 · ben/zai/glm-5.3 · keep commits small')).toEqual({
      date: '2026-11-09',
      ticket: 'T-0102',
      author: { kind: 'persona', persona: 'ben', model: 'zai/glm-5.3' },
      lesson: 'keep commits small',
    });
    expect(parseMemoryLine('2026-11-09 · you · ask before renaming')).toEqual({ date: '2026-11-09', ticket: null, author: { kind: 'owner' }, lesson: 'ask before renaming' });
  });

  it('older lines stay readable with an unknown author — nothing is rewritten', () => {
    expect(parseMemoryLine('2026-11-01 · T-0102 · handed-over · 1200 tokens')).toEqual({
      date: '2026-11-01',
      ticket: 'T-0102',
      author: { kind: 'unknown' },
      lesson: 'handed-over · 1200 tokens',
    });
    expect(parseMemoryLine('a hand note')).toEqual({ date: null, ticket: null, author: { kind: 'unknown' }, lesson: 'a hand note' });
  });

  it('lists the file entries without bullet and pin marker', () => {
    expect(memoryEntriesOf('# Memory\r\n\r\n- one [pinned]\r\ntwo\r\n')).toEqual([
      { text: 'one', pinned: true },
      { text: 'two', pinned: false },
    ]);
  });
});
