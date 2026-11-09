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
import { trancheCardOf, type TrancheCard, type TrancheFormat, type TrancheView } from '../../../../shared/tranche';
import type { ShapeTarget } from '../ticket-document/shape';
import {
  EMPTY_THREAD,
  PLANNER_NAME,
  errorMessageOf,
  trancheMessageOf,
  withTrancheMessage,
  historyOfSessions,
  threadOfPersona,
  threadOfSession,
} from './map';

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

  const trancheCard = (): TrancheCard | null => {
    const binding = deps.tranche;
    const view = binding?.view() ?? null;
    if (binding === undefined || view === null) {
      return null;
    }
    const first = trancheCardOf(view, binding.format());
    return first !== null && reportOpenFor === first.id ? trancheCardOf(view, binding.format(), true) : first;
  };
  const decorated = (thread: ConversationThread): ConversationThread => {
    const binding = deps.tranche;
    const card = trancheCard();
    if (binding === undefined || card === null) {
      return thread;
    }
    const time = binding.formatTime(new Date(card.at));
    return withTrancheMessage(thread, trancheMessageOf(card, binding.format().t('checkpoint.meta', { time })));
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
    ...(deps.shape === undefined && deps.tranche === undefined
      ? {}
      : {
          // The thread changes with the ticket in focus and with the checkpoint that waits.
          onThreadChange: (listener: () => void) => {
            const { shape, tranche } = deps;
            let seenShape = shape?.current()?.id ?? null;
            let seenCard = trancheCard()?.id ?? null;
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
            ];
            return () => offs.forEach((off) => off?.());
          },
        }),
  };
}

/** A 1:1 with one persona: the owner's messages in that persona's thread. */
export function createPersonaTarget(deps: ConversationDeps, persona: PersonaView): ConversationTarget {
  const read = async (): Promise<ConversationThread> => {
    try {
      return threadOfPersona(persona.id, persona.title, await deps.invoke('personaThread', { persona: persona.id }));
    } catch (error) {
      return threadOfPersona(persona.id, persona.title, { ok: false, error: messageOf(error) });
    }
  };
  return {
    id: personaTargetId(persona.id),
    label: persona.title,
    group: PERSONA_GROUP,
    icon: 'users',
    description: `Talk to ${persona.title} 1:1`,
    thread: read,
    send: async (text) => {
      try {
        return threadOfPersona(
          persona.id,
          persona.title,
          await deps.invoke('personaThreadAppend', { persona: persona.id, text }),
        );
      } catch (error) {
        return threadOfPersona(persona.id, persona.title, { ok: false, error: messageOf(error) });
      }
    },
    act: read,
    newThread: read,
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
        // The owner as a team member has no thread worth opening.
        if (persona.kind === 'human') {
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
