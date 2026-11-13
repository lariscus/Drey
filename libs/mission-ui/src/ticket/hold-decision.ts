// i18n: catalog
import { computed, inject, signal, type Signal } from '@angular/core';
import type { MessageKey, MessageParams } from '../../../../shared/i18n';
import { McI18n } from '../i18n/i18n.service';
import type { PadCard } from '../shell/pad-card';
import { YOU_LANE } from '../work/hold';
import { MC_WORK_STATE, type McAnswerReply } from '../work/work.model';
import {
  chainModesOf,
  defaultTargetOf,
  holdFlowOf,
  holdTargetsOf,
  holdTitleOf,
  positionCostViewOf,
  positionCostsOf,
  ticketHoldOf,
  type HoldFlow,
  type HoldTarget,
  type PositionCostView,
} from './hold-face';
import type { TicketDoc } from './ticket.model';

/** The proof's pass count, as the ticket screen reads it. */
export interface HoldChecks {
  readonly passed: number;
  readonly total: number;
}

export interface TicketHoldInputs {
  readonly doc: Signal<TicketDoc | null>;
  readonly readOnly: Signal<boolean>;
  readonly checks: Signal<HoldChecks | null>;
}

/** The holder row: the persona's picture and name. */
export interface HoldHolder {
  readonly persona: string;
  readonly name: string;
  readonly color: string;
}

/** The hold reasons the owner answers with Accept or Send back (a question and a missing persona have their own cards). */
const DECIDES: readonly string[] = ['entry', 'second-send-back'];

/**
 * The ticket screen's persona board half (req-273; boards 10e v2, 10o v2):
 * reads the open ticket's hold off the board, words the head chip, the flow
 * row, the holder and the cost by position, and owns the decision on a
 * ticket held by You — Accept (`finishManual`) or Send back to an earlier
 * position with a mandatory note (`sendBackManual`). Built in the view's
 * injection context; null-faced on a phase board ticket.
 */
export class TicketHoldFace {
  private readonly i18n = inject(McI18n);
  private readonly work = inject(MC_WORK_STATE, { optional: true });

  constructor(private readonly input: TicketHoldInputs) {}

  private readonly t = (key: MessageKey, params?: MessageParams): string => this.i18n.t(key, params);

  private readonly found = computed(() => ticketHoldOf(this.work?.board ?? null, this.input.doc()?.id ?? ''));
  private readonly id = computed(() => this.input.doc()?.id ?? '');

  /** True on a persona board ticket with a hold: the screen draws this face's rows. */
  readonly active = computed(() => this.found() !== null);
  /** The ticket waits at You's position. */
  readonly youHold = computed(() => this.found()?.hold.holder === YOU_LANE);

  readonly titleOf = (persona: string): string => holdTitleOf(this.found()?.lanes ?? [], persona, this.t);

  private readonly roleOf = (persona: string): string => {
    const record = (this.work?.personas ?? []).find((candidate) => candidate.id === persona) as { readonly role?: unknown } | undefined;
    return typeof record?.role === 'string' ? record.role : '';
  };

  private readonly modes = computed(() => {
    const found = this.found();
    return found === null ? [] : chainModesOf(found.hold, this.input.doc()?.chain ?? []);
  });

  /** The iPad's chip `You · 6 of 6` (10e v2). */
  readonly padChip = computed(() => {
    const hold = this.found()?.hold;
    return hold === undefined ? '' : this.t('board.position', { name: this.titleOf(hold.holder), at: hold.position, of: hold.length });
  });

  /** The phone's chip `6 of 6` (10o v2). */
  readonly phoneChip = computed(() => {
    const hold = this.found()?.hold;
    return hold === undefined ? '' : this.t('ticket.hold.position', { at: hold.position, of: hold.length });
  });

  readonly flow = computed<HoldFlow | null>(() => {
    const hold = this.found()?.hold;
    return hold === undefined ? null : holdFlowOf(hold, this.titleOf, this.t);
  });

  /** The phone's flow runs: `✓ Paul · ✓ Ben`, then the rest after the note. */
  readonly phoneDone = computed(() => (this.flow()?.done ?? []).map((cell) => cell.label).join(' · '));
  readonly phoneRest = computed(() => (this.flow()?.rest ?? []).map((cell) => `· ${cell.label}`).join(' '));

  readonly holder = computed<HoldHolder | null>(() => {
    const found = this.found();
    if (found === null) {
      return null;
    }
    const persona = found.hold.holder;
    const lane = found.lanes.find((candidate) => candidate.persona === persona)?.color ?? '';
    const listed = this.work?.personas.find((candidate) => candidate.id === persona)?.color ?? '';
    return { persona, name: this.titleOf(persona), color: lane || listed || 'var(--text-2)' };
  });

  /** The cost by position; null while no run has settled. */
  readonly costs = computed<PositionCostView | null>(() => {
    const found = this.found();
    const entries = this.input.doc()?.verlauf ?? [];
    if (found === null || entries.length === 0) {
      return null;
    }
    return positionCostViewOf(this.i18n, positionCostsOf(entries, found.hold, this.modes()), found.hold.length, this.titleOf);
  });

  // --- the decision ------------------------------------------------------------------

  /** The earlier positions a send-back may go to; null = no decision here (not You's, a question, read-only). */
  readonly targets = computed<readonly HoldTarget[] | null>(() => {
    const found = this.found();
    if (found === null || !this.youHold() || !DECIDES.includes(found.hold.why) || this.input.readOnly() || this.work?.finishManual === undefined) {
      return null;
    }
    return holdTargetsOf(found.hold, this.modes(), this.titleOf, this.roleOf, this.t);
  });

