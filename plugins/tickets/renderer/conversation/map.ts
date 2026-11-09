/**
 * The pure halves of the Assistant's Mission Control targets (E13-5): the
 * engine's chat session mapped to the SDK's (the persona 1:1 is persona-map.ts)
 * content-agnostic `ConversationThread`. No DOM, no IPC -- the target in
 * `targets.ts` calls these with what the plugin IPC returned.
 */
import type {
  ConversationCard,
  ConversationMessage,
  ConversationThread,
  ConversationThreadMeta,
} from '../../../../shared/plugin-api/renderer';
import type { BurnRateCard } from '../../../../shared/burn-rate';
import type { TrancheCard } from '../../../../shared/tranche';
import type { ChatModelFailure, ChatProposal, ChatSession, ChatSessionMeta } from '../../../../packages/tickets-engine/src/contracts/chat';

/** The chip on a persona's words: the persona speaks, Mission Control relays. */
export const VIA_MISSION_CONTROL = 'via Mission Control';

/** The planner's name; the shape session's relays carry it (concept D7). */
export const PLANNER_NAME = 'Paul';

export const NEW_CHAT_TITLE = 'New chat';

function proposalCard(proposal: ChatProposal): ConversationCard {
  const pending = proposal.state === 'pending';
  const note =
    proposal.state === 'confirmed'
      ? `Done${proposal.outcome !== null ? ` — ${proposal.outcome}` : ''}`
      : proposal.state === 'dismissed'
        ? 'Dismissed'
        : undefined;
  return {
    id: proposal.id,
    kind: 'card',
    text: proposal.summary,
    ...(note !== undefined ? { note } : {}),
    actions: pending
      ? [
          { id: 'confirm', label: 'Confirm', tone: 'primary' },
          { id: 'dismiss', label: 'Dismiss', tone: 'quiet' },
        ]
      : [],
  };
}

/**
 * The thread of one engine chat session. A proposal belongs to the
 * mission message it followed (the last one at or before its stamp); the
 * answer card of a question and the split card sit on their own message.
 * In a shape session (a ticket is attached) the relays are Paul's.
 */
export function threadOfSession(session: ChatSession): ConversationThread {
  const shape = typeof session.ticket === 'string' && session.ticket !== '';
  const lastIndex = session.messages.length - 1;
  const cardsAt = new Map<number, ConversationCard[]>();
  const attach = (index: number, card: ConversationCard): void => {
    cardsAt.set(index, [...(cardsAt.get(index) ?? []), card]);
  };
  for (const proposal of session.proposals) {
    let target = -1;
    session.messages.forEach((message, index) => {
      if (message.role === 'mission' && message.at <= proposal.at) {
        target = index;
      }
    });
    attach(target >= 0 ? target : Math.max(0, lastIndex), proposalCard(proposal));
  }
  const messages: ConversationMessage[] = session.messages.map((message, index) => {
    const id = `m-${index}`;
    if (message.role === 'owner') {
      const text =
        message.kind === 'plan-edit' ? `You edited the plan — ${message.text}` : message.text;
      return { id, role: 'user', text };
    }
    const cards = [...(cardsAt.get(index) ?? [])];
    // The answer card is open only while no owner message follows it.
    if (message.kind === 'question' && message.options !== undefined && index === lastIndex) {
      cards.push({
        id: `q-${index}`,
        kind: 'choices',
        text: message.text,
        choices: message.options.map((option) => ({ label: option.label, recommended: option.recommended })),
      });
    }
    if (message.kind === 'split' && (message.decision === undefined || message.decision === null)) {
      const parts = message.parts ?? 0;
      cards.push({
        id: `s-${index}`,
        kind: 'card',
        text: `Split into ${parts} ${parts === 1 ? 'ticket' : 'tickets'}, or keep it as one?`,
        actions: [
          { id: 'split', label: 'Split', tone: 'primary' },
          { id: 'keep', label: 'Keep as one', tone: 'quiet' },
        ],
      });
    }
    const relay = shape || message.kind === 'question' || message.kind === 'split';
    return {
      id,
      role: 'agent',
      text: message.text,
      ...(relay ? { author: PLANNER_NAME, via: VIA_MISSION_CONTROL } : {}),
      ...(message.thought !== null && message.thought !== '' ? { thought: message.thought } : {}),
      ...(cards.length > 0 ? { cards } : {}),
    };
  });
  return { id: session.file, title: session.title, messages };
}

