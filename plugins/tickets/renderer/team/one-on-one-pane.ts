/**
 * The Crew tab's 1:1 pane (req-168, ADR-0093): the persona's conversation
 * from its chat session file, read and drawn over the same mapping as the
 * Assistant's 1:1 target (`conversation/persona-map.ts`) — the owner's
 * lines, the persona's answers, the proposal cards with Accept / Dismiss,
 * the session's state as one quiet line and a failed turn as an error.
 * A sent line returns at once; the answer arrives with the desk's next
 * change push (its file write is a board change). Plain DOM; every word
 * through the catalog.
 */
import type { ConversationMessage, ConversationThread } from '../../../../shared/plugin-api/renderer';
import type { PersonaView } from '../../shared/remote-protocol';
import { ACCEPT, DISMISS, threadOfPersona, type PersonaWords } from '../conversation/persona-map';
import { h, textButton, type DeskDeps } from '../desk-deps';

function wordsOf(deps: DeskDeps): PersonaWords {
  return { t: (key, params) => deps.api.i18n.t(key as never, params as never), formatTime: (date) => deps.api.i18n.formatTime(date) };
}

function note(text: string, kind: 'empty' | 'error' = 'empty'): HTMLElement {
  return h('div', kind === 'error' ? 'desk-note desk-note-error' : 'desk-note', text);
}

/** One message: the bubble, its cards; an error message as the error note. */
function messageNode(message: ConversationMessage, decide: (cardId: string, actionId: string) => void): HTMLElement {
  if (message.error !== undefined) {
    return note([message.error.title, ...message.error.lines].join(' — '), 'error');
  }
  const bubble = h('div', message.role === 'user' ? 'desk-msg desk-msg-me' : 'desk-msg');
  if (message.author !== undefined) {
    bubble.append(h('div', 'desk-msg-at', message.author));
  }
  bubble.append(h('div', 'desk-msg-text', message.text));
  for (const card of message.cards ?? []) {
    const node = h('div', 'desk-card');
    node.append(h('div', 'desk-card-title', card.title ?? ''), h('div', 'desk-card-text', card.text));
    if (card.note !== undefined) {
      node.append(h('div', 'desk-msg-at', card.note));
    }
    const actions = card.actions ?? [];
    if (actions.length > 0) {
      const row = h('div', 'desk-card-actions');
      for (const action of actions) {
        row.append(textButton(action.label, action.tone === 'primary' ? 'desk-btn desk-btn-primary' : 'desk-btn', action.label, () => decide(card.id, action.id)));
      }
      node.append(row);
    }
    bubble.append(node);
  }
  return bubble;
}

/** Mounts the pane into `body`; it follows the 1:1 until `body` leaves the document. */
export function mountOneOnOnePane(deps: DeskDeps, persona: PersonaView, body: HTMLElement): void {
  const words = wordsOf(deps);
  const list = h('div', 'desk-thread');
  const state = h('div', 'desk-note');
  const input = h('textarea', 'desk-input');
  input.rows = 3;
  input.setAttribute('aria-label', words.t('one_on_one.message_to', { name: persona.title }));
  const paint = (reply: unknown): void => {
    const thread: ConversationThread = threadOfPersona(persona.id, persona.title, reply, words);
    list.replaceChildren(...(thread.messages.length === 0 ? [note(words.t('one_on_one.empty'))] : thread.messages.map((m) => messageNode(m, (id, action) => void decide(id, action)))));
    state.textContent = thread.notice ?? '';
    list.scrollTop = list.scrollHeight;
  };
  const call = async (method: string, payload: unknown): Promise<void> => {
    try {
      paint(await deps.invoke(method, payload));
    } catch (error) {
      paint({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  };
  const read = (): Promise<void> => call('personaThread', { persona: persona.id });
  const decide = (id: string, action: string): Promise<void> =>
    action === ACCEPT || action === DISMISS ? call('personaProposalDecide', { persona: persona.id, id, decision: action === ACCEPT ? 'confirm' : 'dismiss' }) : read();
  const send = textButton(words.t('one_on_one.send'), 'desk-btn desk-btn-primary', words.t('one_on_one.send'), () => void submit());
  const submit = async (): Promise<void> => {
    const text = input.value.trim();
    if (text === '') {
      return;
    }
    send.disabled = true;
    await call('personaThreadAppend', { persona: persona.id, text });
    input.value = '';
    send.disabled = false;
  };
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void submit();
    }
  });
  const composer = h('div', 'desk-composer');
  composer.append(input, send);
  body.append(list, state, composer);
  // The desk's change push carries board and fleet changes alike: the answer's file write is a board change.
  const off = deps.subscribe(() => (body.isConnected ? void read() : off()));
  void read();
}