  private readonly picked = signal<number | null>(null);
  private readonly preset = computed(() => {
    const hold = this.found()?.hold;
    return hold === undefined ? null : defaultTargetOf(hold, this.roleOf);
  });

  readonly target = computed<number | null>(() => {
    const picked = this.picked();
    return picked !== null && (this.targets() ?? []).some((row) => row.position === picked) ? picked : this.preset();
  });

  readonly targetRow = computed<HoldTarget | null>(() => (this.targets() ?? []).find((row) => row.position === this.target()) ?? null);

  readonly note = signal('');
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly done = signal<string | null>(null);
  /** The phone's Send back… opens the note under the picker. */
  readonly noteOpen = signal(false);

  /** The persona whose position came just before You's: the one who passed the checks. */
  private readonly passedBy = computed<string | null>(() => {
    const hold = this.found()?.hold;
    const persona = hold === undefined ? undefined : hold.chain[hold.position - 2];
    return persona === undefined || persona === YOU_LANE ? null : this.titleOf(persona);
  });

  /** Mission Control's lead line over the iPad card. */
  readonly lead = computed(() => {
    const checks = this.input.checks();
    const name = this.passedBy();
    if (checks === null || name === null) {
      return this.t('ticket.hold.lead', { id: this.id() });
    }
    return checks.passed === checks.total
      ? this.t('ticket.hold.lead_green', { name, n: checks.total, id: this.id() })
      : this.t('ticket.hold.lead_red', { name, passed: checks.passed, total: checks.total, id: this.id() });
  });

  /** The iPad link to the card: `Decision waiting · Tessa passed 4 of 4 checks`. */
  readonly link = computed(() => {
    const checks = this.input.checks();
    const name = this.passedBy();
    return checks === null || name === null
      ? this.t('ticket.pad.decision_ready')
      : this.t('ticket.hold.decision_checks', { name, passed: checks.passed, total: checks.total });
  });

  /** The phone bar's bold head and its line. */
  readonly head = computed(() => this.t('ticket.phone.ready_head', { id: this.id() }));
  readonly body = computed(() => {
    const checks = this.input.checks();
    if (checks === null) {
      return '';
    }
    return checks.passed === checks.total
      ? this.t('ticket.hold.ready_green', { n: checks.total })
      : this.t('ticket.phone.ready_red', { passed: checks.passed, total: checks.total });
  });

  readonly sendBackLabel = computed(() => {
    const row = this.targetRow();
    return row === null ? this.t('ticket.phone.send_back_now') : this.t('ticket.hold.send_back_named', { name: this.titleOf(row.persona) });
  });

  /** A radio row's position, or the phone select's value. */
  pickTarget(position: number | string): void {
    this.picked.set(Number(position));
    this.error.set(null);
  }

  setNote(text: string): void {
    this.note.set(text);
    if (text.trim() !== '') {
      this.error.set(null);
    }
  }

  toggleNote(): void {
    this.noteOpen.update((open) => !open);
    this.error.set(null);
  }

  async accept(): Promise<void> {
    const finish = this.work?.finishManual;
    if (finish !== undefined && !this.busy()) {
      await this.run(() => finish.call(this.work, this.id()), this.t('ticket.phone.accepted'));
    }
  }

  async sendBack(): Promise<void> {
    const back = this.work?.sendBackManual;
    const position = this.target();
    if (back === undefined || position === null || this.busy()) {
      return;
    }
    if (this.note().trim() === '') {
      this.error.set(this.t('ticket.phone.sendback_why'));
      return;
    }
    await this.run(() => back.call(this.work, this.id(), this.note().trim(), position), this.t('ticket.phone.sent_back'));
  }

  private async run(call: () => Promise<McAnswerReply>, done: string): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      const reply = await call();
      if (reply.ok) {
        this.noteOpen.set(false);
        this.done.set(done);
      } else {
        this.error.set(reply.error || this.t('ticket.phone.refused'));
      }
    } catch {
      this.error.set(this.t('ticket.phone.no_answer'));
    } finally {
      this.busy.set(false);
    }
  }

  /** A fresh ticket starts with the preset target, an empty note and nothing decided. */
  reset(): void {
    this.picked.set(null);
    this.note.set('');
    this.busy.set(false);
    this.error.set(null);
    this.done.set(null);
    this.noteOpen.set(false);
  }

  /** The iPad's card in the Assistant (10e v2); null when no decision waits here. */
  readonly padCard = computed<PadCard | null>(() => {
    const targets = this.targets();
    if (targets === null) {
      return null;
    }
    return {
      question: this.t('ticket.hold.ready_title', { id: this.id() }),
      why: null,
      options: [],
      selected: this.target,
      busy: this.busy,
      error: this.error,
      done: this.done,
      hold: {
        who: this.t('menu.mission_control'),
        lead: this.lead(),
        acceptLabel: this.t('board.accept'),
        targetsLabel: this.t('ticket.hold.send_back_to'),
        targets,
        target: this.target,
        sendBackLabel: this.sendBackLabel,
        note: this.note,
        noteLabel: this.t('ticket.phone.sendback_why'),
        setNote: (text) => this.setNote(text),
        pickTarget: (position) => this.pickTarget(position),
        accept: () => void this.accept(),
        sendBack: () => void this.sendBack(),
      },
      pick: () => undefined,
      send: () => undefined,
    };
  });
}
