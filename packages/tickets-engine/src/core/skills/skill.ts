import { parseDocument } from 'yaml';
import { splitFrontmatter } from '../../../../../shared/frontmatter';

/**
 * Skills as Agent Skills (req-172, R8): the pure half. A skill is a folder
 * `<name>/SKILL.md` — frontmatter `name:` and `description:` (optional
 * `license`, `allowed-tools`, `metadata`) over a Markdown body — in the
 * shared home or a persona's own. Anthropic's own skills (`~/.claude/skills`)
 * parse here unchanged, folded `description: >` blocks and Windows line
 * ends included. Nothing in this file touches a disk.
 */

export const SKILL_FILE = 'SKILL.md';
export const SHARED_SKILLS_DIR = 'tickets/_meta/skills';
const PERSONAS_DIR = 'tickets/_meta/personas';

/** What a folder may be called: the name the persona's `skills:` list uses, never a path. */
const SKILL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
/** The description line a generated frontmatter carries stops here. */
const GENERATED_DESCRIPTION_MAX = 200;
const NL = '\n';

export function isSkillName(name: string): boolean {
  return SKILL_NAME.test(name);
}

export function sharedSkillDir(name: string): string {
  return `${SHARED_SKILLS_DIR}/${name}`;
}

export function ownSkillsDir(personaId: string): string {
  return `${PERSONAS_DIR}/${personaId}/skills`;
}

export function ownSkillDir(personaId: string, name: string): string {
  return `${ownSkillsDir(personaId)}/${name}`;
}

/** A skill file's frontmatter as the format defines it. */
export interface SkillFrontmatter {
  readonly name: string | null;
  readonly description: string | null;
  readonly license: string | null;
  readonly allowedTools: readonly string[];
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface ParsedSkill extends SkillFrontmatter {
  /** The Markdown after the frontmatter, trimmed — what a run loads. */
  readonly body: string;
  /** The file had a frontmatter fence that parsed as a YAML map. */
  readonly hasFrontmatter: boolean;
}

function asText(value: unknown): string | null {
  if (typeof value === 'string') {
    return value.trim() === '' ? null : value.trim();
  }
  return typeof value === 'number' || typeof value === 'boolean' ? String(value) : null;
}

/** `allowed-tools` is a space-separated string in the format; a YAML list is read too. */
function toolsOf(value: unknown): readonly string[] {
  const parts = Array.isArray(value) ? value.map((v) => asText(v) ?? '') : typeof value === 'string' ? value.split(/[\s,]+/) : [];
  return parts.filter((part) => part !== '');
}

function frontmatterMap(yamlText: string | null): Record<string, unknown> | null {
  if (yamlText === null) {
    return null;
  }
  const doc = parseDocument(yamlText);
  if (doc.errors.length > 0) {
    return null;
  }
  const js: unknown = doc.toJS();
  return js !== null && typeof js === 'object' && !Array.isArray(js) ? (js as Record<string, unknown>) : null;
}

/** Windows line ends read like Unix ones: the frontmatter fence is newline-anchored. */
export function normalizeSkillText(text: string): string {
  return text.replace(/^﻿/, '').replace(/\r\n?/g, NL);
}

/** Parses a `SKILL.md`: tolerant — a file with no or broken frontmatter is all body. */
export function parseSkillMarkdown(text: string): ParsedSkill {
  const normal = normalizeSkillText(text);
  const { yamlText, body, hadFence } = splitFrontmatter(normal);
  const map = frontmatterMap(yamlText);
  if (!hadFence || map === null) {
    return { name: null, description: null, license: null, allowedTools: [], metadata: {}, body: normal.trim(), hasFrontmatter: false };
  }
  const raw = map['metadata'];
  const metadata = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    name: asText(map['name']),
    description: asText(map['description']),
    license: asText(map['license']),
    allowedTools: toolsOf(map['allowed-tools']),
    metadata,
    body: body.trim(),
    hasFrontmatter: true,
  };
}

/** A frontmatter fence whose YAML does not parse as a map: a file to refuse, not to read as all body. */
export function frontmatterBroken(text: string): boolean {
  const { yamlText, hadFence } = splitFrontmatter(normalizeSkillText(text));
  return hadFence && frontmatterMap(yamlText) === null;
}

/** The frontmatter name when it differs from the folder (the folder wins; the caller logs it). */
export function declaredNameOf(parsed: SkillFrontmatter, folderName: string): string | null {
  return parsed.name !== null && parsed.name !== folderName ? parsed.name : null;
}

/** The first line worth calling a description: a heading's words, else the first line of text. */
export function descriptionFromBody(body: string): string {
  for (const raw of body.split(NL)) {
    const line = raw.replace(/^#+\s*/, '').replace(/[*_`>]/g, '').trim();
    if (line !== '') {
      return line.length > GENERATED_DESCRIPTION_MAX ? `${line.slice(0, GENERATED_DESCRIPTION_MAX - 1).trimEnd()}…` : line;
    }
  }
  return '';
}

/** A one-line double-quoted YAML scalar. */
function quoted(text: string): string {
  const slash = String.fromCharCode(92);
  return `"${text.replaceAll(slash, slash + slash).replaceAll('"', `${slash}"`).replaceAll(NL, ' ')}"`;
}

/**
 * The `SKILL.md` a text becomes when it lacks the format's two required keys
 * — the one-time migration of a legacy flat `<name>.md`, and an uploaded
 * bare Markdown file. The old text stays byte for byte as the body; a text
 * that already carries a frontmatter keeps it and only gains the keys it
 * lacks (`name` from the folder, `description` from the first line).
 */
export function migratedSkillText(name: string, flatText: string): string {
  const text = normalizeSkillText(flatText);
  const parsed = parseSkillMarkdown(text);
  const missing: string[] = [];
  if (parsed.name === null) {
    missing.push(`name: ${name}`);
  }
  if (parsed.description === null) {
    const description = descriptionFromBody(parsed.body);
    missing.push(`description: ${quoted(description === '' ? name : description)}`);
  }
  if (!parsed.hasFrontmatter) {
    return ['---', ...missing, '---', '', text.trim(), ''].join(NL);
  }
  if (missing.length === 0) {
    return text.endsWith(NL) ? text : `${text}${NL}`;
  }
  const { yamlText, body } = splitFrontmatter(text);
  const head = [...missing, yamlText ?? ''].filter((line) => line !== '').join(NL);
  return `---${NL}${head}${NL}---${NL}${body.startsWith(NL) ? body : `${NL}${body}`}`;
}
