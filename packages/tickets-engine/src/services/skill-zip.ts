import { inflateRawSync } from 'node:zlib';
import { MAX_SKILL_BYTES, MAX_SKILL_FILES, type SkillBundleFile } from '../core/skills/skill-bundle';

/**
 * A dependency-free reader of the zip a skill arrives in (req-172): the
 * central directory, stored or deflated entries, no zip64, no encryption — a
 * twin of the plugin installer's reader, with two bounds the installer does
 * not need: the declared sizes are checked before anything is inflated, and
 * the inflate itself is capped, so a small archive cannot unpack into a
 * large one. Names are returned as written; `validateSkillBundle` judges them.
 */

const END_SIGNATURE = 0x06054b50;
const ENTRY_SIGNATURE = 0x02014b50;
const ENCRYPTED = 0x0001;

export class SkillZipError extends Error {}

function endOf(buffer: Buffer): number {
  for (let end = buffer.length - 22; end >= 0 && end >= buffer.length - 22 - 0xffff; end--) {
    if (buffer.readUInt32LE(end) === END_SIGNATURE) {
      return end;
    }
  }
  throw new SkillZipError('not a zip archive (no end-of-central-directory record)');
}

export function readSkillZip(buffer: Buffer): readonly SkillBundleFile[] {
  const end = endOf(buffer);
  const count = buffer.readUInt16LE(end + 10);
  if (count > MAX_SKILL_FILES * 2) {
    throw new SkillZipError('the archive holds too many entries');
  }
  const files: SkillBundleFile[] = [];
  let declared = 0;
  let offset = buffer.readUInt32LE(end + 16);
  for (let i = 0; i < count; i++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== ENTRY_SIGNATURE) {
      throw new SkillZipError('corrupt zip central directory');
    }
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith('/')) {
      continue;
    }
    declared += size;
    if (declared > MAX_SKILL_BYTES) {
      throw new SkillZipError('the archive unpacks to more than a skill may hold');
    }
    if ((flags & ENCRYPTED) !== 0 || (method !== 0 && method !== 8)) {
      throw new SkillZipError(`${name} is encrypted or uses a compression this reader does not know`);
    }
    const start = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    const raw = buffer.subarray(start, start + compressedSize);
    const data = method === 0 ? raw : inflateRawSync(raw, { maxOutputLength: size + 1 });
    if (data.byteLength !== size) {
      throw new SkillZipError(`${name} does not unpack to its declared size`);
    }
    files.push({ path: name, data: new Uint8Array(data) });
  }
  return files;
}
