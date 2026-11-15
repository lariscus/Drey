import { describe, expect, it } from 'vitest';
import { parseSkillSources, recordId, skillSourcesText, type SkillSourceRecord } from './skill-sources-file';

const ACME: SkillSourceRecord = { repo: 'github.com/acme/skills', path: '', ref: 'v1.4', commit: 'a'.repeat(40), fetched: '2026-11-13T09:12:00.000Z', skills: ['angular-standalone', 'playwright-e2e'] };

describe('skill-sources.md', () => {
  it('writes the sources as frontmatter and reads them back, the owner\'s prose kept', () => {
    const text = skillSourcesText([ACME, { ...ACME, path: 'skills/e2e', skills: ['e2e'] }], 'My notes.\n');
    expect(text.startsWith('---\nsources:\n')).toBe(true);
    const parsed = parseSkillSources(text);
    expect(parsed.sources).toEqual([ACME, { ...ACME, path: 'skills/e2e', skills: ['e2e'] }]);
    expect(parsed.prose).toBe('My notes.\n');
    expect(parsed.warnings).toEqual([]);
  });

  it('reads no file as no sources, with the default prose', () => {
    const parsed = parseSkillSources(null);
    expect(parsed.sources).toEqual([]);
    expect(parsed.prose).toContain('GitHub sources');
  });

  it('drops an entry that does not read and a second entry of one source, with a warning', () => {
    const text = ['---', 'sources:', '  - { repo: github.com/acme/skills, path: "", ref: v1.4, commit: ' + 'a'.repeat(40) + ', skills: [b, a, a, "../x"] }', '  - { repo: gitlab.com/x/y, ref: main, commit: abcdef1 }', '  - { repo: acme/skills, ref: main, commit: bbbbbbb }', '---', ''].join('\r\n');
    const parsed = parseSkillSources(text);
    expect(parsed.sources).toHaveLength(1);
    expect(parsed.sources[0]!.skills).toEqual(['a', 'b']);
    expect(parsed.warnings).toEqual(['skill-sources.md: source 2 needs a github.com repo, a ref and a commit']);
  });

  it('warns on YAML that does not parse', () => {
    expect(parseSkillSources('---\nsources: [\n---\n').warnings).toEqual(['skill-sources.md does not parse']);
  });

  it('names a record by its repository and folder', () => {
    expect(recordId(ACME)).toBe('github.com/acme/skills');
  });
});
