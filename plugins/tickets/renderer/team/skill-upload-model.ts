// i18n: catalog
/**
 * What `Add skill…` sends (req-237), pure half: a picked `SKILL.md`, a zip,
 * or a folder becomes one `skillUpload` command. The route takes a text or
 * a zip as base64, so a folder is packed here into an uncompressed zip (the
 * engine's reader takes stored entries) — the scripts and references beside
 * `SKILL.md` go up with it. The bounds are the engine's
 * (`core/skill-limits.ts`); a pick over them is refused before anything is
 * read into one buffer. DOM-free: the pick arrives as `PickedFile`s.
 */
import type { SkillErrorCode, SkillUploadCommand } from '../../../../packages/tickets-engine/src/contracts/skills';
import { MAX_SKILL_BYTES, MAX_SKILL_FILES, MAX_SKILL_TEXT_BYTES } from '../../../../packages/tickets-engine/src/core/skills/skill-limits';

/** One file of a pick: its path as the picker names it (a folder pick: `<folder>/<relative path>`), its size, and a read. */
export interface PickedFile {
  readonly path: string;
  readonly size: number;
  bytes(): Promise<Uint8Array>;
}

export type UploadPlan = { readonly ok: true; readonly command: Omit<SkillUploadCommand, 'scope' | 'persona'> } | { readonly ok: false; readonly code: SkillErrorCode };

const refuse = (code: SkillErrorCode): UploadPlan => ({ ok: false, code });

/** A folder cloned from GitHub carries its history; that is no part of a skill. */
const isSkillFile = (path: string): boolean => !path.split('/').includes('.git');

const stemOf = (path: string): string => {
  const base = path.split('/').pop() ?? path;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
};

const extensionOf = (path: string): string => {
  const base = path.split('/').pop() ?? path;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
};

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** An uncompressed zip: local headers and data, the central directory, the end record. UTF-8 names (flag bit 11). */
export function zipStored(files: readonly { readonly path: string; readonly data: Uint8Array }[]): Uint8Array {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const directory: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.path);
    const crc = crc32(file.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, file.data.length, true);
    local.setUint32(22, file.data.length, true);
    local.setUint16(26, name.length, true);
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x0800, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, file.data.length, true);
    entry.setUint32(24, file.data.length, true);
    entry.setUint16(28, name.length, true);
    entry.setUint32(42, offset, true);
    parts.push(new Uint8Array(local.buffer), name, file.data);
    directory.push(new Uint8Array(entry.buffer), name);
    offset += 30 + name.length + file.data.length;
  }
  const size = directory.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...directory, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of all) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  }
  return btoa(binary);
}

/** A picked `SKILL.md` (the folder name comes from its frontmatter), another `<name>.md` (its stem is the name), or a zip. */
async function planOfFile(file: PickedFile): Promise<UploadPlan> {
  const extension = extensionOf(file.path);
  if (extension === 'zip') {
    return file.size > MAX_SKILL_BYTES ? refuse('too_large') : { ok: true, command: { format: 'zip', zipBase64: bytesToBase64(await file.bytes()) } };
  }
  if (extension !== 'md' && extension !== 'markdown') {
    return refuse('bad_skill_file');
  }
  if (file.size > MAX_SKILL_TEXT_BYTES) {
    return refuse('too_large');
  }
  const text = new TextDecoder().decode(await file.bytes());
  const stem = stemOf(file.path);
  return { ok: true, command: { format: 'markdown', text, ...(stem.toLowerCase() === 'skill' ? {} : { name: stem }) } };
}

/** A picked folder, packed with its relative paths (the folder's own name stays the archive's one top folder). */
async function planOfFolder(files: readonly PickedFile[]): Promise<UploadPlan> {
  const kept = files.filter((file) => isSkillFile(file.path));
  if (kept.length === 0) {
    return refuse('bad_skill_file');
  }
  if (kept.length > MAX_SKILL_FILES || kept.reduce((sum, file) => sum + file.size, 0) > MAX_SKILL_BYTES) {
    return refuse('too_large');
  }
  const packed = await Promise.all(kept.map(async (file) => ({ path: file.path, data: await file.bytes() })));
  return { ok: true, command: { format: 'zip', zipBase64: bytesToBase64(zipStored(packed)) } };
}

/** The command a pick sends, or the engine code it would be refused with (said before anything goes). */
export function uploadPlanOf(kind: 'file' | 'folder', files: readonly PickedFile[]): Promise<UploadPlan> {
  if (kind === 'folder') {
    return planOfFolder(files);
  }
  return files.length === 1 ? planOfFile(files[0]!) : Promise.resolve(refuse('bad_skill_file'));
}
