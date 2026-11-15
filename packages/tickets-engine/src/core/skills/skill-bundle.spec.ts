import { describe, expect, it } from 'vitest';
import { MAX_SKILL_FILES, MAX_SKILL_TEXT_BYTES, validateSkillBundle, type SkillBundleFile } from './skill-bundle';

const enc = new TextEncoder();
const SKILL = '---\nname: review\ndescription: Reviews a diff\n---\n\nLook at the diff.\n';

const file = (path: string, text: string = 'x'): SkillBundleFile => ({ path, data: enc.encode(text) });

describe('validateSkillBundle', () => {
  it('accepts a SKILL.md at the archive root and keeps the files beside it', () => {
    const result = validateSkillBundle([file('SKILL.md', SKILL), file('scripts/run.sh', '#!/bin/sh'), file('references/a.md')], 'review');
    expect(result).toMatchObject({ ok: true, name: 'review' });
    expect(result.ok && result.files.map((f) => f.path)).toEqual(['SKILL.md', 'scripts/run.sh', 'references/a.md']);
  });

  it('accepts a skill inside one top folder, which names it unless a name is given', () => {
    const files = [file('review-v2/SKILL.md', SKILL), file('review-v2/scripts/run.sh')];
    const result = validateSkillBundle(files, null);
    expect(result).toMatchObject({ ok: true, name: 'review-v2' });
    expect(result.ok && result.files.map((f) => f.path)).toEqual(['SKILL.md', 'scripts/run.sh']);
    expect(validateSkillBundle(files, 'other')).toMatchObject({ ok: true, name: 'other' });
  });

  it('names a root-level skill after its frontmatter when no name is given', () => {
    expect(validateSkillBundle([file('SKILL.md', SKILL)], null)).toMatchObject({ ok: true, name: 'review' });
  });

  it('refuses a path that escapes the folder: parent, absolute, drive, backslash escape, NUL', () => {
    for (const bad of ['../x', 'a/../../x', '/etc/passwd', 'C:/x', 'C:\\x', '..\\x', 'a\0b']) {
      const result = validateSkillBundle([file('SKILL.md', SKILL), file(bad)], 'review');
      expect(result, bad).toMatchObject({ ok: false, code: 'path_escape' });
    }
  });

  it('reads Windows backslashes as folder separators', () => {
    const result = validateSkillBundle([file('review\\SKILL.md', SKILL), file('review\\scripts\\run.sh')], null);
    expect(result.ok && result.files.map((f) => f.path)).toEqual(['SKILL.md', 'scripts/run.sh']);
  });

  it('drops the junk a Mac or Windows zipper adds', () => {
    const result = validateSkillBundle([file('SKILL.md', SKILL), file('__MACOSX/._SKILL.md'), file('.DS_Store'), file('scripts/Thumbs.db')], 'review');
    expect(result.ok && result.files.map((f) => f.path)).toEqual(['SKILL.md']);
  });

  it('refuses an archive without a SKILL.md or with more than one top folder', () => {
    expect(validateSkillBundle([file('readme.md')], 'x')).toMatchObject({ ok: false, code: 'bad_archive' });
    expect(validateSkillBundle([file('a/SKILL.md', SKILL), file('b/x')], 'x')).toMatchObject({ ok: false, code: 'bad_archive' });
    expect(validateSkillBundle([], 'x')).toMatchObject({ ok: false, code: 'bad_archive' });
  });

  it('refuses a SKILL.md with no frontmatter, no description or no body', () => {
    for (const text of ['just text', '---\nname: a\n---\nbody', '---\nname: a\ndescription: d\n---\n', '---\nname: [broken\n---\nbody']) {
      expect(validateSkillBundle([file('SKILL.md', text)], 'a'), text).toMatchObject({ ok: false, code: 'bad_skill_file' });
    }
  });

  it('refuses a name that is not a folder name', () => {
    expect(validateSkillBundle([file('SKILL.md', SKILL)], 'a/b')).toMatchObject({ ok: false, code: 'bad_name' });
    expect(validateSkillBundle([file('SKILL.md', '---\nname: "bad name!"\ndescription: d\n---\nbody')], null)).toMatchObject({ ok: false, code: 'bad_name' });
  });

  it('refuses too many files, too many bytes and an oversized SKILL.md', () => {
    const many = Array.from({ length: MAX_SKILL_FILES + 1 }, (_, i) => file(`f${i}.txt`));
    expect(validateSkillBundle([file('SKILL.md', SKILL), ...many], 'a')).toMatchObject({ ok: false, code: 'too_large' });
    const big = { path: 'big.bin', data: new Uint8Array(9 * 1024 * 1024) };
    expect(validateSkillBundle([file('SKILL.md', SKILL), big], 'a')).toMatchObject({ ok: false, code: 'too_large' });
    const longText = `---\nname: a\ndescription: d\n---\n${'x'.repeat(MAX_SKILL_TEXT_BYTES)}`;
    expect(validateSkillBundle([file('SKILL.md', longText)], 'a')).toMatchObject({ ok: false, code: 'too_large' });
  });
});
