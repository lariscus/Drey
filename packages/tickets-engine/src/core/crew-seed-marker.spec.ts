import { describe, expect, it } from 'vitest';
import { parseCrewFile } from './crew-file';
import { patchCrewFile } from './crew-file-write';
import { seededCrewOf, withSeededCrew } from './crew-seed-marker';

const IDS = ['paul', 'ben', 'ralf', 'tessa'];

describe('the seeded-crew marker of crew.md (req-256)', () => {
  it('reads the listed ids; anything else reads as none', () => {
    expect(seededCrewOf('---\nseeded-crew: [paul, ben]\n---\n')).toEqual(['paul', 'ben']);
    expect(seededCrewOf('---\nseeded-crew:\n  - paul\n  - " ben "\n  - 3\n---\n')).toEqual(['paul', 'ben']);
    expect(seededCrewOf('---\nseeded-crew: paul\n---\n')).toEqual([]);
    expect(seededCrewOf('---\ndefault-worker: kimi\n---\n')).toEqual([]);
    expect(seededCrewOf('---\nkey: [broken\n---\n')).toEqual([]);
    expect(seededCrewOf(null)).toEqual([]);
  });

  it('writes a fresh file with the default prose and a flow list', () => {
    const out = withSeededCrew(null, IDS);
    expect(out).toEqual({ ok: true, text: expect.stringContaining('---\nseeded-crew: [paul, ben, ralf, tessa]\n---\n') });
    if (out.ok) {
      expect(out.text).toContain("The crew's defaults and limits");
      expect(seededCrewOf(out.text)).toEqual(IDS);
    }
  });

  it('keeps the settings, their comments, the other keys and the prose of an existing file', () => {
    const before = '---\n# mine\ndefault-worker: kimi\ncaps:\n  diff-stat-lines: 12\nclosing-signals: [a, b]\n---\nOwn prose.\n';
    const out = withSeededCrew(before, IDS);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.text).toContain('# mine\ndefault-worker: kimi\ncaps:\n  diff-stat-lines: 12\n');
      expect(out.text).toContain('seeded-crew: [paul, ben, ralf, tessa]');
      expect(out.text.endsWith('---\nOwn prose.\n')).toBe(true);
      expect(parseCrewFile(out.text).config.values).toMatchObject({ defaultWorker: 'kimi', 'caps.diffStatLines': 12 });
    }
  });

  it('replaces an earlier marker without duplicating ids', () => {
    const out = withSeededCrew('---\nseeded-crew: [paul]\n---\n', ['paul', 'ben', 'paul']);
    expect(out.ok && seededCrewOf(out.text)).toEqual(['paul', 'ben']);
  });

  it('survives a settings write: patching a crew key keeps the marker', () => {
    const marked = withSeededCrew(null, IDS);
    expect(marked.ok).toBe(true);
    if (marked.ok) {
      const patched = patchCrewFile(marked.text, [{ key: 'defaultWorker', value: 'kimi' }]);
      expect(patched.ok && seededCrewOf(patched.text)).toEqual(IDS);
    }
  });

  it('refuses a file that does not parse', () => {
    expect(withSeededCrew('---\nkey: [broken\n---\n', IDS)).toMatchObject({ ok: false });
  });
});
