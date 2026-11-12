/**
 * The system message of one Mission Control bridge turn (E5a, E10-3, E10-5;
 * req-269). Pure: the crew's prompt texts and the turn's context in, one
 * string out.
 *
 * - a **flow draft**: the flow prompt, then `## Flow` and the flow's context;
 * - a **shape turn**: the shape prompt, then `## Ticket <id>` and its text;
 * - a **mission turn**: Mission Control's persona prompt (`prompt.md` of the
 *   `kind: mission` persona, Pia — req-269), a blank line, the mission
 *   prompt (the intents and the JSON contract), then `## Board digest`.
 *   Without a persona prompt the turn opens with the mission prompt alone.
 *
 * The persona prompt opens the message (R11: the prompt is the persona — who
 * speaks comes before what she may do); it changes only when the owner
 * edits it, so the cached prefix stays stable between turns.
 */
import type { ChatShapeContext } from '../contracts/chat';

/** The crew prompts a turn's system message is built from (`CrewPrompts` fits, the aggregator's own text in `mission`). */
export interface ChatSystemTexts {
  readonly mission: string;
  readonly shape: string;
  readonly flow: string;
}

/** What of the turn decides its system message. */
export interface ChatSystemContext {
  readonly board: string;
  readonly shape?: Pick<ChatShapeContext, 'ticket' | 'ticketText'>;
  readonly flow?: { readonly context: string };
  /** Mission Control's persona prompt; absent or blank = none (a mission turn only). */
  readonly persona?: string | null;
}

export function chatSystemOf(texts: ChatSystemTexts, turn: ChatSystemContext): string {
  if (turn.flow !== undefined) {
    return `${texts.flow}\n\n## Flow\n\n${turn.flow.context}`;
  }
  if (turn.shape !== undefined) {
    return `${texts.shape}\n\n## Ticket ${turn.shape.ticket}\n\n${turn.shape.ticketText}`;
  }
  const persona = turn.persona?.trim() ?? '';
  return `${persona === '' ? '' : `${persona}\n\n`}${texts.mission}\n\n## Board digest\n\n${turn.board}`;
}
