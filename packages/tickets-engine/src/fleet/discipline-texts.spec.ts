import { promises as fsp } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SHIPPED_PROMPTS_DIR } from '../core/default-prompts';
import { loadDisciplineTexts } from './discipline-texts';

/**
 * req-279: the run brief's disciplines ship as real files beside the
 * pipeline prompts. This pins them the way `default-prompts.spec.ts`
 * pins the pipeline files — LF, newline-terminated — and above all the
 * substitution: the loaded texts carry the protocol markers, never the
 * `{{question}}`/`{{blocked}}` placeholders, so every composed brief
 * stays byte-stable (the prompt cache prefix and the brief digest
 * depend on it).
 */

describe('the discipline files', () => {
  it('ships exactly the five disciplines, LF and newline-terminated', async () => {
    const dir = path.join(SHIPPED_PROMPTS_DIR, 'disciplines');
    const names = (await fsp.readdir(dir)).filter((n) => n.endsWith('.md')).sort();
    expect(names).toEqual(['asking.md', 'completion.md', 'handover.md', 'interactive.md', 'scout.md']);
    for (const name of names) {
      const raw = await fsp.readFile(path.join(dir, name), 'utf8');
      expect(raw.endsWith('\n'), name).toBe(true);
      expect(raw, name).not.toContain('\r');
    }
  });

  it('loads every discipline with the markers substituted and no placeholder left', async () => {
    const texts = await loadDisciplineTexts();
    expect(texts.completion).toMatch(/^Completion discipline:/);
    expect(texts.handover).toMatch(/^Handover:/);
    expect(texts.interactive).toMatch(/^Dialog discipline:/);
    expect(texts.asking).toMatch(/^Asking the owner:/);
    expect(texts.scout).toMatch(/^Scout discipline:/);
    for (const text of [texts.completion, texts.handover, texts.interactive, texts.asking, texts.scout]) {
      expect(text).not.toContain('{{');
      expect(text.endsWith('\n')).toBe(false);
    }
    // The markers the runner's protocol reads back (BLOCKED:, QUESTION:).
    expect(texts.completion).toContain('`BLOCKED: <reason in one line>`');
    expect(texts.scout).toContain('`BLOCKED: ');
    expect(texts.asking).toContain('`QUESTION:`');
    expect(texts.asking).toContain('QUESTION: Should dragging');
  });

  it('names a missing file, and refuses an empty one', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'drey-disciplines-'));
    try {
      await expect(loadDisciplineTexts(dir)).rejects.toThrow(/disciplines[\\/]completion\.md is missing/);
      await fsp.mkdir(path.join(dir, 'disciplines'), { recursive: true });
      await fsp.writeFile(path.join(dir, 'disciplines', 'completion.md'), '\n', 'utf8');
      await expect(loadDisciplineTexts(dir)).rejects.toThrow(/disciplines[\\/]completion\.md .* is empty/);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });
});