/**
 * The checkpoint card (board 10u parts 1 and 6) as the agent message that closes
 * the Mission Control thread while a checkpoint waits: the shared card model
 * mapped onto the SDK's content-agnostic card fields (SDK 1.55). `meta` is the
 * catalog's "Mission Control · 14:02" with the locale time of the checkpoint.
 */
export function trancheMessageOf(card: TrancheCard, meta: string): ConversationMessage {
  return {
    id: card.id,
    role: 'agent',
    text: '',
    cards: [
      {
        id: card.id,
        kind: 'card',
        title: card.title,
        dot: card.tone,
        text: card.body ?? '',
        ...(card.metrics.length > 0
          ? { metrics: card.metrics.map((m) => ({ label: m.label, value: m.value, ...(m.sub === '' ? {} : { sub: m.sub, inline: m.inline }) })) }
          : {}),
        ...(card.rows.length > 0 ? { rows: card.rows.map((text) => ({ text, dot: 'negative' as const })) } : {}),
        ...(card.summary === null ? {} : { note: card.summary }),
        actions: card.actions.map((action) => ({ id: action.id, label: action.label, tone: action.primary ? ('primary' as const) : ('quiet' as const) })),
        meta,
      },
    ],
  };
}

/** The thread with the checkpoint card at its end; the thread itself when none waits. */
export function withTrancheMessage(thread: ConversationThread, message: ConversationMessage | null): ConversationThread {
  return message === null ? thread : { ...thread, messages: [...thread.messages, message] };
}

/**
 * The burn rate's card (req-181; board 10u's chrome, laid out like part 4,
 * the quota stop) as the agent message that closes the Mission Control
 * thread while the hold stands: title with the peach dot, body, the chips
 * (SDK 1.56), `Wait` and `Allow today once`. `meta` is `Mission Control ·
 * 22:40` with the time the hold rose; empty when the runner did not say.
 */
export function burnRateMessageOf(card: BurnRateCard, meta: string): ConversationMessage {
  return {
    id: card.id,
    role: 'agent',
    text: '',
    cards: [
      {
        id: card.id,
        kind: 'card',
        title: card.title,
        dot: card.tone,
        text: card.body,
        chips: card.chips,
        actions: card.actions.map((action) => ({ id: action.id, label: action.label, tone: action.primary ? ('primary' as const) : ('quiet' as const) })),
        ...(meta === '' ? {} : { meta }),
      },
    ],
  };
}

/** The history rows of the engine's session list. */
export function historyOfSessions(sessions: readonly ChatSessionMeta[]): readonly ConversationThreadMeta[] {
  return sessions.map((session) => ({
    id: session.file,
    title: session.title,
    updatedAt: session.updatedAt,
    ...(session.pending > 0 ? { pending: session.pending } : {}),
  }));
}

export const EMPTY_THREAD: ConversationThread = { id: null, title: NEW_CHAT_TITLE, messages: [] };

/** The error message a failed turn shows: the failure's own lines (D-1), or the bare error text. */
export function errorMessageOf(failure: ChatModelFailure | undefined, error: string | undefined): ConversationMessage {
  if (failure !== undefined) {
    const lines = [failure.reason];
    if (failure.baseUrl !== null) {
      lines.push(failure.baseUrl);
    }
    if (failure.model !== null) {
      lines.push(failure.model);
    }
    return { id: 'error', role: 'agent', text: '', error: { title: `${failure.providerLabel} could not answer`, lines } };
  }
  return { id: 'error', role: 'agent', text: '', error: { title: 'Mission Control could not answer', lines: [error ?? 'unknown error'] } };
}
