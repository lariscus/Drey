import { Injectable, computed, inject, signal } from '@angular/core';
import {
  personaCardsOf,
  type CardLane,
  type CardNeed,
  type CardTicket,
  type PersonaCard,
  type PersonaCardAction,
  type PersonaCardFormat,
} from '../../../../../shared/persona-cards';
import { McI18n } from '../../i18n/i18n.service';
import { holdOf, lanesOf } from '../../work/hold';
import { MC_WORK_STATE, displayTitleOf, type McNeed, type McTicket } from '../../work/work.model';
import { MC_CHAT_STATE } from '../chat.model';

/** One lane the Assign… picker offers. */
export interface PersonaChoice {
  readonly persona: string;
  readonly title: string;
}

/**
 * The persona board's four Needs-you cards on Mission Control (req-273, board
 * MCCardsV2): the one `personaCardsOf` model over the board's holds and the
 * Needs-you list, and what each button does through `MC_WORK_STATE`. The
 * component stays thin over this.
 */
@Injectable({ providedIn: 'root' })
export class McPersonaCards {
  private readonly work = inject(MC_WORK_STATE, { optional: true });
  private readonly chat = inject(MC_CHAT_STATE, { optional: true });
  private readonly i18n = inject(McI18n);

  readonly format: PersonaCardFormat = {
    t: (key, params) => this.i18n.t(key, params),
    time: (date) => this.i18n.formatTime(date),
    money: (amount) => this.i18n.formatCurrency(amount),
  };

  /** The card whose Assign… picker is open; null = none. */
  readonly picking = signal<string | null>(null);
  /** A refused action's words, per card. */
  readonly errors = signal<Readonly<Record<string, string>>>({});

  /** True on a read-only device: the cards show no actions. */
  readonly readOnly = computed(() => this.work?.readOnly ?? true);

  readonly cards = computed((): readonly PersonaCard[] => {
    const work = this.work;
    const lanes = lanesOf((work?.board ?? null) as { lanes?: unknown } | null);
    if (work === undefined || work === null || lanes === null) {
      return [];
    }
    const tickets: CardTicket[] = [];
    for (const column of work.board?.columns ?? []) {
      for (const ticket of column.tickets) {
        const hold = holdOf(ticket);
        if (hold !== null) {
          tickets.push({ id: ticket.id, title: displayTitleOf(ticket), cost: costOf(ticket), hold });
        }
      }
    }
    const cardLanes: readonly CardLane[] = lanes.map((lane) => ({ persona: lane.persona, title: lane.title, color: lane.color }));
    return personaCardsOf({ lanes: cardLanes, tickets, needs: work.needs.flatMap(needOf) }, this.format);
  });

  /** The agents of the crew, in the crew's order (the picker's rows). */
  readonly agents = computed((): readonly PersonaChoice[] =>
    (lanesOf((this.work?.board ?? null) as { lanes?: unknown } | null) ?? []).filter((lane) => lane.kind === 'agent').map((lane) => ({ persona: lane.persona, title: lane.title })),
  );


  /** Runs one button of a card. Assign… only opens the picker; the picked persona goes through {@link assign}. */
  async act(card: PersonaCard, action: PersonaCardAction): Promise<void> {
    const work = this.work;
    if (work === null || work === undefined) {
      return;
    }
    this.fail(card.id, null);
    switch (action.id) {
      case 'assign':
        this.picking.set(this.picking() === card.id ? null : card.id);
        return;
      case 'do_myself':
        return this.settle(card, await work.handTicket?.(card.ticketId, 'you'));
      case 'option':
        return this.settle(card, await this.answer(card, action.answer ?? action.label));
      case 'write_answer':
        this.chat?.chatPrefill.set(this.i18n.t('mc.pcard.answer_prefill', { id: card.ticketId }));
        return;
      case 'send_back':
        work.openTicketSendBack?.(card.ticketId);
        return;
      case 'accept':
        return this.settle(card, await work.finishManual?.(card.ticketId));
      case 'resolve':
        work.openTicket?.(card.ticketId);
        return;
      case 'let_resolve':
        return this.settle(card, await work.startTicketRun?.(card.ticketId));
    }
  }

  async assign(card: PersonaCard, persona: string): Promise<void> {
    this.picking.set(null);
    this.settle(card, await this.work?.handTicket?.(card.ticketId, persona));
  }

  private answer(card: PersonaCard, text: string): Promise<{ readonly ok: boolean; readonly error?: string } | undefined> | undefined {
    const work = this.work;
    if (card.runId !== null && work?.answer !== undefined) {
      return work.answer(card.runId, text);
    }
    return work?.answerDecision?.(card.ticketId, card.decisionKey, text);
  }

  private settle(card: PersonaCard, reply: { readonly ok: boolean; readonly error?: string } | undefined): void {
    if (reply !== undefined && !reply.ok) {
      this.fail(card.id, reply.error ?? '');
      this.work?.toast?.(reply.error ?? '', 'error');
    }
  }

  private fail(id: string, words: string | null): void {
    this.errors.update((all) => {
      const { [id]: _gone, ...rest } = all;
      return words === null || words === '' ? rest : { ...rest, [id]: words };
    });
  }
}

function costOf(ticket: McTicket): number | null {
  return ticket.usage?.cost ?? ticket.cost ?? null;
}

function needOf(need: McNeed): readonly CardNeed[] {
  if (need.ticketId === undefined || need.ticketId === null) {
    return [];
  }
  return [
    {
      kind: need.kind,
      ticketId: need.ticketId,
      text: need.summary,
      runId: need.runId ?? null,
      since: need.since ?? null,
      ...(need.shaped === undefined ? {} : { shaped: need.shaped }),
      ...(need.questions === undefined ? {} : { questions: need.questions }),
    },
  ];
}
