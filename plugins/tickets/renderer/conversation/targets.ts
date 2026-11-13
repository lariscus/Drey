/**
 * The tickets plugin's conversation targets for the Assistant (E13-5, SDK
 * 1.41): **Mission Control** (the engine's chat, Pia; the plugin IPC `mc*`
 * forwards to `ChatService`) and **1:1** with each persona of the team
 * (the merged persona conversation of E12-4: the owner's messages to that
 * persona). The Assistant knows none of this -- it draws whatever
 * `conversations.registerTargets` is handed.
 */
import type {
  ConversationTarget,
  ConversationTargetProvider,
  ConversationThread,
} from '../../../../shared/plugin-api/renderer';
import type {
  ChatDecisionResult,
  ChatSession,
  ChatSessionMeta,
  ChatTurnResult,
} from '../../../../packages/tickets-engine/src/contracts/chat';
import type { PersonaView } from '../../shared/remote-protocol';
import { BURN_RATE_CARD_PREFIX, burnRateCardOf, type BurnRateCard, type BurnRateFormat, type BurnRateHoldView } from '../../../../shared/burn-rate';
import { PERSONA_CARD_PREFIX } from '../../../../shared/persona-cards';
import { trancheCardOf, type TrancheCard, type TrancheFormat, type TrancheView } from '../../../../shared/tranche';
import type { ShapeTarget } from '../ticket-document/shape';
import {
  EMPTY_THREAD,
  PLANNER_NAME,
  errorMessageOf,
  burnRateMessageOf,
  personaCardMessageOf,
  ASSIGN_PREFIX,
  trancheMessageOf,
  withTrancheMessage,
  historyOfSessions,
  threadOfSession,
} from './map';
import type { PersonaCardsBinding } from './persona-cards';
import { ACCEPT, DISMISS, followsFleet, threadOfPersona, type PersonaWords } from './persona-map';

/** The id a view preset names as its `assistantTarget` (the Work view: Mission Control). */
export const MISSION_CONTROL_TARGET = 'tickets.mission-control';

/** The switcher segment the persona targets share. */
export const PERSONA_GROUP = '1:1';

export const personaTargetId = (personaId: string): string => `tickets.persona.${personaId}`;

export interface ConversationDeps {
  /** The plugin IPC (`api.backend.invoke`). */
  invoke(method: string, payload?: unknown): Promise<unknown>;
  /** The team directory (the Team tab's store). */
  personas(): readonly PersonaView[];
  /** Fires when the directory changed; returns the unsubscribe. */
  subscribePersonas(listener: () => void): () => void;
  /** The ticket document in focus, when there is one to shape (E13-9); absent = Mission Control never shapes. */
  shape?: ShapeBinding;
  /** The waiting checkpoint (req-179); absent = Mission Control carries no checkpoint card. */
  tranche?: TrancheBinding;
  /** The burn rate's hold (req-181); absent = Mission Control carries no burn-rate card. */
  hold?: HoldBinding;
  /** req-273: the persona board's four cards (no persona, a question, sent back twice, a merge conflict); absent = Mission Control carries none. */
  personaCards?: PersonaCardsBinding;
  /** req-168: the 1:1's words (catalog, clock); absent = the keys themselves (a spec). */
  words?: PersonaWords;
  /** req-168: fires on every board and fleet change; returns the unsubscribe. Absent = the 1:1 is read on calls only. */
  subscribeChanges?(listener: (what: 'board' | 'fleet') => void): () => void;
}

/** The words of a spec without a catalog: the key itself, the time as HH:MM. */
const KEY_WORDS: PersonaWords = { t: (key) => key, formatTime: (date) => date.toISOString().slice(11, 16) };

