import { heldCountsOf, inOrderOf, laneIdsOf, movedBy, movedTo, sameOrder } from './crew-order';

const lane = (persona: string, kind = 'agent'): object => ({ persona, title: persona, kind, color: '', parallel: null, min: 0 });
const ticket = (id: string, holder: string): object => ({ id, hold: { holder, why: 'entry', position: 1, length: 2, chain: [holder, 'you'] } });

describe('crew order', () => {
  it('reads the crew order off the lanes, null off a phase board', () => {
    expect(laneIdsOf({ lanes: [lane('ben'), lane('ralf'), lane('you', 'human')] })).toEqual(['ben', 'ralf', 'you']);
    expect(laneIdsOf({ columns: [] })).toBeNull();
    expect(laneIdsOf(null)).toBeNull();
  });

  it('counts what each persona holds from the tickets holds', () => {
    const board = { columns: [{ tickets: [ticket('T-1', 'ben'), ticket('T-2', 'ben'), { id: 'T-3' }] }, { tickets: [ticket('T-4', 'you')] }] };
    const held = heldCountsOf(board);
    expect(held.get('ben')).toBe(2);
    expect(held.get('you')).toBe(1);
    expect(held.has('ralf')).toBe(false);
    expect(heldCountsOf(null).size).toBe(0);
  });

  it('puts the listed personas first, the rest after in their own order', () => {
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
    expect(inOrderOf(items, ['c', 'a']).map((p) => p.id)).toEqual(['c', 'a', 'b', 'd']);
  });

  it('moves one persona to a place or a step', () => {
    expect(movedTo(['a', 'b', 'c'], 'c', 0)).toEqual(['c', 'a', 'b']);
    expect(movedTo(['a', 'b', 'c'], 'a', 9)).toEqual(['b', 'c', 'a']);
    expect(movedBy(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(movedBy(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c']);
    expect(movedBy(['a', 'b', 'c'], 'x', 1)).toEqual(['a', 'b', 'c']);
    expect(sameOrder(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(sameOrder(['a', 'b'], ['b', 'a'])).toBe(false);
  });
});
