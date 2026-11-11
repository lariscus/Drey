import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { archiveName, extractFile, parseChecksums, releaseUrl, sha256Hex, stampOf, verifyArchive } from './fetch-dk-lib.mjs';

/** A minimal stored/deflated zip with the given top-level files. */
function zipOf(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const raw = Buffer.from(content);
    const data = deflateRawSync(raw);
    const nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const centralBytes = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBytes, end]);
}

describe('names and urls', () => {
  it('names the archive of a platform and its release url', () => {
    expect(archiveName('0.6.2', 'windows_amd64')).toBe('dricket_0.6.2_windows_amd64.zip');
    expect(releaseUrl('HenrikPuls/dricket', '0.6.2', 'checksums.txt')).toBe(
      'https://github.com/HenrikPuls/dricket/releases/download/v0.6.2/checksums.txt',
    );
  });

  it('stamps the version with the archive digest', () => {
    expect(stampOf('0.6.2', 'abc')).toBe('0.6.2 abc');
  });
});

describe('parseChecksums', () => {
  const a = 'a'.repeat(64);
  const b = 'B'.repeat(64);

  it('reads goreleaser lines, CRLF and the binary-mode star', () => {
    const map = parseChecksums(`${a}  one.zip\r\n${b} *two.tar.gz\n\nnot a line\n`);
    expect([...map.entries()]).toEqual([
      ['one.zip', a],
      ['two.tar.gz', 'b'.repeat(64)],
    ]);
  });
});

describe('verifyArchive', () => {
  const archive = zipOf({ 'dk.exe': 'MZ-not-a-real-binary', LICENSE: 'GPL' });
  const digest = sha256Hex(archive);
  const file = 'dricket_0.6.2_windows_amd64.zip';
  const sums = (hex) => `${hex}  ${file}\n`;

  it('passes when the pin, the list and the archive agree', () => {
    expect(() => verifyArchive({ archive, file, pinned: digest, checksumsText: sums(digest) })).not.toThrow();
  });

  it('fails when the archive is not the listed one', () => {
    const other = zipOf({ 'dk.exe': 'tampered' });
    expect(() => verifyArchive({ archive: other, file, pinned: digest, checksumsText: sums(digest) })).toThrow(/checksum mismatch/);
  });

  it('fails when checksums.txt disagrees with the pin', () => {
    expect(() => verifyArchive({ archive, file, pinned: digest, checksumsText: sums('0'.repeat(64)) })).toThrow(/the pin says/);
  });

  it('fails when checksums.txt does not list the file', () => {
    expect(() => verifyArchive({ archive, file, pinned: digest, checksumsText: sums(digest).replace(file, 'other.zip') })).toThrow(/does not list/);
  });
});

describe('extractFile', () => {
  const archive = zipOf({ LICENSE: 'GPL text', 'dk.exe': 'binary bytes' });

  it('returns one top-level file', () => {
    expect(extractFile(archive, 'dk.exe').toString()).toBe('binary bytes');
    expect(extractFile(archive, 'LICENSE').toString()).toBe('GPL text');
  });

  it('throws when the archive lacks it', () => {
    expect(() => extractFile(archive, 'dk')).toThrow(/not in the archive/);
  });
});

describe('the pin', () => {
  it('has a digest for the Windows build', () => {
    const pin = JSON.parse(readFileSync(new URL('./dk-version.json', import.meta.url), 'utf8'));
    expect(pin.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pin.sha256.windows_amd64).toMatch(/^[0-9a-f]{64}$/);
  });
});
