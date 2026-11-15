import type { TicketCard } from '../../contracts/tickets';
import { PERSONAS_DIR } from '../../core/persona';
import type { Note, TicketPersona } from './board-personas';

/** The instruction base of a dispatch: the persona's own prompt. */
export interface DispatchPrompt {
  readonly personaPrompt: string;
}

/**
 * Where a dispatch's instruction comes from (E3, req-307): the persona's
 * prompt.md and nothing else — the column templates and the vault copies of
 * the step prompts are gone. A persona that did not load, or one without a
 * prompt.md, skips the dispatch (said once, naming the file) instead of
 * dispatching blind.
 */
export class PromptSource {
  constructor(private readonly note: Note) {}

  promptFor(card: TicketCard, entry: TicketPersona | null): DispatchPrompt | null {
    const id = entry?.resolution.persona ?? null;
    if (entry === null || id === null) {
      this.note(card.id, `dispatch skips ${card.id}: no persona holds it`);
      return null;
    }
    if (entry.persona === null) {
      this.note(card.id, `dispatch skips ${card.id}: persona "${id}" is missing or invalid (${PERSONAS_DIR}/${id}/persona.md)`);
      return null;
    }
    const prompt = entry.prompt ?? '';
    if (prompt.trim() === '') {
      this.note(card.id, `dispatch skips ${card.id}: persona "${id}" has no prompt (${PERSONAS_DIR}/${id}/prompt.md)`);
      return null;
    }
    return { personaPrompt: prompt };
  }
}
