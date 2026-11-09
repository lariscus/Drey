import { promises as fsp } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JournalReader } from './journal-reader';

describe('JournalReader (req-169)', () => {
  let vault = '';

  beforeEach(async () => {
    vault = await fsp.mkdtemp(path.join(os.tmpdir(), 'drey-journals-'));
  });

  afterEach(async () => {
    await fsp.rm(vault, { recursive: true, force: true });
  });

  it("reads every persona's reviews.md once per vault; a vault without personas reads empty", async () => {
    const dir = (id: string): string => path.join(vault, 'tickets', '_meta', 'personas', id);
    await fsp.mkdir(dir('ben'), { recursive: true });
    await fsp.mkdir(dir('pia'), { recursive: true });
    await fsp.writeFile(path.join(dir('ben'), 'reviews.md'), '# Reviews\n\n- 2026-11-09T10:00:00Z · T-0102 · ben · claude-code/sonnet · gate red · $0.42\n', 'utf8');
    const entries = await new JournalReader().entriesOf([vault, vault, path.join(vault, 'nowhere')]);
    expect(entries.map((e) => [e.persona, e.model])).toEqual([['ben', 'sonnet']]);
  });
});
