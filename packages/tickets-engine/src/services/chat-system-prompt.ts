/**
 * The system message of one Mission Control bridge turn (E5a, E10-3, E10-5;
 * req-269). Pure: the crew's prompt texts and the turn's context in, one
 * string out.
 *
 * - a **flow draft** (req-272): the `prompt.md` of the persona of the
 *   ticket's plan entry, a blank line, the flow wrapper (the JSON contract),
 *   then `## Flow` and the flow's context (which lists the crew);
 * - a **shape turn** (req-272): the `prompt.md` of the persona of the chain's
 *   interactive entry, a blank line, the shape wrapper (the JSON contract),
 *   `## Crew` (the roster, `crew.md`'s order), then `## Ticket <id>` and its
 *   text. Without a persona prompt the wrapper opens the message;
 * - a **mission turn**: Mission Control's persona prompt (`prompt.md` of the
 *   `kind: mission` persona, Pia — req-269), a blank line, the mission
 *   prompt (the intents and the JSON contract), then `## Board digest` —
 *   or, on Pia's entry in a ticket's chain (req-257), `## Ticket <id>` and
 *   the ticket's text in the digest's place. Without a persona prompt the
 *   turn opens with the mission prompt alone.
 *
 * The persona prompt opens the message (R11: the prompt is the persona — who
 * speaks comes before what she may do); it changes only when the owner
 * edits it, so the cached prefix stays stable between turns.
 */
import type { ChatShapeContext, ChatVoice } from '../contracts/chat';

/** The crew prompts a turn's system message is built from (`CrewPrompts` fits, the aggregator's own text in `mission`). */
export interface ChatSystemTexts {
  readonly mission: string;
  readonly shape: string;
}

/** What of the turn decides its system message. */
export interface ChatSystemContext {
  readonly board: string;
  readonly shape?: Pick<ChatShapeContext, 'ticket' | 'ticketText'>;
  /** Mission Control's persona prompt; absent or blank = none (a mission turn only). */
  readonly persona?: string | null;
  /** req-257: Pia's entry in a ticket's chain — the ticket in the board digest's place. */
  readonly ticket?: { readonly id: string; readonly text: string };
  /** req-272: who speaks in a shape turn; absent or without a prompt = the wrapper speaks alone. */
  readonly voice?: ChatVoice;
}

/** req-272: the speaking persona's prompt, a blank line, the mode's wrapper — who speaks before what the mode asks of them. */
function voicedBy(voice: ChatVoice | undefined, wrapper: string): string {
  const own = voice?.prompt?.trim() ?? '';
  return own === '' ? wrapper : `${own}\n\n${wrapper}`;
}

export function chatSystemOf(texts: ChatSystemTexts, turn: ChatSystemContext): string {
  if (turn.shape !== undefined) {
    const roster = turn.voice?.roster.trim() ?? '';
    // The crew sits before the ticket: the ticket changes every turn, the prefix before it does not.
    return `${voicedBy(turn.voice, texts.shape)}${roster === '' ? '' : `\n\n## Crew\n\n${roster}`}\n\n## Ticket ${turn.shape.ticket}\n\n${turn.shape.ticketText}`;
  }
  const persona = turn.persona?.trim() ?? '';
  const context = turn.ticket !== undefined ? `## Ticket ${turn.ticket.id}\n\n${turn.ticket.text}` : `## Board digest\n\n${turn.board}`;
  return `${persona === '' ? '' : `${persona}\n\n`}${texts.mission}\n\n${context}`;
}
