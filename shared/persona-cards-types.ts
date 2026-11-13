/** The persona board cards' shapes (req-273): what `persona-cards.ts` reads and what it hands each client. */
import type { MessageKey } from './i18n';

export type PersonaCardKind = 'no-persona' | 'question' | 'second-send-back' | 'merge-conflict';

/** The id prefix of the cards: their buttons are the plugin's, not the engine chat's. */
export const PERSONA_CARD_PREFIX = 'pcard-';

/** The holder lane's slice a card needs. */
export interface CardLane {
  readonly persona: string;
  readonly title: string;
  /** `#rrggbb`; '' = none. */
  readonly color: string;
}

/** The ticket hold's slice (`TicketHold`). */
export interface CardHold {
  readonly holder: string;
  readonly why: string;
  readonly position: number;
  readonly length: number;
  readonly chain: readonly string[];
  readonly named: string | null;
  readonly sentBack: { readonly from: number; readonly to: number } | null;
}

export interface CardTicket {
  readonly id: string;
  readonly title: string;
  /** The ticket's settled-run cost in dollars; null = none known. */
  readonly cost: number | null;
  readonly hold: CardHold | null;
}

/** The Needs-you item's slice (`NeedItem`). */
export interface CardNeed {
  readonly kind: string;
  readonly ticketId: string;
  readonly text: string;
  readonly runId: string | null;
  readonly since: string | null;
  readonly shaped?: { readonly question: string; readonly options: readonly { readonly n: number; readonly label: string }[] };
  readonly questions?: readonly { readonly question: string; readonly options: readonly { readonly label: string }[] }[];
}

export interface PersonaCardsInput {
  readonly lanes: readonly CardLane[];
  readonly tickets: readonly CardTicket[];
  readonly needs: readonly CardNeed[];
  /** Ticket id → its Log text, when a client has it: the first send-back's reason is read off it. */
  readonly logs?: Readonly<Record<string, string>>;
}

export interface PersonaCardFormat {
  readonly t: (key: MessageKey, params?: Record<string, string | number>) => string;
  readonly time: (date: Date) => string;
  readonly money: (amount: number) => string;
}

export interface PersonaCardCell {
  readonly initials: string;
  readonly title: string;
  readonly state: 'done' | 'now' | 'next';
  /** `#rrggbb` of the persona; null = none (the `now` cell then wears the peach accent). */
  readonly color: string | null;
  /** The persona that does not exist: `··`. */
  readonly missing: boolean;
}

export interface PersonaCardLine {
  readonly text: string;
  readonly style: 'strong' | 'normal' | 'muted';
}

export interface PersonaCardRow {
  /** The mark in the row's square: the reason's number, or `C` for a conflicted file. */
  readonly mark: string;
  readonly text: string;
  readonly mono: boolean;
}

export type PersonaCardActionId = 'assign' | 'do_myself' | 'option' | 'write_answer' | 'send_back' | 'accept' | 'resolve' | 'let_resolve';

export interface PersonaCardAction {
  readonly id: PersonaCardActionId;
  readonly label: string;
  readonly primary: boolean;
  /** An `option` button's answer wording. */
  readonly answer?: string;
}

export interface PersonaCard {
  /** `pcard-<kind>-<ticket>`: stable while the need stands. */
  readonly id: string;
  readonly kind: PersonaCardKind;
  readonly ticketId: string;
  readonly tone: 'attention' | 'negative';
  readonly title: string;
  readonly lines: readonly PersonaCardLine[];
  readonly cells: readonly PersonaCardCell[];
  /** `Ben · 3 of 6`, or `Position 4 of 6`. */
  readonly who: string;
  /** The right of the who line: the cost, or `merging main`; '' = none. */
  readonly side: string;
  readonly rows: readonly PersonaCardRow[];
  readonly actions: readonly PersonaCardAction[];
  /** `Mission Control · 14:05`. */
  readonly meta: string;
  /** The run a question waits on; null otherwise. */
  readonly runId: string | null;
  /** The decision key of a `needs-decision` question (`[key] …`); null = none named. */
  readonly decisionKey: string | null;
  /** The persona of the position (a conflict's `Let Ben resolve`); '' = none. */
  readonly persona: string;
  /** The position the card concerns (the no-persona card's Assign…). */
  readonly position: number;
}
