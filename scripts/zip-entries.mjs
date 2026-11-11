/**
 * A small central-directory zip reader over node:zlib, shared by the two
 * fetch scripts (`fetch-drawio.mjs`, `fetch-dk.mjs`) -- no dependencies.
 */
import { inflateRawSync } from 'node:zlib';

/** Yields `{ name, data }` for every file entry of a (non-zip64) archive. */
export function* zipEntries(buffer) {
  const END_SIGNATURE = 0x06054b50;
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== END_SIGNATURE) {
    end--;
  }
  if (end < 0) {
    throw new Error('not a zip archive (no end-of-central-directory record)');
  }
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error('corrupt zip central directory');
    }
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith('/')) {
      continue;
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(start, start + compressedSize);
    if (method !== 0 && method !== 8) {
      throw new Error(`unsupported zip compression method ${method} for ${name}`);
    }
    yield { name, data: method === 0 ? raw : inflateRawSync(raw) };
  }
}
