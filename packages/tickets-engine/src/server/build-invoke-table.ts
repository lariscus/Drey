import type { EngineParts } from './engine-parts';
import { FLEET_METHODS } from './fleet-methods';
import { BOARD_METHODS, PROJECT_METHODS, REMOTE_METHODS, TEAM_METHODS } from './invoke-methods';
import { addChatMethods } from './invoke-methods-chat';
import { addRemoteMethods } from './invoke-methods-remote';
import { InvokeTable } from './invoke-table';

/**
 * The invoke table: the service instances behind an explicit allowlist, in
 * the order that lets a later registration win — the board and verify
 * (which answers the two verify methods; register() picks exactly the names
 * an object carries), the fleet client, the remote service and port, then
 * the adapters of the remote and chat halves and the plugin's own calls.
 */
export function buildInvokeTable(parts: EngineParts): InvokeTable {
  const table = new InvokeTable();
  const { board, fleet, host } = parts.board;
  table.register(board, BOARD_METHODS);
  table.register(parts.verify.verify, BOARD_METHODS);
  table.register(fleet, FLEET_METHODS);
  table.register(parts.remote.remoteService, REMOTE_METHODS);
  table.register(parts.remote.remotePort, TEAM_METHODS);
  // req-284: Settings → Projects.
  table.register(parts.sessions.projects, PROJECT_METHODS);
  addRemoteMethods(table, parts);
  addChatMethods(table, parts);
  // The Review tab's reads (E13-7): the branch's diff and one file of it --
  // the same board-service calls the phone's proof card reaches over HTTP.
  // The service takes positional arguments, the invoke channel one object.
  table.set('ticketDiff', (payload) => {
    const message = (payload ?? {}) as { id?: unknown };
    return board.ticketDiff(typeof message.id === 'string' ? message.id : '');
  });
  table.set('ticketFile', (payload) => {
    const message = (payload ?? {}) as { id?: unknown; path?: unknown };
    return board.ticketFile(typeof message.id === 'string' ? message.id : '', typeof message.path === 'string' ? message.path : '');
  });
  // The plugin's config sync: Drey's settings keys the engine reads.
  table.set('configSet', (payload) => {
    const message = payload as { key?: unknown; value?: unknown };
    if (typeof message?.key !== 'string') {
      throw new Error('configSet expects { key, value }');
    }
    return host.configSet(message.key, message.value);
  });
  table.set('configGet', (payload) => {
    const message = payload as { key?: unknown };
    if (typeof message?.key !== 'string') {
      throw new Error('configGet expects { key }');
    }
    return host.configGet(message.key);
  });
  return table;
}
