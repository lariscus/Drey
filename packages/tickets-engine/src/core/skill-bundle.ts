import type { SkillErrorCode } from '../contracts/skills';
import { isSkillName, parseSkillMarkdown, SKILL_FILE } from './skill';

/**
 * The validation of an uploaded skill (req-172): a zipped folder arrives as
 * a list of files, and nothing reaches the disk before every rule here
 * holds — a path stays inside the skill's folder, the folder has a
 * `SKILL.md` whose frontmatter parses and names a description, the name is a
 * folder name, the sizes are bounded (a skill is loaded into a prompt in
 * full, so the bound is a policy, not only a safety net). Pure: the zip
 * reader and the disk are other classes.
 */

export const MAX_SKILL_FILES = 200;
export const MAX_SKILL_BYTES = 8 * 1024 * 1024;
/** A `SKILL.md` is a prompt part: past this it is refused, not truncated. */
export const MAX_SKILL_TEXT_BYTES = 256 * 1024;

export interface SkillBundleFile {
  /** Relative, `/`-separated (an archive's own names, checked here). */
  readonly path: string;
  readonly data: Uint8Array;
}

export type SkillBundleResult =
  | { readonly ok: true; readonly name: string; readonly files: readonly SkillBundleFile[] }
  | { readonly ok: false; readonly code: SkillErrorCode; readonly error: string };

const refuse = (code: SkillErrorCode, error: string): SkillBundleResult => ({ ok: false, code, error });

/** Entries a Mac or Windows zipper adds that are no part of the skill. */
function isJunk(path: string): boolean {
  const parts = path.split('/');
  return parts[0] === '__MACOSX' || parts.some((part) => part === '.DS_Store' || part === 'Thumbs.db');
}

/** Windows zippers write backslashes; a name is checked as a `/` path. */
function cleanPath(raw: string): string | null {
  const path = raw.replaceAll(String.fromCharCode(92), '/');
  const parts = path.split('/');
  const bad = path.startsWith('/') || /^[A-Za-z]:/.test(path) || path.includes('\0') || parts.some((part) => part === '..' || part === '.' || part === '');
  return bad ? null : path;
}

function cleaned(files: readonly SkillBundleFile[]): readonly SkillBundleFile[] | null {
  const out: SkillBundleFile[] = [];
  for (const file of files) {
    const path = cleanPath(file.path);
    if (path === null) {
      return null;
    }
    if (!isJunk(path)) {
      out.push({ path, data: file.data });
    }
  }
  return out;
}

/** The one top folder every file sits in, or null when `SKILL.md` is at the archive root. */
function rootOf(files: readonly SkillBundleFile[]): { readonly top: string | null } | 'mixed' | 'none' {
  if (files.some((file) => file.path === SKILL_FILE)) {
    return { top: null };
  }
  const tops = new Set(files.map((file) => file.path.split('/')[0]!));
  if (tops.size !== 1) {
    return files.length === 0 ? 'none' : 'mixed';
  }
  const top = [...tops][0]!;
  return files.some((file) => file.path === `${top}/${SKILL_FILE}`) ? { top } : 'none';
}

export function validateSkillBundle(input: readonly SkillBundleFile[], nameHint: string | null): SkillBundleResult {
  const files = cleaned(input);
  if (files === null) {
    return refuse('path_escape', 'an archive path leaves the skill folder');
  }
  if (files.length > MAX_SKILL_FILES || files.reduce((sum, file) => sum + file.data.byteLength, 0) > MAX_SKILL_BYTES) {
    return refuse('too_large', `a skill holds at most ${MAX_SKILL_FILES} files and ${MAX_SKILL_BYTES / 1024 / 1024} MiB`);
  }
  const root = rootOf(files);
  if (root === 'mixed' || root === 'none') {
    return refuse('bad_archive', root === 'mixed' ? 'the archive holds more than one top folder' : `the archive has no ${SKILL_FILE}`);
  }
  const prefix = root.top === null ? '' : `${root.top}/`;
  const inside = files.map((file) => ({ path: file.path.slice(prefix.length), data: file.data }));
  const skillFile = inside.find((file) => file.path === SKILL_FILE)!;
  if (skillFile.data.byteLength > MAX_SKILL_TEXT_BYTES) {
    return refuse('too_large', `${SKILL_FILE} is larger than ${MAX_SKILL_TEXT_BYTES / 1024} KiB`);
  }
  const parsed = parseSkillMarkdown(new TextDecoder('utf-8').decode(skillFile.data));
  if (!parsed.hasFrontmatter || parsed.description === null || parsed.body === '') {
    return refuse('bad_skill_file', `${SKILL_FILE} needs a frontmatter with a description, and a body`);
  }
  const name = nameHint ?? root.top ?? parsed.name ?? '';
  return isSkillName(name) ? { ok: true, name, files: inside } : refuse('bad_name', 'a skill folder is named with letters, digits, dots, dashes and underscores');
}
