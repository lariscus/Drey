import { describe, expect, it } from 'vitest';
import { readSkillZip } from './skill-zip';
import { buildZip } from './skill-zip.fake';

const text = (data: Uint8Array): string => new TextDecoder().decode(data);

describe('readSkillZip', () => {
  it('reads stored and deflated entries, skipping folder entries', () => {
    const zip = buildZip([
      { name: 'review/', data: '' },
      { name: 'review/SKILL.md', data: '---\nname: review\n---\nBody', method: 'deflate' },
      { name: 'review/scripts/run.sh', data: '#!/bin/sh', method: 'store' },
    ]);
    const files = readSkillZip(zip);
    expect(files.map((f) => f.path)).toEqual(['review/SKILL.md', 'review/scripts/run.sh']);
    expect(text(files[0]!.data)).toBe('---\nname: review\n---\nBody');
    expect(text(files[1]!.data)).toBe('#!/bin/sh');
  });

  it('reads binary files byte for byte', () => {
    const bytes = Uint8Array.from({ length: 300 }, (_, i) => i % 256);
    expect([...readSkillZip(buildZip([{ name: 'a.bin', data: bytes }]))[0]!.data]).toEqual([...bytes]);
  });

  it('refuses what is not a zip, or has a damaged directory', () => {
    expect(() => readSkillZip(Buffer.from('not a zip at all, just text'))).toThrow(/not a zip/);
    const zip = buildZip([{ name: 'a.txt', data: 'x' }]);
    const broken = Buffer.from(zip);
    broken.writeUInt32LE(0xdeadbeef, broken.length - 22 + 16);
    expect(() => readSkillZip(broken)).toThrow();
  });

  it('refuses an entry that unpacks larger than it declared, before it is written anywhere (a zip bomb)', () => {
    const bomb = buildZip([{ name: 'a.txt', data: 'x'.repeat(100_000), declaredSize: 10 }]);
    expect(() => readSkillZip(bomb)).toThrow();
  });

  it('refuses an archive that declares more than a skill may hold', () => {
    const lie = buildZip([{ name: 'a.txt', data: 'x', declaredSize: 9 * 1024 * 1024 }]);
    expect(() => readSkillZip(lie)).toThrow(/more than a skill may hold/);
  });
});
