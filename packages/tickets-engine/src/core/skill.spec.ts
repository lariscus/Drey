import { describe, expect, it } from 'vitest';
import {
  declaredNameOf,
  descriptionFromBody,
  frontmatterBroken,
  isSkillName,
  migratedSkillText,
  normalizeSkillText,
  ownSkillDir,
  parseSkillMarkdown,
  sharedSkillDir,
} from './skill';

/** The frontmatter of the owner's own `~/.claude/skills/kimi-code/SKILL.md`: a folded `description: >` block. */
const OWNER_SKILL = [
  '---',
  'name: kimi-code',
  'description: >',
  '  Delegate a coding task to the locally installed Kimi Code CLI (`kimi`,',
  '  Moonshot AI) and review what it did. Use this whenever the user asks to',
  '  "let Kimi do it" or just says "kimi" in a coding context.',
  '---',
  '',
  '# Kimi Code',
  '',
  'Run it.',
  '',
].join('\n');

describe('parseSkillMarkdown', () => {
  it("reads the owner's real skill: name, folded description, body without the frontmatter", () => {
    const parsed = parseSkillMarkdown(OWNER_SKILL);
    expect(parsed.name).toBe('kimi-code');
    expect(parsed.description).toBe(
      'Delegate a coding task to the locally installed Kimi Code CLI (`kimi`, Moonshot AI) and review what it did. Use this whenever the user asks to "let Kimi do it" or just says "kimi" in a coding context.',
    );
    expect(parsed.body).toBe('# Kimi Code\n\nRun it.');
    expect(parsed.hasFrontmatter).toBe(true);
  });

  it('reads a Windows file (CRLF, BOM) like a Unix one', () => {
    const parsed = parseSkillMarkdown(`﻿${OWNER_SKILL.replaceAll('\n', '\r\n')}`);
    expect(parsed.name).toBe('kimi-code');
    expect(parsed.body).toBe('# Kimi Code\n\nRun it.');
  });

  it('reads the optional keys: license, allowed-tools (a string or a list), metadata', () => {
    const text = '---\nname: a\ndescription: d\nlicense: MIT\nallowed-tools: Read Grep Bash(git:*)\nmetadata:\n  author: me\n  version: "1.0"\n---\nBody';
    const parsed = parseSkillMarkdown(text);
    expect(parsed.license).toBe('MIT');
    expect(parsed.allowedTools).toEqual(['Read', 'Grep', 'Bash(git:*)']);
    expect(parsed.metadata).toEqual({ author: 'me', version: '1.0' });
    expect(parseSkillMarkdown('---\nname: a\ndescription: d\nallowed-tools:\n  - Read\n  - Edit\n---\nB').allowedTools).toEqual(['Read', 'Edit']);
  });

  it('reads a file with no frontmatter, or a broken one, as all body', () => {
    expect(parseSkillMarkdown('# Just text\n\nmore')).toMatchObject({ name: null, description: null, body: '# Just text\n\nmore', hasFrontmatter: false });
    expect(parseSkillMarkdown('---\nname: [oops\n---\nbody').hasFrontmatter).toBe(false);
    expect(parseSkillMarkdown('---\n- a\n- b\n---\nbody').hasFrontmatter).toBe(false);
  });

  it('keeps a horizontal rule further down in the body', () => {
    expect(parseSkillMarkdown('---\nname: a\ndescription: d\n---\nOne\n\n---\n\nTwo').body).toBe('One\n\n---\n\nTwo');
  });
});

describe('frontmatterBroken', () => {
  it('is true only for a fence whose YAML is not a map', () => {
    expect(frontmatterBroken('---\nname: [oops\n---\nbody')).toBe(true);
    expect(frontmatterBroken('---\n- a\n---\nbody')).toBe(true);
    expect(frontmatterBroken('---\nname: a\n---\nbody')).toBe(false);
    expect(frontmatterBroken('no fence at all')).toBe(false);
  });
});

describe('names and paths', () => {
  it('a skill name is a folder name, never a path', () => {
    for (const ok of ['a', 'code-review', 'My_Skill.v2', 'a'.repeat(64)]) {
      expect(isSkillName(ok), ok).toBe(true);
    }
    for (const bad of ['', '..', '.hidden', 'a/b', 'a\\b', '-x', 'a b', 'a'.repeat(65)]) {
      expect(isSkillName(bad), bad).toBe(false);
    }
  });

  it('the shared and the own home sit where the schema says', () => {
    expect(sharedSkillDir('x')).toBe('tickets/_meta/skills/x');
    expect(ownSkillDir('paul', 'x')).toBe('tickets/_meta/personas/paul/skills/x');
  });

  it('the frontmatter name that differs from the folder is reported; one that matches is not', () => {
    expect(declaredNameOf(parseSkillMarkdown(OWNER_SKILL), 'kimi-code')).toBeNull();
    expect(declaredNameOf(parseSkillMarkdown(OWNER_SKILL), 'kimi')).toBe('kimi-code');
    expect(declaredNameOf(parseSkillMarkdown('no frontmatter'), 'x')).toBeNull();
  });
});

describe('migratedSkillText', () => {
  it('gives a flat file a generated frontmatter and keeps its text byte for byte as the body', () => {
    const migrated = migratedSkillText('review', '# Review checklist\n\n- one\n- two\n');
    expect(migrated).toBe('---\nname: review\ndescription: "Review checklist"\n---\n\n# Review checklist\n\n- one\n- two\n');
    expect(parseSkillMarkdown(migrated).body).toBe('# Review checklist\n\n- one\n- two');
  });

  it('adds only the keys a partial frontmatter lacks and keeps the rest', () => {
    const migrated = migratedSkillText('a', '---\nlicense: MIT\n---\nUse tabs.\n');
    const parsed = parseSkillMarkdown(migrated);
    expect(parsed).toMatchObject({ name: 'a', description: 'Use tabs.', license: 'MIT', body: 'Use tabs.' });
  });

  it('leaves a complete SKILL.md as it is, and quotes a description that would break YAML', () => {
    expect(migratedSkillText('kimi-code', OWNER_SKILL)).toBe(OWNER_SKILL);
    const tricky = migratedSkillText('a', 'He said "hi": here is a \\ backslash\n');
    expect(parseSkillMarkdown(tricky).description).toBe('He said "hi": here is a \\ backslash');
  });

  it('falls back to the folder name when the text has nothing to call a description', () => {
    expect(parseSkillMarkdown(migratedSkillText('empty', '   \n')).description).toBe('empty');
  });
});

describe('descriptionFromBody', () => {
  it('takes the first heading or line, trimmed of Markdown and capped', () => {
    expect(descriptionFromBody('\n\n## **Bold** title\nrest')).toBe('Bold title');
    expect(descriptionFromBody('x'.repeat(300))).toHaveLength(200);
    expect(descriptionFromBody('')).toBe('');
  });
});

describe('normalizeSkillText', () => {
  it('makes line ends Unix and drops a BOM', () => {
    expect(normalizeSkillText('﻿a\r\nb\rc')).toBe('a\nb\nc');
  });
});
