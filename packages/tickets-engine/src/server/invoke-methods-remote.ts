import { parseFlowDraft, parseFlowEdit, parseFlowSave, parsePlanPartsEdit, parseStandardFlow, type Parsed } from '../core/commands';
import { remoteActorOf } from '../contracts/remote-protocol';
import type { EngineParts } from './engine-parts';
import type { InvokeTable } from './invoke-table';
import { parseSettingsPatch } from './settings';

const objectOf = (payload: unknown): Record<string, unknown> => (payload ?? {}) as Record<string, unknown>;

/**
 * The remote half of the invoke table: pairing and the phone's own editors
 * and settings, behind the same parsers and guards the router uses (one
 * grammar). pair/revoke take primitive args; the invoke channel carries one
 * object payload, so both get explicit adapters.
 */
export function addRemoteMethods(table: InvokeTable, parts: EngineParts): void {
  const { remoteService, remotePort } = parts.remote;
  table.set('pair', (payload) => {
    // Tolerant on the wire: `{ deviceName, readOnly }` from a proper caller,
    // or a bare string when a proxy passes the first positional argument.
    const message = typeof payload === 'string' ? { deviceName: payload } : (objectOf(payload) as { deviceName?: unknown; readOnly?: unknown });
    return Promise.resolve(remoteService.pair(typeof message.deviceName === 'string' ? message.deviceName : '', message.readOnly === true));
  });
  table.set('revoke', (payload) => {
    const message = objectOf(payload);
    return remoteService.revoke(typeof message['id'] === 'string' ? message['id'] : '');
  });
  // The Flow tab (E13-11): the same flow calls the phone's editor makes over HTTP.
  table.set('flow', (payload) => {
    const message = objectOf(payload);
    const part = typeof message['part'] === 'number' ? message['part'] : null;
    return typeof message['id'] === 'string' ? remotePort.flow({ id: message['id'], part }) : Promise.resolve({ ok: false, error: 'bad flow payload' });
  });
  const flowWrite =
    <T extends object>(parse: (p: unknown) => Parsed<T>, run: (cmd: T) => Promise<unknown>) =>
    (payload: unknown): Promise<unknown> => {
      const cmd = parse(payload);
      return cmd.ok ? run(cmd.value) : Promise.resolve(cmd);
    };
  // The Parts block in the ticket (E13-10): the list edit the phone makes, same parser.
  table.set('planPartsEdit', flowWrite(parsePlanPartsEdit, (cmd) => remotePort.planPartsEdit(cmd, remoteActorOf('Drey'))));
  table.set('flowEdit', flowWrite(parseFlowEdit, (cmd) => remotePort.flowEdit(cmd)));
  table.set('flowDraft', flowWrite(parseFlowDraft, (cmd) => remotePort.flowDraft(cmd)));
  table.set('flowSave', flowWrite(parseFlowSave, (cmd) => remotePort.flowSave(cmd, remoteActorOf('Drey'))));
  // E10-5b: the settings page's default flow and the proposal switch (pipeline.md's `flow:` / `propose-flow:`).
  table.set('setStandardFlow', flowWrite(parseStandardFlow, (cmd) => parts.board.board.setStandardFlow(cmd)));
  // The settings page's engine half (E13-12): what the phone's Settings reads
  // and writes (`videos.*`, E12-3), behind the same guard (turning videos in
  // git on needs the confirmation).
  table.set('settingsRead', () => remoteService.settings().read('drey'));
  table.set('settingsPatch', (payload) => {
    const patch = parseSettingsPatch(payload);
    return patch.ok ? remoteService.settings().patch(patch.value, 'drey') : Promise.resolve(patch);
  });
}
