import { promises as fsp } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SHIPPED_PROMPTS_DIR } from '../core/config/default-prompts';
import { loadCrewPrompts, loadDialogPrompt } from './crew-prompts';

/**
 * req-279: the crew's chat prompts ship as real files beside the pipeline
 * prompts. Like `default-prompts.spec.ts` pins the pipeline files, this
 * pins the crew files: LF, newline-terminated, and the loader returning
 * the prompt without the trailing newline (the bytes the bridge sends).
 */

describe('the crew prompt files', () => {
  it('ships exactly the three chat prompts and the dialog protocol, LF and newline-terminated', async () => {
    const dir = path.join(SHIPPED_PROMPTS_DIR, 'crew');
    const names = (await fsp.readdir(dir)).filter((n) => n.endsWith('.md')).sort();
    expect(names).toEqual(['aggregator.md', 'dialog.md', 'mission.md', 'shape.md']);
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
    // req-272: shape is a mode wrapper now — no persona's name in it; the speaker's prompt.md goes in front.
    expect(crew.shape).toMatch(/^The owner shapes one new ticket with you/);
    // (The fragments' examples name ids, as examples; the wrapper's own text does not, nor does it carry the old roster line.)
    expect(crew.shape).not.toMatch(/\bPaul\b|planner of the tickets crew|ben \(builds\)/);
    expect(crew.aggregator).toMatch(/^You are the improvement aggregator/);
    // The strict output contract every parser relies on stays in all three.
    for (const text of [crew.mission, crew.shape, crew.aggregator]) {
      expect(text).toContain('STRICT');
    }
  });

  it('loads the dialog protocol with its fragments expanded and no version line', async () => {
    const dialog = await loadDialogPrompt();
    expect(dialog).toMatch(/^You are the planning step of the owner's ticket pipeline, in a dialog/);
    expect(dialog).not.toContain('drey-prompt-version');
    expect(dialog).not.toContain('{{');
    expect(dialog).toContain('QUESTION:');
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
