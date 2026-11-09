import type { SkillErrorCode, SkillUploadCommand } from '../contracts/skills';
import { frontmatterBroken, isSkillName, parseSkillMarkdown, SKILL_FILE, migratedSkillText } from '../core/skill';
import { MAX_SKILL_BYTES, MAX_SKILL_TEXT_BYTES, validateSkillBundle, type SkillBundleFile } from '../core/skill-bundle';
import type { SkillFileSystem } from './skill-file-system';
import { readSkillZip } from './skill-zip';

/** What an upload wrote, for the service's commit and the reply. */
export type SkillUploadOutcome =
  | {
      readonly ok: true;
      readonly name: string;
      readonly changed: readonly string[];
      readonly deleted: readonly string[];
      readonly replaced: boolean;
    }
  | { readonly ok: false; readonly code: SkillErrorCode; readonly error: string };

type Bundle = { readonly ok: true; readonly name: string; readonly files: readonly SkillBundleFile[] } | { readonly ok: false; readonly code: SkillErrorCode; readonly error: string };

const refuse = (code: SkillErrorCode, error: string): { readonly ok: false; readonly code: SkillErrorCode; readonly error: string } => ({ ok: false, code, error });
const BASE64 = /^[A-Za-z0-9+/=\s]+$/;

/**
 * Puts an uploaded skill into a home (req-172, req-137): a `SKILL.md` text or
 * a zipped skill folder, validated before a byte is written — the
 * frontmatter parses, the name is a folder name, no path leaves the folder —
 * and refused over an existing skill of that name unless the owner said
 * overwrite. The files beside `SKILL.md` are written untouched. The commit
 * is the caller's.
 */
export class SkillUploader {
  constructor(private readonly fs: SkillFileSystem) {}

  /** `home` is the folder the skill goes into (`.../skills`). */
  async upload(home: string, cmd: SkillUploadCommand): Promise<SkillUploadOutcome> {
    const bundle = cmd.format === 'zip' ? this.fromZip(cmd) : this.fromMarkdown(cmd);
    if (!bundle.ok) {
      return bundle;
    }
    const folder = `${home}/${bundle.name}`;
    const flat = `${home}/${bundle.name}.md`;
    const existing = [...(await this.fs.files(folder)).map((file) => `${folder}/${file}`), ...((await this.fs.readText(flat)) === null ? [] : [flat])];
    if (existing.length > 0 && cmd.overwrite !== true) {
      return refuse('exists', `a skill named ${bundle.name} is already there`);
    }
    for (const rel of existing) {
      await this.fs.remove(rel);
    }
    const written = bundle.files.map((file) => `${folder}/${file.path}`);
    for (const file of bundle.files) {
      await this.fs.writeFile(`${folder}/${file.path}`, file.data);
    }
    return { ok: true, name: bundle.name, changed: written, deleted: existing.filter((rel) => !written.includes(rel)), replaced: existing.length > 0 };
  }

  private fromMarkdown(cmd: SkillUploadCommand): Bundle {
    const text = cmd.text;
    if (typeof text !== 'string' || text.trim() === '') {
      return refuse('bad_skill_file', `an upload needs the text of a ${SKILL_FILE}`);
    }
    if (new TextEncoder().encode(text).byteLength > MAX_SKILL_TEXT_BYTES) {
      return refuse('too_large', `${SKILL_FILE} is larger than ${MAX_SKILL_TEXT_BYTES / 1024} KiB`);
    }
    if (frontmatterBroken(text)) {
      return refuse('bad_skill_file', `the frontmatter of ${SKILL_FILE} does not parse`);
    }
    const name = cmd.name ?? parseSkillMarkdown(text).name ?? '';
    if (!isSkillName(name)) {
      return refuse('bad_name', 'a skill folder is named with letters, digits, dots, dashes and underscores');
    }
    if (parseSkillMarkdown(text).body === '') {
      return refuse('bad_skill_file', `${SKILL_FILE} has no body`);
    }
    return { ok: true, name, files: [{ path: SKILL_FILE, data: new TextEncoder().encode(migratedSkillText(text, name)) }] };
  }

  private fromZip(cmd: SkillUploadCommand): Bundle {
    const encoded = cmd.zipBase64;
    if (typeof encoded !== 'string' || encoded === '' || !BASE64.test(encoded)) {
      return refuse('bad_archive', 'an upload needs the zip as base64');
    }
    if (encoded.length > Math.ceil((MAX_SKILL_BYTES * 4) / 3) + 1024) {
      return refuse('too_large', `a skill zip is at most ${MAX_SKILL_BYTES / 1024 / 1024} MiB`);
    }
    let files: readonly SkillBundleFile[];
    try {
      files = readSkillZip(Buffer.from(encoded, 'base64'));
    } catch (error) {
      return refuse('bad_archive', error instanceof Error ? error.message : 'the archive does not read');
    }
    return validateSkillBundle(files, cmd.name ?? null);
  }
}
