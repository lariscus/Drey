import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { withChainAndCursor } from './chain-move';

const LEGACY = '---\nid: T-1\ntitle: x\nchain: [ben, you]\nat: 2\n---\nbody\n';

describe('the chain and cursor of a persona board move (req-270)', () => {
  it('replaces the whole chain and the cursor and keeps every other key and the body', () => {
    const out = withChainAndCursor(LEGACY, ['paul:shape', 'paul', 'bob', 'you'], 3);
    expect(out).toBe('---\nid: T-1\ntitle: x\nchain: [paul:shape, paul, bob, you]\nat: 3\n---\nbody\n');
  });

  it('req-78: an entry with options keeps its commas inside the flow list and reads back whole', () => {
    const out = withChainAndCursor(LEGACY, ['paul', 'ben', 'tessa(notify, on-red paul)', 'you'], 2);
    const header = parse(out.split('---\n')[1]!) as { chain: string[] };
    expect(header.chain).toEqual(['paul', 'ben', 'tessa(notify, on-red paul)', 'you']);
  });

  it('adds the keys a chainless ticket lacks', () => {
    expect(withChainAndCursor('---\nid: T-1\n---\nbody\n', ['ben'], 1)).toBe('---\nid: T-1\nchain: [ben]\nat: 1\n---\nbody\n');
  });
});
