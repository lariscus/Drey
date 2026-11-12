import { describe, expect, it } from 'vitest';
import { crewOrderOf, inCrewOrder, withCrewOrder } from './crew-order';
import { parseCrewFile } from './crew-file';

const crew = [
  { id: 'ben', role: 'builder', kind: 'agent' },
  { id: 'paul', role: 'planner', kind: 'agent' },
  { id: 'you', role: 'custom', kind: 'human' },
  { id: 'ralf', role: 'reviewer', kind: 'agent' },
  { id: 'scout', role: 'custom', kind: 'agent' },
] as const;

describe('the crew order (req-258)', () => {
  it('reads the list, deduplicated; anything else reads as none', () => {
    expect(crewOrderOf('---\norder: [paul, ben, paul, 3]\n---\n')).toEqual(['paul', 'ben']);
    expect(crewOrderOf('---\norder: paul\n---\n')).toEqual([]);
    expect(crewOrderOf(null)).toEqual([]);
    expect(crewOrderOf('---\norder: [\n---\n')).toEqual([]);
  });

  it('places the listed personas as listed, the rest after them in pipeline order, the human last', () => {
    expect(inCrewOrder(crew, ['ralf', 'you', 'ben']).map((p) => p.id)).toEqual(['ralf', 'you', 'ben', 'paul', 'scout']);
    expect(inCrewOrder(crew, []).map((p) => p.id)).toEqual(['paul', 'ben', 'ralf', 'scout', 'you']);
    expect(inCrewOrder(crew, ['ghost', 'ben']).map((p) => p.id)).toEqual(['ben', 'paul', 'ralf', 'scout', 'you']);
  });

  it('writes the list in place: other keys, comments and the prose stay', () => {
    const before = '---\n# the crew\ndefault-worker: claude-code\nseeded-crew: [paul, ben]\n---\n\nOwner prose.\n';
    const out = withCrewOrder(before, ['ben', 'paul', 'you']);
    expect(out).toEqual({ ok: true, text: '---\n# the crew\ndefault-worker: claude-code\nseeded-crew: [paul, ben]\norder: [ben, paul, you]\n---\n\nOwner prose.\n' });
    if (out.ok) {
      expect(parseCrewFile(out.text).config.values).toEqual({ defaultWorker: 'claude-code' });
      expect(crewOrderOf(out.text)).toEqual(['ben', 'paul', 'you']);
    }
  });

  it('refuses a file that does not parse', () => {
    expect(withCrewOrder('---\norder: [\n---\n', ['ben']).ok).toBe(false);
  });
});
