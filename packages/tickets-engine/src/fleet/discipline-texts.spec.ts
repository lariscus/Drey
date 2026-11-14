import { promises as fsp } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { promptVersion, SHIPPED_PROMPTS_DIR } from '../core/default-prompts';
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
  it('ships exactly the disciplines and fragments, LF and newline-terminated', async () => {
    const dir = path.join(SHIPPED_PROMPTS_DIR, 'disciplines');
    const names = (await fsp.readdir(dir)).filter((n) => n.endsWith('.md')).sort();
    expect(names).toEqual([
      'asking.md',
      'chain.md',
      'completion.md',
      'followups.md',
      'handover.md',
      'interactive.md',
      'language.md',
      'precedence.md',
      'read-only.md',
      'scout.md',
      'signals.md',
      'ticket-file.md',
      'working.md',
      'writing.md',
    ]);
    const fragments = (await fsp.readdir(path.join(SHIPPED_PROMPTS_DIR, 'fragments'))).filter((n) => n.endsWith('.md')).sort();
    expect(fragments).toEqual(['chain-grammar.md', 'flow-proposal.md', 'plan-format.md']);
    for (const file of [...names.map((n) => path.join(dir, n)), ...fragments.map((n) => path.join(SHIPPED_PROMPTS_DIR, 'fragments', n))]) {
      const raw = await fsp.readFile(file, 'utf8');
      expect(raw.endsWith('\n'), file).toBe(true);
      expect(raw, file).not.toContain('\r');
      // req-280: every discipline and fragment carries a version marker, stripped on load.
      expect(promptVersion(raw), file).toBeGreaterThan(0);
    }
  });

  it('loads every discipline with the markers substituted and no placeholder left', async () => {
    const texts = await loadDisciplineTexts();
    expect(texts.completion).toMatch(/^Completion discipline:/);
    expect(texts.handover).toMatch(/^Handover:/);
    expect(texts.interactive).toMatch(/^Dialog discipline:/);
    expect(texts.asking).toMatch(/^Asking the owner:/);
    expect(texts.scout).toMatch(/^Scout discipline:/);
    const { fragments, chain, ...disciplines } = texts;
    // req-257: the chain section keeps its per-run placeholders ({{at}}, {{length}}, {{positions}}) for the composer
    expect(chain).toMatch(/^The chain:/);
    expect(chain).toContain('{{positions}}');
    expect(chain).toContain('`SEND-BACK: <position> <reason in one line>`');
    expect(chain).not.toContain('{{sendBack}}');
    for (const text of [...Object.values(disciplines), fragments.planFormat, fragments.chainGrammar]) {
      expect(text).not.toContain('{{');
      expect(text).not.toContain('drey-prompt-version');
      expect(text.endsWith('\n')).toBe(false);
    }
    // The markers the runner's protocol reads back (BLOCKED:, QUESTION:, FRICTION:) — one place, the signals.
    expect(texts.signals).toContain('`BLOCKED: <reason in one line>`');
    expect(texts.signals).toContain('`QUESTION:`');
    expect(texts.signals).toContain('`FRICTION: <what was missing>`');
    expect(texts.asking).toContain('`QUESTION:`');
    // req-299: the follow-ups rule names the marker the runner parses and the bound, never a placeholder.
    expect(texts.followups).toMatch(/^Follow-ups:/);
    expect(texts.followups).toContain('`FOLLOWUPS:`');
    expect(texts.followups).toContain('at most 5 bullets');
    // The parsed plan shapes (acceptanceCommands, parsePlanParts) are spelled in the one plan format.
    expect(fragments.planFormat).toContain('### Acceptance criteria');
    expect(fragments.planFormat).toContain('### Parts');
    expect(fragments.chainGrammar).toContain('"<persona>:shape"');
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
