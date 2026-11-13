import { Injectable, signal, type Signal } from '@angular/core';
import type { AnswerOption } from '../phone/answer-card';

/** One earlier position of a persona board ticket's send-back picker (board 10e v2). */
export interface PadHoldTarget {
  readonly position: number;
  /** `Ben · 3 of 6`. */
  readonly label: string;
  /** The grey word at the row's end (`shape`, `build`). */
  readonly word: string;
}

/**
 * The decision on a persona board ticket held by You (req-273, board 10e v2):
 * Mission Control's lead line, Accept, and Send back to one earlier position
 * with a mandatory note. Every word arrives worded.
 */
export interface PadHoldDecision {
  /** The lead's small head: `Mission Control`. */
  readonly who: string;
  /** `Tessa passed all 4 checks on T-0118. It waits for you.` */
  readonly lead: string;
  readonly acceptLabel: string;
  /** `Send back to`; the picker is drawn only when `targets` has rows. */
  readonly targetsLabel: string;
  readonly targets: readonly PadHoldTarget[];
  readonly target: Signal<number | null>;
  /** `Send back to Ben`: names the chosen target. */
  readonly sendBackLabel: Signal<string>;
  readonly note: Signal<string>;
  readonly noteLabel: string;
  setNote(text: string): void;
  pickTarget(position: number): void;
  accept(): void;
  sendBack(): void;
}

/**
 * The card of the open ticket in the iPad's Assistant (boards 10e, 10q, 5b, 5c;
 * Q9 of the row's measure sheet): the surface that owns the decision publishes
 * it, with the very calls the phone's card makes; the chat only draws it.
 */
export interface PadCard {
  readonly question: string;
  readonly why: string | null;
  readonly options: readonly AnswerOption[];
  readonly selected: Signal<number | null>;
  readonly busy: Signal<boolean>;
  readonly error: Signal<string | null>;
  /** The line that replaces the card once it is decided; null while open. */
  readonly done: Signal<string | null>;
  /** The selected option asks for a note (Send back): the card shows the field. */
  readonly noteOpen?: Signal<boolean>;
  readonly note?: Signal<string>;
  readonly noteLabel?: string;
  /** req-273: a persona board ticket held by You draws this decision instead of the options. */
  readonly hold?: PadHoldDecision;
  setNote?(text: string): void;
  pick(index: number): void;
  send(): void;
}

@Injectable({ providedIn: 'root' })
export class PadCards {
  readonly card = signal<PadCard | null>(null);
}
