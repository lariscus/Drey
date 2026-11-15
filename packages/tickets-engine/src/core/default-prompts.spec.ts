import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { promptVersion, SHIPPED_PROMPTS_DIR, stripPromptVersion } from './default-prompts';

describe('shipped prompts', () => {
  it('the package ships the disciplines, the crew prompts and the fragments — and nothing beside them', async () => {
    const entries = await fsp.readdir(SHIPPED_PROMPTS_DIR);
    expect(entries.sort()).toEqual(['crew', 'disciplines', 'fragments']);
  });

  it('every shipped file carries a version marker the reader can strip; the dialog protocol carries none', async () => {
    const files: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(file);
        } else if (entry.name.endsWith('.md')) {
          files.push(file);
        }
      }
    };
    await walk(SHIPPED_PROMPTS_DIR);
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      const text = await fsp.readFile(file, 'utf8');
      if (file.endsWith(path.join('crew', 'dialog.md'))) {
        expect(promptVersion(text), file).toBe(0);
        continue;
      }
      expect(promptVersion(text), file).toBeGreaterThan(0);
      expect(stripPromptVersion(text), file).not.toContain('drey-prompt-version');
    }
  });

  it('reads and strips the marker; a text without one is version 0', () => {
    const marked = `<!-- drey-prompt-version: 7 -->${String.fromCharCode(10)}Body`;
    expect(promptVersion(marked)).toBe(7);
    expect(stripPromptVersion(marked)).toBe('Body');
    expect(promptVersion('Body')).toBe(0);
    expect(stripPromptVersion('Body')).toBe('Body');
  });
});
