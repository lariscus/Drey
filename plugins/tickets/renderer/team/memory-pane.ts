// i18n: catalog
/**
 * The Crew tab's Memory tab (R4/R14, req-169): the persona's memory and its
 * journal, listed apart. Memory lines carry their author and evidence, each
 * one pinnable and removable (the owner's and the persona's alike); the
 * owner adds a line directly (`· you ·`). Journal entries — one per
 * noteworthy run, the closing round's finding — are removable one by one
 * and never ride into a run. Plain DOM over `memory-model.ts`; every word
 * through the catalog.
 */
import type { PersonaJournalReply, PersonaMemoryReply, PersonaView } from '../../shared/remote-protocol';
import { h, textButton, type DeskDeps } from '../desk-deps';
import { journalRows, memoryRows, type JournalRow, type MemoryRow, type Words } from './memory-model';

function wordsOf(deps: DeskDeps): Words {
  return (key, params) => deps.api.i18n.t(key as never, params as never);
}

function note(text: string, kind: 'empty' | 'error' = 'empty'): HTMLElement {
  return h('div', kind === 'error' ? 'desk-note desk-note-error' : 'desk-note', text);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface PaneParts {
  readonly deps: DeskDeps;
  readonly persona: PersonaView;
  readonly t: Words;
}

function memoryRowNode(parts: PaneParts, row: MemoryRow, act: (method: string, payload: unknown) => void): HTMLElement {
  const { t, persona } = parts;
  const node = h('div', `desk-memory-row${row.pinned ? ' desk-memory-pinned' : ''}`);
  const text = h('div', 'desk-memory-text');
  text.append(h('span', 'desk-memory-lesson', row.text));
  if (row.meta !== '') {
    text.append(h('span', 'desk-memory-meta', row.meta));
  }
  const pin = textButton(row.pinned ? t('persona.memory.pinned') : t('persona.memory.pin'), 'desk-btn desk-btn-small', row.pinned ? t('persona.memory.unpin_title') : t('persona.memory.pin_title'), () =>
    act('personaMemoryPin', { persona: persona.id, index: row.index, pinned: !row.pinned }),
  );
  const remove = textButton(t('persona.memory.remove'), 'desk-btn desk-btn-small', t('persona.memory.remove_title'), () =>
    act('personaMemoryRemove', { persona: persona.id, index: row.index, text: row.key }),
  );
  node.append(text, pin, remove);
  return node;
}

function journalRowNode(parts: PaneParts, row: JournalRow, act: (method: string, payload: unknown) => void): HTMLElement {
  const { t, persona } = parts;
  const node = h('div', 'desk-memory-row desk-journal-row');
  const text = h('div', 'desk-memory-text');
  text.append(h('span', 'desk-journal-head', row.head));
  for (const line of row.lines) {
    text.append(h('span', 'desk-memory-meta', line));
  }
  const remove = textButton(t('persona.memory.remove'), 'desk-btn desk-btn-small', t('persona.journal.remove_title'), () =>
    act('personaJournalRemove', { persona: persona.id, index: row.index, at: row.key }),
  );
  node.append(text, remove);
  return node;
}

/** The memory half: its heading with the count, the lines, the owner's composer. */
function memorySection(parts: PaneParts): { node: HTMLElement; load: () => void } {
  const { deps, persona, t } = parts;
  const title = h('b', 'desk-pane-title', t('persona.memory.title', { count: 0 }));
  const list = h('div', 'desk-memory');
  const paint = (reply: PersonaMemoryReply): void => {
    if (!reply.ok) {
      list.replaceChildren(note(reply.error, 'error'));
      return;
    }
    title.textContent = t('persona.memory.title', { count: reply.entries.length });
    const rows = memoryRows(reply.entries, t);
    list.replaceChildren(...(rows.length === 0 ? [note(t('persona.memory.empty'))] : rows.map((row) => memoryRowNode(parts, row, (m, p) => void act(m, p)))));
  };
  const act = async (method: string, payload: unknown): Promise<void> => {
    try {
      paint((await deps.invoke(method, payload)) as PersonaMemoryReply);
    } catch (error) {
      list.append(note(messageOf(error), 'error'));
    }
  };
  const input = h('input', 'desk-input desk-input-line');
  input.type = 'text';
  input.setAttribute('aria-label', t('persona.memory.teach', { name: persona.title }));
  const add = textButton(t('persona.memory.add'), 'desk-btn desk-btn-primary', t('persona.memory.add_title'), () => {
    const text = input.value.trim();
    if (text !== '') {
      input.value = '';
      void act('personaMemoryAppend', { persona: persona.id, text });
    }
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      add.click();
    }
  });
  const composer = h('div', 'desk-composer desk-composer-line');
  composer.append(input, add);
  const node = h('div', 'desk-memory-section');
  node.append(title, list, composer);
  return { node, load: () => void act('personaMemory', { persona: persona.id }) };
}

/** The journal half: its heading with the count and the entries, newest first. */
function journalSection(parts: PaneParts): { node: HTMLElement; load: () => void } {
  const { deps, persona, t } = parts;
  const title = h('b', 'desk-pane-title', t('persona.journal.title', { count: 0 }));
  const list = h('div', 'desk-memory');
  const paint = (reply: PersonaJournalReply): void => {
    if (!reply.ok) {
      list.replaceChildren(note(reply.error, 'error'));
      return;
    }
    title.textContent = t('persona.journal.title', { count: reply.entries.length });
    const rows = journalRows(reply.entries, t);
    list.replaceChildren(...(rows.length === 0 ? [note(t('persona.journal.empty'))] : rows.map((row) => journalRowNode(parts, row, (m, p) => void act(m, p)))));
  };
  const act = async (method: string, payload: unknown): Promise<void> => {
    try {
      paint((await deps.invoke(method, payload)) as PersonaJournalReply);
    } catch (error) {
      list.append(note(messageOf(error), 'error'));
    }
  };
  const node = h('div', 'desk-memory-section');
  node.append(title, list);
  return { node, load: () => void act('personaJournal', { persona: persona.id }) };
}

/** Mounts the Memory tab into `body`: Memory first, the Journal below it. */
export function mountMemoryPane(deps: DeskDeps, persona: PersonaView, body: HTMLElement): void {
  const parts: PaneParts = { deps, persona, t: wordsOf(deps) };
  const memory = memorySection(parts);
  const journal = journalSection(parts);
  body.append(memory.node, journal.node);
  memory.load();
  journal.load();
}
