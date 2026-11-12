/**
 * The flow editor's contract (E10-5, re-cut by req-266): what the desk
 * answers for one flow — a ticket's chain or one plan part's, the ordered
 * list of personas — and the edits, the save and the draft on it. The
 * grammar is `core/chain-list.ts`, the guard `core/chain-validate.ts`, the
 * edits `core/flow-edit.ts`; the service is `BoardService`. Nothing is
 * written before a save: an edit is a pure function from a draft chain to a
 * draft chain (the app keeps the draft).
 */
import type { ChainMode } from './chain';
import type { FlowOp } from '../core/flow-edit';

export type { FlowOp };

/** Which flow: the ticket's own chain, or one part of a split plan (the parent's `### Parts`). */
export type FlowScope =
  | { readonly kind: 'ticket' }
  | { readonly kind: 'part'; readonly index: number; readonly title: string };

/** One position of the flow, from the ticket's current one on. */
export interface FlowStepView {
  /** 0-based index in the whole chain — what an edit addresses. */
  readonly index: number;
  /** 1-based position — what the card and a send-back name. */
  readonly position: number;
  /** The persona that takes this position. */
  readonly persona: string;
  /** The persona's title; its id when no persona record exists. */
  readonly title: string;
  /** The run's mode (`shape` = the interactive entry); null = an ordinary run. */
  readonly mode: ChainMode | null;
  readonly state: 'current' | 'future';
  readonly notify: boolean;
  /** The persona's model; null when there is none to show. */
  readonly model: string | null;
  /** The human persona's position: the owner works it by hand. */
  readonly owner: boolean;
  /** The entry names no persona record (deleted or misspelled). */
  readonly missing: boolean;
  /** The step may not change: it is the current one (or the part is a ticket already). */
  readonly locked: boolean;
}

export interface FlowPersona {
  readonly id: string;
  /** `human` = the owner (E10-6): the gate parks the ticket for them; `mission` = Mission Control's persona (req-269): a turn of hers, no session. */
  readonly kind: 'agent' | 'human' | 'mission';
  readonly title: string;
  readonly color: string;
  readonly model: string;
}

export type FlowReply =
  | {
      readonly ok: true;
      readonly ticket: string;
      readonly title: string;
      readonly scope: FlowScope;
      /** The chain shown: the saved one, an edit's result or Paul's draft; canonical entries. */
      readonly chain: readonly string[];
      /** The chain in the file now (a ticket without one: the standard flow it would get). */
      readonly saved: readonly string[];
      readonly steps: readonly FlowStepView[];
      /** The crew — who a position can be given to. */
      readonly personas: readonly FlowPersona[];
      /** Set when nothing may be saved (a live run, a part that is a ticket); the reason. */
      readonly readOnly: string | null;
    }
  | { readonly ok: false; readonly error: string };

/** The edit's answer: the new draft, or why the edit does not hold. */
export type FlowEditReply = FlowReply;

/** Paul's draft: the flow he proposes and why — nothing is written. */
export type FlowDraftReply =
  | (Extract<FlowReply, { ok: true }> & { readonly reason: string })
  | { readonly ok: false; readonly error: string };

export type FlowSaveReply =
  | { readonly ok: true; readonly warning?: string }
  | { readonly ok: false; readonly error: string };

export interface FlowTarget {
  readonly id: string;
  /** 0-based part index; null = the ticket's own chain. */
  readonly part: number | null;
}