/** What Mission Control needs of the burn rate's hold: the chain's block, the words, and the lift its card can do. */
export interface HoldBinding {
  view(): BurnRateHoldView | null;
  format(): BurnRateFormat;
  /** "Allow today once" (`chainHoldLift`); resolves the words of a refusal, or null when it went through. */
  lift(): Promise<string | null>;
  /** Fires on every chain status; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
}

/** What Mission Control needs of the tranche: the chain's block, the words, and the two things its card can do. */
export interface TrancheBinding {
  view(): TrancheView | null;
  format(): TrancheFormat;
  /** The locale's time of day (`api.i18n.formatTime`). */
  formatTime(date: Date): string;
  /** Autopilot On; resolves the words of a refusal, or null when it went through. */
  release(): Promise<string | null>;
  /** Settings → Tickets. */
  adjust(): void;
  /** Fires on every chain status; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
}

/** The id prefix of the checkpoint card (`tranche-<index>-<at>`): its buttons are the plugin's, not the engine chat's. */
const TRANCHE_CARD_PREFIX = 'tranche-';

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * The shape binding (E13-9): the ticket document in focus that can be
 * shaped with Paul, and what the Assistant needs from the editor around a
 * turn. The target reads it on every call, so the thread follows the open
 * ticket without the Assistant knowing a ticket from a note.
 */
export interface ShapeBinding {
  /** The ticket document in focus (an Ideas-phase ticket without a live run), or null. */
  current(): ShapeTarget | null;
  /** Saves the open buffer so the engine reads what the owner wrote; resolves a sentence when it could not. */
  flush(target: ShapeTarget): Promise<string | null>;
  /** Blocks typing in the document while Paul works on it. */
  lock(target: ShapeTarget, locked: boolean): void;
  /** A turn or a decision ended: waits until the open tab shows what is on disk, then the marks and the board look again. */
  settled(target: ShapeTarget): Promise<void> | void;
  /** Fires when `current()` may have a new answer; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
}

/** Pia: the engine's chat sessions. */
export function createMissionControlTarget(deps: ConversationDeps): ConversationTarget {
  let file: string | null = null;
  /** The ticket whose shape session `file` is; null for a plain chat. */
  let fileTicket: string | null = null;
  /** A failed turn is not part of the session file; it hangs on the thread until the next send. */
  let lastError: ReturnType<typeof errorMessageOf> | null = null;
  /** The checkpoint whose "Open report" was pressed (an early stop shows its figures then). */
  let reportOpenFor: string | null = null;
  /** The burn-rate card the owner answered with "Wait" (one per day: its id carries the resume time). */
  let holdDismissed: string | null = null;
  /** The persona card whose Assign… picker is open. */
  let assigning: string | null = null;

  const holdCard = (): BurnRateCard | null => {
    const view = deps.hold?.view() ?? null;
    const card = view === null || deps.hold === undefined ? null : burnRateCardOf(view, deps.hold.format());
    return card === null || card.id === holdDismissed ? null : card;
  };

  const trancheCard = (): TrancheCard | null => {
    const binding = deps.tranche;
    const view = binding?.view() ?? null;
    if (binding === undefined || view === null) {
      return null;
    }
    const first = trancheCardOf(view, binding.format());
    return first !== null && reportOpenFor === first.id ? trancheCardOf(view, binding.format(), true) : first;
  };
  const withHold = (thread: ConversationThread): ConversationThread => {
    const card = holdCard();
    if (card === null || deps.hold === undefined) {
      return thread;
    }
    const f = deps.hold.format();
    const meta = card.at === null ? '' : f.t('checkpoint.meta', { time: f.time(new Date(card.at)) });
    return withTrancheMessage(thread, burnRateMessageOf(card, meta));
  };
  /** The persona board's cards close the thread after the hold; the Assign… picker is open on at most one. */
  const withPersonaCards = (thread: ConversationThread): ConversationThread => {
    const binding = deps.personaCards;
    if (binding === undefined) {
      return thread;
    }
    const agents = binding.agents();
    const messages = binding.cards().map((card) => personaCardMessageOf(card, card.id === assigning ? agents : null));
    return messages.length === 0 ? thread : { ...thread, messages: [...thread.messages, ...messages] };
  };
  const decorated = (thread: ConversationThread): ConversationThread => withPersonaCards(decoratedBase(thread));
  const decoratedBase = (thread: ConversationThread): ConversationThread => {
    const binding = deps.tranche;
    const card = trancheCard();
    if (binding === undefined || card === null) {
      return withHold(thread);
    }
    const time = binding.formatTime(new Date(card.at));
    return withHold(withTrancheMessage(thread, trancheMessageOf(card, binding.format().t('checkpoint.meta', { time }))));
  };

  const attachedTo = (thread: ConversationThread, shape: ShapeTarget | null): ConversationThread =>
    shape === null ? thread : { ...thread, attached: [`${shape.label} attached`] };

  const withError = (thread: ConversationThread): ConversationThread =>
    lastError === null ? thread : { ...thread, messages: [...thread.messages, lastError] };

  const open = async (path: string, shape: ShapeTarget | null): Promise<ConversationThread> => {
    try {
      const session = (await deps.invoke('mcOpen', { file: path })) as ChatSession | null;
      if (session === null || typeof session !== 'object' || !('messages' in session)) {
        file = null;
        return EMPTY_THREAD;
      }
      file = session.file;
      fileTicket = shape?.id ?? null;
      return withError(attachedTo(threadOfSession(session), shape));
    } catch (error) {
      return { ...EMPTY_THREAD, messages: [errorMessageOf(undefined, messageOf(error))] };
    }
  };

  const sessionsOf = async (): Promise<readonly ChatSessionMeta[]> => {
    const sessions = (await deps.invoke('mcSessions')) as readonly ChatSessionMeta[];
    return Array.isArray(sessions) ? sessions : [];
  };

  /** The newest shape session of a ticket (the engine lists newest first), or null. */
  const shapeFileOf = async (ticket: string): Promise<string | null> =>
    (await sessionsOf()).find((session) => session.ticket === ticket)?.file ?? null;

  /**
   * The thread the panel shows now. With a ticket document in focus that
   * is that ticket's shape session (a fresh composer when it has none);
   * otherwise the open session, or the newest one.
   */
  const read = async (): Promise<ConversationThread> => {
    const shape = deps.shape?.current() ?? null;
    try {
      if (shape !== null) {
        if (fileTicket !== shape.id) {
          file = await shapeFileOf(shape.id);
          fileTicket = shape.id;
        }
        if (file === null) {
          return withError(
            attachedTo({ ...EMPTY_THREAD, title: `Shape ${shape.id}`, notice: `Shaping ${shape.id} with ${PLANNER_NAME}` }, shape),
          );
        }
        return open(file, shape);
      }
      if (fileTicket !== null) {
        file = null;
        fileTicket = null;
      }
      if (file === null) {
        const newest = (await sessionsOf())[0];
        if (newest === undefined) {
          return withError(EMPTY_THREAD);
        }
        return open(newest.file, null);
      }
      return open(file, null);
    } catch (error) {
      return { ...EMPTY_THREAD, messages: [errorMessageOf(undefined, messageOf(error))] };
    }
  };

  /** A button of the checkpoint card: Release (and "Release anyway") writes the Autopilot On, Adjust opens Settings, Open report adds the figures. */
  const actOnCheckpoint = async (cardId: string, actionId: string): Promise<ConversationThread> => {
    const binding = deps.tranche;
    if (binding === undefined) {
      return read();
    }
    if (actionId === 'adjust') {
      binding.adjust();
    } else if (actionId === 'open_report') {
      reportOpenFor = cardId;
    } else if (actionId === 'release' || actionId === 'release_anyway') {
      const words = await binding.release();
      if (words !== null) {
        lastError = errorMessageOf(undefined, words);
      }
    }
    return read();
  };

  /** A button of the burn-rate card: Wait dismisses it for the day, Allow today once lifts the hold. */
  const actOnHold = async (cardId: string, actionId: string): Promise<ConversationThread> => {
    if (actionId === 'wait') {
      holdDismissed = cardId;
    } else if (actionId === 'allow_once' && deps.hold !== undefined) {
      const words = await deps.hold.lift();
      if (words !== null) {
        lastError = errorMessageOf(undefined, words);
      }
    }
    return read();
  };

  /** A button of a persona card: Assign… opens the picker, a picked persona hands the ticket over, the rest is the card's own action. */
  const actOnPersonaCard = async (cardId: string, actionId: string): Promise<ConversationThread> => {
    const binding = deps.personaCards;
    const card = binding?.cards().find((candidate) => candidate.id === cardId);
    if (binding === undefined || card === undefined) {
      return read();
    }
    let words: string | null = null;
    if (actionId.startsWith(ASSIGN_PREFIX)) {
      assigning = null;
      words = await binding.assign(card, actionId.slice(ASSIGN_PREFIX.length));
    } else {
      const action = card.actions[Number(actionId)];
      if (action?.id === 'assign') {
        assigning = assigning === cardId ? null : cardId;
      } else if (action !== undefined) {
        words = await binding.act(card, action);
      }
    }
    if (words !== null) {
      lastError = errorMessageOf(undefined, words);
    }
    return read();
  };

  return {
    id: MISSION_CONTROL_TARGET,
    label: 'Mission Control',
    icon: 'rocket',
    description: 'Talk to Mission Control: it knows the board and proposes changes you confirm',
    thread: async () => decorated(await read()),
    send: async (text, options) => {
      lastError = null;
      const reference = options?.context === undefined || options.context === '' ? {} : { context: options.context };
      const shape = deps.shape?.current() ?? null;
      if (shape !== null && deps.shape !== undefined) {
        // Paul reads the file: whatever the owner typed into the plan goes to disk first.
        const problem = await deps.shape.flush(shape);
        if (problem !== null) {
          lastError = errorMessageOf(undefined, problem);
          return decorated(await read());
        }
        deps.shape.lock(shape, true);
      }
      try {
        if (shape !== null && fileTicket !== shape.id) {
          file = await shapeFileOf(shape.id).catch(() => null);
          fileTicket = shape.id;
        }
        let result: ChatTurnResult;
        try {
          result = (await (file === null
            ? deps.invoke('mcStart', shape === null ? { text, ...reference } : { text, ticket: shape.id, ...reference })
            : deps.invoke('mcSend', { file, text, ...reference }))) as ChatTurnResult;
        } catch (error) {
          lastError = errorMessageOf(undefined, messageOf(error));
          return decorated(await read());
        }
        if (typeof result.file === 'string') {
          file = result.file;
          fileTicket = shape?.id ?? null;
        }
        if (result.ok !== true) {
          lastError = errorMessageOf(result.failure, result.error);
        }
        return decorated(await read());
      } finally {
        if (shape !== null) {
          deps.shape?.lock(shape, false);
          await deps.shape?.settled(shape);
        }
      }
    },
    act: async (cardId, actionId) => {
      lastError = null;
      if (cardId.startsWith(TRANCHE_CARD_PREFIX)) {
        return decorated(await actOnCheckpoint(cardId, actionId));
      }
      if (cardId.startsWith(PERSONA_CARD_PREFIX)) {
        return decorated(await actOnPersonaCard(cardId, actionId));
      }
      if (cardId.startsWith(BURN_RATE_CARD_PREFIX)) {
        return decorated(await actOnHold(cardId, actionId));
      }
      if (file === null) {
        return EMPTY_THREAD;
      }
      const shape = deps.shape?.current() ?? null;
      try {
        let result: { ok?: boolean; error?: string };
        if (cardId.startsWith('s-')) {
          result = (await deps.invoke('mcShapeDecide', { file, choice: actionId })) as { ok?: boolean; error?: string };
        } else {
          result = (await deps.invoke('mcDecide', { file, id: cardId, decision: actionId })) as ChatDecisionResult;
        }
        if (result.ok !== true) {
          lastError = errorMessageOf(undefined, result.error);
        }
      } catch (error) {
        lastError = errorMessageOf(undefined, messageOf(error));
      }
      if (shape !== null) {
        // "Keep as one" moves the ticket into the build queue: the board and the marks look again.
        await deps.shape?.settled(shape);
      }
      return decorated(await read());
    },
    newThread: async () => {
      file = null;
      fileTicket = null;
      lastError = null;
      return attachedTo(EMPTY_THREAD, deps.shape?.current() ?? null);
    },
    history: async () => {
      try {
        return historyOfSessions(await sessionsOf());
      } catch {
        return [];
      }
    },
    open: async (id) => {
      lastError = null;
      return open(id, null);
    },
    ...(deps.shape === undefined && deps.tranche === undefined && deps.hold === undefined && deps.personaCards === undefined
      ? {}
      : {
          // The thread changes with the ticket in focus, the checkpoint that waits and the burn rate's hold.
          onThreadChange: (listener: () => void) => {
            const { shape, tranche, hold, personaCards } = deps;
            let seenShape = shape?.current()?.id ?? null;
            let seenCard = trancheCard()?.id ?? null;
            let seenHold = holdCard()?.id ?? null;
            const personaSignature = (): string => (personaCards?.cards() ?? []).map((card) => card.id).join();
            let seenPersona = personaSignature();
            const offs = [
              shape?.subscribe(() => {
                const now = shape.current()?.id ?? null;
                if (now !== seenShape) {
                  seenShape = now;
                  listener();
                }
              }),
              tranche?.subscribe(() => {
                const now = trancheCard()?.id ?? null;
                if (now !== seenCard) {
                  seenCard = now;
                  listener();
                }
              }),
              personaCards?.subscribe(() => {
                const now = personaSignature();
                if (now !== seenPersona) {
                  seenPersona = now;
                  listener();
                }
              }),
              hold?.subscribe(() => {
                const now = holdCard()?.id ?? null;
                if (now !== seenHold) {
                  seenHold = now;
                  listener();
                }
              }),
            ];
            return () => offs.forEach((off) => off?.());
          },
        }),
  };
}

/**
 * A 1:1 with one persona (req-168, ADR-0093): the conversation in the
 * persona's chat session file. A line is written and answered in the
 * background by the persona's held session (or the chat bridge); the
 * answer arrives through `onThreadChange` — a board change (the file was
 * written) or, while a session starts or a turn runs, a fleet change.
 */
export function createPersonaTarget(deps: ConversationDeps, persona: PersonaView): ConversationTarget {
  const words = deps.words ?? KEY_WORDS;
  let last: unknown = null;
  const call = async (method: string, payload: unknown): Promise<ConversationThread> => {
    try {
      last = await deps.invoke(method, payload);
    } catch (error) {
      last = { ok: false, error: messageOf(error) };
    }
    return threadOfPersona(persona.id, persona.title, last, words);
  };
  const read = (): Promise<ConversationThread> => call('personaThread', { persona: persona.id });
  const subscribe = deps.subscribeChanges;
  return {
    id: personaTargetId(persona.id),
    label: persona.title,
    group: PERSONA_GROUP,
    icon: 'users',
    description: words.t('one_on_one.talk_to', { name: persona.title }),
    thread: read,
    send: (text) => call('personaThreadAppend', { persona: persona.id, text }),
    act: (cardId, actionId) =>
      actionId === ACCEPT || actionId === DISMISS
        ? call('personaProposalDecide', { persona: persona.id, id: cardId, decision: actionId === ACCEPT ? 'confirm' : 'dismiss' })
        : read(),
    newThread: read,
    ...(subscribe === undefined
      ? {}
      : {
          onThreadChange: (listener: () => void) =>
            subscribe((what) => {
              if (what === 'board' || followsFleet(last)) {
                listener();
              }
            }),
        }),
  };
}

/** The provider the plugin registers: Mission Control first, then one 1:1 per agent persona. */
export function createConversationProvider(deps: ConversationDeps): ConversationTargetProvider {
  const mission = createMissionControlTarget(deps);
  const personaTargets = new Map<string, ConversationTarget>();
  return {
    targets: () => {
      const targets: ConversationTarget[] = [mission];
      const live = new Set<string>();
      for (const persona of deps.personas()) {
        // The owner as a team member has no thread worth opening; Mission Control's persona is the Mission Control target (req-269).
        if (persona.kind === 'human' || persona.kind === 'mission') {
          continue;
        }
        live.add(persona.id);
        const known = personaTargets.get(persona.id);
        const target = known !== undefined && known.label === persona.title ? known : createPersonaTarget(deps, persona);
        personaTargets.set(persona.id, target);
        targets.push(target);
      }
      for (const id of [...personaTargets.keys()]) {
        if (!live.has(id)) {
          personaTargets.delete(id);
        }
      }
      return targets;
    },
    onChange: (listener) => deps.subscribePersonas(listener),
  };
}
