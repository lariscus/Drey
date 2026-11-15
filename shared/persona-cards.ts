/**
 * The persona board's four Mission Control cards (req-273, board MCCardsV2):
 * no persona for a position, a run's question, a ticket sent back twice and
 * a merge conflict while a persona merged main. One pure model — the phone /
 * iPad / desk web client (`libs/mission-ui/src/chat/persona-cards/`) and the
 * desktop Assistant's Mission Control conversation both draw it, so every
 * device says the same words from the catalog (`mc.pcard.*`).
 *
 * The inputs are structural slices of what both clients already read: the
 * board's lanes and each active ticket's hold, and the Needs-you items.
 */
import type { CardHold, CardLane, CardNeed, CardTicket, PersonaCard, PersonaCardAction, PersonaCardActionId, PersonaCardCell, PersonaCardFormat, PersonaCardKind, PersonaCardLine, PersonaCardRow, PersonaCardsInput } from './persona-cards-types';

import { PERSONA_CARD_PREFIX } from './persona-cards-types';
export * from './persona-cards-types';

const KIND_ORDER: readonly PersonaCardKind[] = ['question', 'second-send-back', 'merge-conflict', 'no-persona'];
const KEYED = /^\[([a-z0-9][a-z0-9-]*)\]\s*/;
const SECOND = /^a second send-back from position (\d+): ([\s\S]*)$/;
const CONFLICT = /^sync-main: merging (\S+) conflicts in (.+?) — the merge was aborted/;
const SENT_BACK_LINE = /sent back \d+>\d+ — from \d+ \(([^)]*)\) to \d+ \(([^)]*)\)(?::\s*(.*?))?; positions? /;

/** The title a lane or id shows; the id itself when no lane names it. */
export function cardPersonaTitleOf(lanes: readonly CardLane[], persona: string): string {
  return lanes.find((lane) => lane.persona === persona)?.title || persona;
}

const initialsOf = (title: string): string => title.trim().slice(0, 2).toUpperCase();

function cellsOf(hold: CardHold, lanes: readonly CardLane[], missingNow: boolean, f: PersonaCardFormat): readonly PersonaCardCell[] {
  return hold.chain.map((persona, index) => {
    const position = index + 1;
    const name = cardPersonaTitleOf(lanes, persona);
    const state = position < hold.position ? 'done' : position === hold.position ? 'now' : 'next';
    if (state === 'now' && missingNow) {
      return { initials: '··', title: f.t('mc.pcard.cell.missing'), state, color: null, missing: true };
    }
    const title = state === 'done' ? f.t('mc.pcard.cell.done', { name }) : state === 'now' ? f.t('mc.pcard.cell.now', { name }) : name;
    return { initials: initialsOf(name), title, state, color: lanes.find((lane) => lane.persona === persona)?.color || null, missing: false };
  });
}

const stripKey = (text: string): string => text.replace(KEYED, '').trim();
const keyOf = (text: string): string | null => KEYED.exec(text)?.[1] ?? null;
const holderAt = (hold: CardHold): string => hold.chain[hold.position - 1] ?? hold.holder;

interface Question {
  readonly text: string;
  readonly options: readonly { readonly label: string; readonly answer: string }[];
}

/** The question a need asks and the options it offers (a shaped turn wins over a form; neither = the plain text). */
export function cardQuestionOf(need: CardNeed): Question {
  const shaped = need.shaped;
  if (shaped !== undefined && shaped.options.length >= 2) {
    return { text: shaped.question, options: shaped.options.map((o) => ({ label: o.label, answer: `${o.n}. ${o.label}` })) };
  }
  const form = need.questions?.[0];
  if (form !== undefined && form.options.length >= 2) {
    return { text: form.question, options: form.options.map((o) => ({ label: o.label, answer: o.label })) };
  }
  return { text: stripKey(need.text), options: [] };
}

function metaOf(since: string | null, now: Date, f: PersonaCardFormat): string {
  const at = since === null ? Number.NaN : Date.parse(since);
  return f.t('card.meta', { time: f.time(Number.isNaN(at) ? now : new Date(at)) });
}

const button = (id: PersonaCardActionId, label: string, primary: boolean, answer?: string): PersonaCardAction =>
  answer === undefined ? { id, label, primary } : { id, label, primary, answer };

