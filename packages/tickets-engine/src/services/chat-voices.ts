/**
 * Who speaks in the Shape and the Flow chat (req-272, the persona board
 * concept §7). A turn asks for its voice here: the speaking persona is
 * picked from the ticket's chain (`core/chat-speaker.ts`), its `prompt.md`
 * is read from the vault on every call — a rename, an edit on the Persona
 * page, a persona deleted applies on the next message — and the roster is
 * the crew as it stands now, in `crew.md`'s order. Never throws: what cannot
 * be read is a voice without a prompt (Shape) or no voice (Flow).
 */
import type { ChatVoice } from '../contracts/chat';
import type { ChainEntry } from '../contracts/chain';
import type { BoardSnapshot } from '../contracts/tickets';
import { flowSpeakerOf, shapeSpeakerOf } from '../core/chat-speaker';
import { stripPromptVersion } from '../core/default-prompts';
import { PERSONAS_DIR, type Persona } from '../core/persona';
import { crewRosterOf } from './crew-roster';
import type { EngineHost, EngineVault } from './host';

/** The board as the voices need it: the snapshot (chains, the standard flow), the vault and the crew in its order. */
export interface ChatVoicesBoard {
  snapshot(): Promise<BoardSnapshot>;
  detect(): Promise<EngineVault | null>;
  listPersonas(): Promise<readonly Persona[]>;
}

/** What the chat service asks of the voices; `ChatVoices` fits. */
export interface ChatVoiceSource {
  /** The voice of a shape turn on `ticket`: always one — without a speaker its prompt is null. */
  shape(ticket: string): Promise<ChatVoice>;
  /** The voice of a flow draft on `ticket`; null = no persona can be named, the caller asks the owner which one. */
  flow(ticket: string): Promise<ChatVoice | null>;
}

interface Resolved {
  readonly speaker: Persona | null;
  readonly personas: readonly Persona[];
  readonly vault: EngineVault | null;
}

export class ChatVoices implements ChatVoiceSource {
  constructor(
    private readonly board: ChatVoicesBoard,
    private readonly host: Pick<EngineHost, 'read'>,
  ) {}

  async shape(ticket: string): Promise<ChatVoice> {
    const found = await this.resolve(ticket, shapeSpeakerOf);
    return found === null ? { speaker: null, prompt: null, roster: '' } : this.voiceOf(found);
  }

  async flow(ticket: string): Promise<ChatVoice | null> {
    const found = await this.resolve(ticket, flowSpeakerOf);
    return found === null || found.speaker === null ? null : this.voiceOf(found);
  }

  private async resolve(
    ticket: string,
    pick: (chain: readonly ChainEntry[], standard: readonly ChainEntry[], personas: readonly Persona[]) => Persona | null,
  ): Promise<Resolved | null> {
    try {
      const [snap, personas, vault] = await Promise.all([this.board.snapshot(), this.board.listPersonas(), this.board.detect()]);
      const card = snap.columns.flatMap((column) => column.tickets).find((candidate) => candidate.id === ticket);
      return { speaker: pick(card?.meta.chain ?? [], snap.flow ?? [], personas), personas, vault };
    } catch {
      return null;
    }
  }

  private async voiceOf(found: Resolved): Promise<ChatVoice> {
    const { speaker, personas, vault } = found;
    return { speaker: speaker?.title ?? null, prompt: speaker === null || vault === null ? null : await this.promptOf(vault, speaker), roster: crewRosterOf(personas) };
  }

  private async promptOf(vault: EngineVault, speaker: Persona): Promise<string | null> {
    try {
      const raw = await this.host.read(vault.id, `${PERSONAS_DIR}/${speaker.id}/prompt.md`);
      const text = stripPromptVersion((raw ?? '').replace(/\r\n/g, '\n')).trim();
      return text === '' ? null : text;
    } catch {
      return null;
    }
  }
}
