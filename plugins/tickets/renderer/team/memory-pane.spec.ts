// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- the spec stands in for the host, which owns the catalog at runtime
import { i18n } from '../../../../shared/i18n';
import type { JournalEntry, PersonaMemoryEntry, PersonaView } from '../../shared/remote-protocol';
import type { DeskDeps } from '../board/desk-deps';
import { mountMemoryPane } from './memory-pane';
import { journalRows, memoryRows } from './memory-model';

const BEN = { id: 'ben', title: 'Ben' } as PersonaView;
const t = (key: string, params?: Record<string, string | number>): string => i18n.t(key as never, params as never);
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const MEMORY: PersonaMemoryEntry[] = [
  { text: '2026-11-01 · T-0100 · handed-over · 12 tokens', pinned: false, author: null, model: null, date: '2026-11-01', ticket: 'T-0100', lesson: 'handed-over · 12 tokens' },
  { text: '2026-11-09 · T-0102 · ben/sonnet · run the verify script', pinned: true, author: 'ben', model: 'sonnet', date: '2026-11-09', ticket: 'T-0102', lesson: 'run the verify script' },
  { text: '2026-11-09 · you · ask before renaming', pinned: false, author: 'you', model: null, date: '2026-11-09', ticket: null, lesson: 'ask before renaming' },
];

const JOURNAL: JournalEntry[] = [
  { at: '2026-11-01', ticket: 'T-0007', persona: 'ben', harness: null, model: null, gate: 'none', costUsd: null, signals: ['friction'], friction: 'guessed the shape', finding: null, note: 'migrated from friction.md' },
  { at: '2026-11-09T10:00:00Z', ticket: 'T-0102', persona: 'ben', harness: 'claude-code', model: 'sonnet', gate: 'red', costUsd: 0.42, signals: ['red-gate', 'retry'], friction: null, finding: { cause: 'prompt', text: 'no test command' }, note: null },
];

function desk(): { deps: DeskDeps; calls: [string, unknown][] } {
  const calls: [string, unknown][] = [];
  const deps = {
    api: { i18n },
    invoke: async (method: string, payload?: unknown) => {
      calls.push([method, payload]);
      return method.startsWith('personaJournal') ? { ok: true, entries: method === 'personaJournalRemove' ? JOURNAL.slice(1) : JOURNAL } : { ok: true, entries: method === 'personaMemoryRemove' ? MEMORY.slice(1) : MEMORY };
    },
    subscribe: () => () => undefined,
  } as unknown as DeskDeps;
  return { deps, calls };
}

describe('the Memory tab rows (req-169)', () => {
  it('memory keeps file order; a line names its author and evidence, an older one none', () => {
    expect(memoryRows(MEMORY, t).map((r) => [r.text, r.meta, r.pinned])).toEqual([
      ['2026-11-01 · T-0100 · handed-over · 12 tokens', '', false],
      ['run the verify script', 'ben/sonnet · T-0102 · 2026-11-09', true],
      ['ask before renaming', 'you · 2026-11-09', false],
    ]);
  });

  it('the journal shows the newest entry first, its index still the file position', () => {
    const rows = journalRows(JOURNAL, t);
    expect(rows.map((r) => r.index)).toEqual([1, 0]);
    expect(rows[0]).toEqual({
      index: 1,
      head: 'T-0102 · claude-code/sonnet · gate red · $0.42 · 2026-11-09',
      lines: ['Why: red gate, retry', 'Finding (prompt): no test command'],
      key: '2026-11-09T10:00:00Z',
    });
    expect(rows[1]!.head).toBe('T-0007 · model unknown · no gate · cost unknown · 2026-11-01');
  });
});

describe('the Memory tab (req-169)', () => {
  it('lists Memory and Journal apart, each with its count', async () => {
    const body = document.createElement('div');
    mountMemoryPane(desk().deps, BEN, body);
    await flush();
    expect([...body.querySelectorAll('.desk-pane-title')].map((n) => n.textContent)).toEqual(['Memory · 3', 'Journal · 2']);
    expect(body.querySelectorAll('.desk-memory-section')[1]!.textContent).toContain('migrated from friction.md');
  });

  it("removes a memory line and a journal entry one by one, sending what the row showed", async () => {
    const { deps, calls } = desk();
    const body = document.createElement('div');
    mountMemoryPane(deps, BEN, body);
    await flush();
    const [memory, journal] = [...body.querySelectorAll('.desk-memory-section')];
    const removeOf = (section: Element, row: number): HTMLButtonElement =>
      [...section.querySelectorAll('.desk-memory-row')[row]!.querySelectorAll('button')].find((b) => b.textContent === 'Remove')!;
    removeOf(memory!, 2).click();
    removeOf(journal!, 0).click();
    await flush();
    expect(calls).toContainEqual(['personaMemoryRemove', { persona: 'ben', index: 2, text: '2026-11-09 · you · ask before renaming' }]);
    expect(calls).toContainEqual(['personaJournalRemove', { persona: 'ben', index: 1, at: '2026-11-09T10:00:00Z' }]);
    expect(body.querySelectorAll('.desk-pane-title')[0]!.textContent).toBe('Memory · 2');
  });

  it('the owner adds a line directly', async () => {
    const { deps, calls } = desk();
    const body = document.createElement('div');
    mountMemoryPane(deps, BEN, body);
    await flush();
    const input = body.querySelector('input')!;
    expect(input.getAttribute('aria-label')).toBe('Teach Ben');
    input.value = 'never touch the generated client';
    [...body.querySelectorAll('button')].find((b) => b.textContent === 'Add')!.click();
    await flush();
    expect(calls).toContainEqual(['personaMemoryAppend', { persona: 'ben', text: 'never touch the generated client' }]);
  });
});