interface Draft {
  readonly kind: PersonaCardKind;
  readonly ticket: CardTicket;
  readonly hold: CardHold;
  readonly title: string;
  readonly lines: readonly PersonaCardLine[];
  readonly missingNow?: boolean;
  readonly side?: string;
  readonly rows?: readonly PersonaCardRow[];
  readonly actions: readonly PersonaCardAction[];
  readonly need: CardNeed | null;
}

function finish(draft: Draft, input: PersonaCardsInput, f: PersonaCardFormat, now: Date): PersonaCard {
  const { hold, ticket } = draft;
  const persona = holderAt(hold);
  const who =
    draft.kind === 'no-persona'
      ? f.t('mc.pcard.position', { at: hold.position, of: hold.length })
      : f.t('board.position', { name: cardPersonaTitleOf(input.lanes, persona), at: hold.position, of: hold.length });
  return {
    id: `${PERSONA_CARD_PREFIX}${draft.kind}-${ticket.id}`,
    kind: draft.kind,
    ticketId: ticket.id,
    tone: draft.kind === 'merge-conflict' ? 'negative' : 'attention',
    title: draft.title,
    lines: draft.lines,
    cells: cellsOf(hold, input.lanes, draft.missingNow === true, f),
    who,
    side: draft.side ?? (ticket.cost !== null && ticket.cost > 0 && draft.kind !== 'no-persona' ? f.money(ticket.cost) : ''),
    rows: draft.rows ?? [],
    actions: draft.actions,
    meta: metaOf(draft.need?.since ?? null, now, f),
    runId: draft.need?.runId ?? null,
    decisionKey: draft.need === null ? null : keyOf(draft.need.text),
    persona,
    position: hold.position,
  };
}

function noPersonaCard(ticket: CardTicket, hold: CardHold, f: PersonaCardFormat): Draft {
  return {
    kind: 'no-persona',
    ticket,
    hold,
    title: f.t('mc.pcard.title.no_persona', { id: ticket.id, at: hold.position }),
    lines: [{ text: ticket.title, style: 'normal' }],
    missingNow: true,
    actions: [button('assign', f.t('mc.pcard.action.assign'), true), button('do_myself', f.t('mc.pcard.action.do_myself'), false)],
    need: null,
  };
}

function questionCard(ticket: CardTicket, hold: CardHold, need: CardNeed, input: PersonaCardsInput, f: PersonaCardFormat): Draft {
  const question = cardQuestionOf(need);
  const name = cardPersonaTitleOf(input.lanes, hold.named ?? holderAt(hold));
  const options = question.options.map((option, index) => button('option', option.label, index === 0, option.answer));
  return {
    kind: 'question',
    ticket,
    hold,
    title: f.t('mc.pcard.title.question', { id: ticket.id, name }),
    lines: [
      { text: question.text, style: 'strong' },
      { text: ticket.title, style: 'muted' },
    ],
    actions: [...options, button('write_answer', f.t('mc.pcard.action.write_answer'), options.length === 0)],
    need,
  };
}

/** The first send-back's reason row, read off the ticket's Log when a client has it; its names only otherwise. */
function firstReasonOf(ticket: CardTicket, hold: CardHold, input: PersonaCardsInput, f: PersonaCardFormat): string | null {
  const earlier = hold.sentBack;
  if (earlier === null) {
    return null;
  }
  const lines = (input.logs?.[ticket.id] ?? '').split('\n').filter((line) => SENT_BACK_LINE.test(line));
  const found = SENT_BACK_LINE.exec(lines[lines.length - 1] ?? '');
  const name = (id: string): string => cardPersonaTitleOf(input.lanes, id);
  const from = found?.[1] !== undefined ? name(found[1]) : name(hold.chain[earlier.from - 1] ?? '');
  const to = found?.[2] !== undefined ? name(found[2]) : name(hold.chain[earlier.to - 1] ?? '');
  const reason = found?.[3]?.trim() ?? '';
  return reason === '' ? f.t('mc.pcard.reason.pair_bare', { from, to }) : f.t('mc.pcard.reason.pair', { from, to, text: reason });
}

