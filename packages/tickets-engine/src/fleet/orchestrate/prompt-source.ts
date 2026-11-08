import type { PipelinePhase, TicketCard } from '../../contracts/tickets';
import { promptVersion, stripPromptVersion } from '../../core/default-prompts';
import { PERSONAS_DIR } from '../../core/persona';
import { columnPromptRef } from '../chain';
import type { FileSystem } from '../ports/file-system';
import type { ChainConfig } from '../protocol';
import type { Note, TicketPersona } from './board-personas';

/** The instruction base of a dispatch: the persona's prompt, else the column's template; null = skip the dispatch. */
export interface DispatchPrompt {
  readonly promptText: string | null;
  /** The persona's own prompt when it is the base (it rides the composed request). */
  readonly personaPrompt: string | null;
}


/**
 * Where a dispatch's instruction comes from (E3, E8): a resolved persona's
 * prompt.md is the base instead of the column's template; a persona without
 * one leaves the template standing; a missing template skips the dispatch
 * instead of dispatching blind. A vault template older than the shipped
 * default is said once per runner life — the version marker never reaches
 * the model.
 */
export class PromptSource {
  private readonly driftNoted = new Set<string>();

  constructor(
    private readonly note: Note,
    private readonly fs: FileSystem,
    private readonly log: (message: string) => void,
    private readonly shippedPrompt?: (ref: string) => Promise<string | null>,
  ) {}

  async promptFor(config: ChainConfig, card: TicketCard, phase: PipelinePhase, entry: TicketPersona | null): Promise<DispatchPrompt | null> {
    const personaPrompt = this.personaPrompt(card, entry);
    if (personaPrompt !== null) {
      return { promptText: personaPrompt, personaPrompt };
    }
    const ref = columnPromptRef(phase);
    if (ref === null) {
      return { promptText: null, personaPrompt: null };
    }
    if (entry !== null && entry.persona !== null && entry.resolution.persona !== null) {
      this.note(card.id, `dispatch: ${card.id}'s persona "${entry.persona.id}" has no prompt.md — the phase prompt stands`);
    }
    const text = await this.fs.readTextOrNull(this.fs.join(config.ticketsVaultPath, 'tickets', '_meta', 'prompts', `${ref}.md`));
    if (text === null) {
      this.note(card.id, `dispatch skips ${card.id}: prompt "${ref}" is missing (tickets/_meta/prompts/${ref}.md)`);
      return null;
    }
    await this.flagOlder(ref, text);
    return { promptText: stripPromptVersion(text), personaPrompt: null };
  }

  /** The persona's own prompt when it has one; a persona that did not load leaves the ring to decide (said once). */
  private personaPrompt(card: TicketCard, entry: TicketPersona | null): string | null {
    if (entry === null) {
      return null;
    }
    if (entry.resolution.persona !== null && entry.persona === null) {
      this.note(card.id, `dispatch: ${card.id}'s persona "${entry.resolution.persona}" is missing or invalid (${PERSONAS_DIR}/${entry.resolution.persona}/persona.md) — the assignment ring decides`);
      return null;
    }
    return entry.persona !== null && (entry.prompt ?? '').trim() !== '' ? entry.prompt : null;
  }

  /** Vault copies are snapshots: a fixed shipped prompt never reaches a copy seeded before the fix. */
  private async flagOlder(ref: string, vaultText: string): Promise<void> {
    if (this.driftNoted.has(ref) || this.shippedPrompt === undefined) {
      return;
    }
    const shipped = await this.shippedPrompt(ref).catch(() => null);
    if (shipped === null) {
      return;
    }
    const have = promptVersion(vaultText);
    const want = promptVersion(shipped);
    if (want > have) {
      this.driftNoted.add(ref);
      this.log(`prompt "${ref}" in the vault is older than the shipped default (v${have} < v${want}) — Settings → Tickets → Prompts › Reset to the shipped version brings in the fixes`);
    }
  }
}
