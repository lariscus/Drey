/**
 * The chain contract (req-266, the persona board concept §3 and §6): a
 * ticket's chain is the full ORDERED LIST OF PERSONAS it goes through —
 * `paul:shape; paul; ben; ralf; tessa; you`. Each entry is one step of the
 * ticket's way; what happens there is what that persona's `prompt.md`
 * says (R11). The same persona may stand twice, so a position (1-based),
 * never a persona id, is what the cursor points at.
 *
 * Where it lives: the frontmatter's `chain:` list, `at:` the cursor and
 * `sent-back:` the one send-back (`5>3`) on the files backend; `x-chain`
 * (entries joined by `;`), `x-at` and `x-sent-back` on a dricket store.
 * The standard flow is `flow:` in `tickets/_meta/pipeline.md`; it is
 * copied into a ticket at creation and is then the ticket's own.
 *
 * The grammar and the guard live in core/chain-list.ts and
 * core/chain-validate.ts; the specification is specs/ticket-schema.md
 * ("The chain").
 */

/** The run modes an entry may carry (concept §14 reading 1): `shape` = the interactive entry. */
export const CHAIN_MODES = ['shape'] as const;
export type ChainMode = (typeof CHAIN_MODES)[number];

/** One entry of the chain: `<persona>[:<mode>][(notify)]`. */
export interface ChainEntry {
  /** The persona id that takes this position (`you` = the human persona). */
  readonly persona: string;
  /** The run's mode; null = an ordinary run. */
  readonly mode: ChainMode | null;
  /** The Bescheid rule: a card lands in Needs you when this position is done. */
  readonly notify: boolean;
}

/** One position of a ticket's chain as the surfaces render it. */
export interface ChainStep extends ChainEntry {
  /** 1-based position in the chain — what the cursor and a send-back name. */
  readonly position: number;
  readonly state: 'past' | 'current' | 'future';
}

/** The one send-back a ticket may use (concept §4): from position `from` back to position `to`. */
export interface ChainSendBack {
  readonly from: number;
  readonly to: number;
}

/**
 * A ticket's three chain fields (`TicketMeta` carries them): `chain:` / `x-chain`,
 * the cursor `at:` / `x-at` (1-based, absent = 1 — nothing advances it before
 * req-257) and `sent-back:` / `x-sent-back`. Absent chain = none, or it did not parse.
 */
export interface TicketChainFields {
  readonly chain?: readonly ChainEntry[];
  readonly at?: number;
  readonly sentBack?: ChainSendBack;
}

/** At most this many entries — `x-chain` is one size-capped line on the store. */
export const MAX_CHAIN_ENTRIES = 24;
