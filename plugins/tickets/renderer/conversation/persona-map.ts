/**
 * The persona 1:1 mapped to the Assistant's `ConversationThread` (req-168,
 * ADR-0093): the owner's lines and the persona's answers from its chat
 * session file, the proposal cards on the answer they followed, the
 * session's state as the thread's one quiet line, a failed turn as the
 * error card. Pure — no DOM, no IPC; every word through the catalog.
 */
import type { ConversationCard, ConversationMessage, ConversationThread } from '../../../../shared/plugin-api/renderer';
import type { PersonaProposal, PersonaThreadReply } from '../../shared/remote-protocol';

/** The catalog and the clock's words, as the plugin's `api.i18n` gives them. */
export interface PersonaWords {
  t(key: string, params?: Record<string, string | number>): string;
  formatTime(date: Date): string;
}

/** A card's buttons speak these ids back through `act`. */
export const ACCEPT = 'accept';
export const DISMISS = 'dismiss';

function cardOf(proposal: PersonaProposal, words: PersonaWords): ConversationCard {
  const title = proposal.command.kind === 'prompt' ? words.t('one_on_one.proposal.prompt') : words.t('one_on_one.proposal.skill', { skill: proposal.command.skill });
  if (proposal.state === 'pending') {
    return {
      id: proposal.id,
      kind: 'card',
      title,
      text: proposal.summary,
      actions: [
        { id: ACCEPT, label: words.t('one_on_one.accept'), tone: 'primary' },
        { id: DISMISS, label: words.t('one_on_one.dismiss'), tone: 'quiet' },
      ],
    };
  }
  const note =
    proposal.state === 'dismissed'
      ? words.t('one_on_one.dismissed')
      : proposal.outcome === null
        ? words.t('one_on_one.accepted')
        : words.t('one_on_one.accepted_with', { outcome: proposal.outcome });
  return { id: proposal.id, kind: 'card', title, text: proposal.summary, note, actions: [] };
}

/** The session's state as one quiet line; none while nothing runs or waits. */
function noticeOf(reply: Extract<PersonaThreadReply, { ok: true }>, title: string, words: PersonaWords): string | undefined {
  switch (reply.session) {
    case 'starting':
      return words.t('one_on_one.state.starting', { name: title });
    case 'answering':
      return words.t('one_on_one.state.answering', { name: title });
    case 'held':
      return reply.releaseAt === undefined ? undefined : words.t('one_on_one.state.held', { time: words.formatTime(new Date(reply.releaseAt)) });
    default:
      return undefined;
  }
}

function messagesOf(reply: Extract<PersonaThreadReply, { ok: true }>, title: string, words: PersonaWords): ConversationMessage[] {
  const proposals = reply.proposals ?? [];
  const messages: ConversationMessage[] = reply.messages.map((message, index) => {
    if (message.role === 'owner') {
      return { id: `t-${index}`, role: 'user', text: message.text };
    }
    // A card belongs to the answer it followed: the last persona message before the next one.
    const next = reply.messages.slice(index + 1).find((m) => m.role === 'persona');
    const cards = proposals.filter((p) => p.at >= message.at && (next === undefined || p.at < next.at)).map((p) => cardOf(p, words));
    return { id: `t-${index}`, role: 'agent', text: message.text, author: title, ...(cards.length > 0 ? { cards } : {}) };
  });
  if (reply.failure !== undefined) {
    messages.push({ id: 'error', role: 'agent', text: '', error: { title: words.t('one_on_one.could_not_answer', { name: title }), lines: [reply.failure] } });
  }
  return messages;
}

/** One `personaThread` reply as the 1:1 thread. */
export function threadOfPersona(personaId: string, title: string, reply: unknown, words: PersonaWords): ConversationThread {
  const r = reply as PersonaThreadReply | null;
  if (r === null || typeof r !== 'object' || r.ok !== true || !Array.isArray(r.messages)) {
    const error = r !== null && typeof r === 'object' && r.ok === false && typeof r.error === 'string' ? r.error : '';
    return {
      id: personaId,
      title,
      messages: [{ id: 'error', role: 'agent', text: '', error: { title: words.t('one_on_one.could_not_read', { name: title }), lines: error === '' ? [] : [error] } }],
    };
  }
  const notice = noticeOf(r, title, words);
  return { id: r.file ?? personaId, title, messages: messagesOf(r, title, words), ...(notice !== undefined ? { notice } : {}) };
}

/** Whether a fleet change may move this thread (a session starts, a turn runs): only then is it worth reading again. */
export function followsFleet(reply: unknown): boolean {
  const session = (reply as { session?: unknown } | null)?.session;
  return session === 'starting' || session === 'answering';
}
