/**
 * The live reading of a streamed Mission Control envelope (D-76): the
 * `say` and `thought` strings as far as the fragments have arrived.
 */
import { describe, expect, it } from 'vitest';
import { liveEnvelopeOf } from './live-envelope';

const FULL = '{"say": "Both are queued.", "thought": "Ben is free, so the second one can start.\\nNo clash.", "commands": [{"kind":"transition","id":"T-1"}]}';

describe('liveEnvelopeOf', () => {
  it('reads a finished envelope', () => {
    expect(liveEnvelopeOf(FULL)).toEqual({
      say: 'Both are queued.',
      thought: 'Ben is free, so the second one can start.\nNo clash.',
    });
  });

  it('grows with every fragment: the say first, then the thought while it is still open', () => {
    const at = (text: string): ReturnType<typeof liveEnvelopeOf> => liveEnvelopeOf(text);
    expect(at('{"sa')).toEqual({ say: '', thought: '' });
    expect(at('{"say": "Both are qu')).toEqual({ say: 'Both are qu', thought: '' });
    expect(at('{"say": "Both are queued.", "thought": "Ben is')).toEqual({ say: 'Both are queued.', thought: 'Ben is' });
    // Every prefix of the reply reads without a throw, and the thought only ever grows.
    let seen = '';
    for (let end = 0; end <= FULL.length; end++) {
      const { thought } = at(FULL.slice(0, end));
      expect(thought.startsWith(seen)).toBe(true);
      seen = thought;
    }
  });

  it('decodes escapes, and waits for the rest of a half-arrived one', () => {
    expect(liveEnvelopeOf('{"say": "a \\"b\\" \\u00e4 c\\\\').say).toBe('a "b" ä c\\');
    expect(liveEnvelopeOf('{"say": "x\\').say).toBe('x');
    expect(liveEnvelopeOf('{"say": "x\\u00').say).toBe('x');
  });

  it('skips the fields it does not show, nested ones included', () => {
    const text = '{"commands": [{"kind": "x", "say": "not this"}], "say": "yes", "plan": "{no}"}';
    expect(liveEnvelopeOf(text)).toEqual({ say: 'yes', thought: '' });
  });

  it('reads through a code fence and text in front of the brace', () => {
    expect(liveEnvelopeOf('```json\n{"say": "fenced"}').say).toBe('fenced');
    expect(liveEnvelopeOf('Sure. {"say": "after chatter"}').say).toBe('after chatter');
    expect(liveEnvelopeOf('```json\n').say).toBe('');
  });

  it("takes a reply that is no envelope as plain say (the bridge's own sentences)", () => {
    expect(liveEnvelopeOf('I ran out of rounds before I could answer.')).toEqual({
      say: 'I ran out of rounds before I could answer.',
      thought: '',
    });
    expect(liveEnvelopeOf('')).toEqual({ say: '', thought: '' });
  });
});