function secondSendBackCard(ticket: CardTicket, hold: CardHold, need: CardNeed | null, input: PersonaCardsInput, f: PersonaCardFormat): Draft {
  const texts: string[] = [];
  const first = firstReasonOf(ticket, hold, input, f);
  if (first !== null) {
    texts.push(first);
  }
  const second = SECOND.exec(stripKey(need?.text ?? ''));
  if (second !== null) {
    const from = cardPersonaTitleOf(input.lanes, hold.chain[Number(second[1]) - 1] ?? '');
    texts.push(f.t('mc.pcard.reason.from', { from, text: (second[2] ?? '').trim() }));
  }
  return {
    kind: 'second-send-back',
    ticket,
    hold,
    title: f.t('mc.pcard.title.sent_back_twice', { id: ticket.id }),
    lines: [{ text: ticket.title, style: 'normal' }],
    rows: texts.map((text, index) => ({ mark: String(index + 1), text, mono: false })),
    actions: [button('send_back', f.t('mc.pcard.action.send_back'), true), button('accept', f.t('mc.pcard.action.accept'), false)],
    need,
  };
}

function conflictCard(ticket: CardTicket, hold: CardHold, need: CardNeed, input: PersonaCardsInput, f: PersonaCardFormat): Draft | null {
  const found = CONFLICT.exec(need.text);
  if (found === null) {
    return null;
  }
  const main = found[1] ?? 'main';
  const files = (found[2] ?? '').split(',').map((file) => file.trim()).filter((file) => file !== '');
  const name = cardPersonaTitleOf(input.lanes, holderAt(hold));
  return {
    kind: 'merge-conflict',
    ticket,
    hold,
    title: f.t('mc.pcard.title.conflict', { id: ticket.id, main }),
    lines: [{ text: f.t('mc.pcard.body.conflict', { count: files.length, files: files.join(', '), name }), style: 'normal' }],
    side: f.t('mc.pcard.side.merging', { main }),
    rows: files.map((file) => ({ mark: 'C', text: file, mono: true })),
    actions: [
      button('resolve', f.t('mc.pcard.action.resolve'), true),
      button('let_resolve', f.t('mc.pcard.action.let_resolve', { name }), false),
      button('do_myself', f.t('mc.pcard.action.do_myself'), false),
    ],
    need,
  };
}

const isQuestionNeed = (need: CardNeed): boolean => (need.kind === 'question' || need.kind === 'needs-decision') && keyOf(need.text) !== 'second-send-back';

function draftOf(ticket: CardTicket, hold: CardHold, input: PersonaCardsInput, f: PersonaCardFormat): readonly Draft[] {
  const needs = input.needs.filter((need) => need.ticketId === ticket.id);
  const drafts: Draft[] = [];
  if (hold.why === 'no-persona') {
    drafts.push(noPersonaCard(ticket, hold, f));
  } else if (hold.why === 'question') {
    const need = needs.find(isQuestionNeed);
    if (need !== undefined) {
      drafts.push(questionCard(ticket, hold, need, input, f));
    }
  } else if (hold.why === 'second-send-back') {
    drafts.push(secondSendBackCard(ticket, hold, needs.find((need) => keyOf(need.text) === 'second-send-back') ?? null, input, f));
  }
  const conflict = needs.find((need) => (need.kind === 'red-gate' || need.kind === 'failed') && CONFLICT.test(need.text));
  const conflictDraft = conflict === undefined ? null : conflictCard(ticket, hold, conflict, input, f);
  return conflictDraft === null ? drafts : [...drafts, conflictDraft];
}

/** Every persona-board card that waits on the owner, in reading order; none on a board without lanes. */
export function personaCardsOf(input: PersonaCardsInput, f: PersonaCardFormat, now: Date = new Date()): readonly PersonaCard[] {
  if (input.lanes.length === 0) {
    return [];
  }
  const drafts = input.tickets.flatMap((ticket) => (ticket.hold === null ? [] : draftOf(ticket, ticket.hold, input, f)));
  return drafts
    .map((draft) => ({ draft, order: KIND_ORDER.indexOf(draft.kind) }))
    .sort((a, b) => a.order - b.order || a.draft.ticket.id.localeCompare(b.draft.ticket.id))
    .map(({ draft }) => finish(draft, input, f, now));
}
