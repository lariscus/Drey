import type { EngineParts } from './engine-parts';
import type { InvokeTable } from './invoke-table';
import { parseCrewOverrides, parseCrewPatches, parseFreeSessionAsk } from './session-payloads';

type ChatService = EngineParts['sessions']['chat'];
type FileOf = { readonly file: string };

/**
 * The chat half of the invoke table: the Mission Control chat's calls (the
 * service speaks the ChatServicePort names, the channel exposes them under
 * the chat* names), the crew configuration and the free sessions (req-173).
 */
export function addChatMethods(table: InvokeTable, parts: EngineParts): void {
  const { chat } = parts.sessions;
  const { board, freeSessions, crew } = parts.board;
  // req-173: the vault layer (Settings -> Tickets) and the free sessions.
  table.set('crewConfig', async () => crew.reply(await board.detect()));
  table.set('crewConfigSet', async (payload) => crew.set(await board.detect(), parseCrewPatches(payload), parseCrewOverrides(payload)));
  table.set('sessionOptions', () => freeSessions.options());
  table.set('sessionStart', (payload) => {
    const ask = parseFreeSessionAsk(payload);
    return ask.ok ? freeSessions.start(ask.value, ask.origin) : Promise.resolve({ ok: false, error: ask.error });
  });
  addChatCalls(table, chat);
}

function addChatCalls(table: InvokeTable, chat: ChatService): void {
  table.set('chatSessions', () => chat.sessions());
  table.set('chatOpen', (payload) => {
    if (typeof payload !== 'string') {
      throw new Error('chatOpen expects a session file path');
    }
    return chat.open(payload);
  });
  table.set('chatSend', (payload) => chat.send(payload as { readonly file: string; readonly text: string; readonly context?: string }));
  table.set('chatStart', (payload) => chat.start(payload as { readonly title?: string; readonly text: string; readonly ticket?: string; readonly context?: string }));
  table.set('chatPlanStatus', (payload) => {
    // A ticket id, or { ticket, text } to mark the open buffer instead of the file (E13-9).
    if (typeof payload === 'string') {
      return chat.planStatus(payload);
    }
    const message = (payload ?? {}) as { ticket?: unknown; text?: unknown };
    if (typeof message.ticket !== 'string') {
      throw new Error('chatPlanStatus expects a ticket id');
    }
    return chat.planStatus(message.ticket, typeof message.text === 'string' ? message.text : undefined);
  });
  table.set('chatConfirm', (payload) => chat.confirm(payload as FileOf & { readonly id: string }));
  table.set('chatDismiss', (payload) => chat.dismiss(payload as FileOf & { readonly id: string }));
  table.set('chatShapeDecide', (payload) => chat.shapeDecide(payload as FileOf & { readonly choice: 'keep' | 'split' }));
}
