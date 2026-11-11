import { promises as fsp } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SHIPPED_PROMPTS_DIR } from '../core/default-prompts';
import { loadCrewPrompts } from './crew-prompts';

/**
 * req-279: the crew's chat prompts ship as real files beside the pipeline
 * prompts. Like `default-prompts.spec.ts` pins the pipeline files, this
 * pins the crew files: LF, newline-terminated, and the loader returning
 * the prompt without the trailing newline (the bytes the bridge sends).
 */

describe('the crew prompt files', () => {
  it('ships exactly the four chat prompts, LF and newline-terminated', async () => {
    const dir = path.join(SHIPPED_PROMPTS_DIR, 'crew');
    const names = (await fsp.readdir(dir)).filter((n) => n.endsWith('.md')).sort();
    expect(names).toEqual(['aggregator.md', 'flow.md', 'mission.md', 'shape.md']);
    for (const name of names) {
      const raw = await fsp.readFile(path.join(dir, name), 'utf8');
      expect(raw.endsWith('\n'), name).toBe(true);
      expect(raw, name).not.toContain('\r');
    }
  });

  it('loads every prompt without the trailing newline, as the bridge sends it', async () => {
    const crew = await loadCrewPrompts();
    expect(crew.mission).toMatch(/^You are Mission Control/);
    expect(crew.mission.endsWith('\n')).toBe(false);
    expect(crew.shape).toMatch(/^You are Paul/);
    expect(crew.flow).toMatch(/^You are Paul/);
    expect(crew.aggregator).toMatch(/^You are the improvement aggregator/);
    // The strict output contract every parser relies on stays in all four.
    for (const text of [crew.mission, crew.shape, crew.flow, crew.aggregator]) {
      expect(text).toContain('STRICT');
    }
  });

  it('names a missing file, and refuses an empty one', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'drey-crew-'));
    try {
      await expect(loadCrewPrompts(dir)).rejects.toThrow(/crew[\\/]mission\.md is missing/);
      await fsp.mkdir(path.join(dir, 'crew'), { recursive: true });
      await fsp.writeFile(path.join(dir, 'crew', 'mission.md'), '\n', 'utf8');
      await expect(loadCrewPrompts(dir)).rejects.toThrow(/crew[\\/]mission\.md .* is empty/);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });
});
