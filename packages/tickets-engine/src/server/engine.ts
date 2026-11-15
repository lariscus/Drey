import { randomBytes } from 'node:crypto';
import * as path from 'node:path';
import { composeBoardParts } from './compose-board-parts';
import { composeLearningParts } from './compose-learning-parts';
import { composeRemoteParts } from './compose-remote-parts';
import { composeSessionParts } from './compose-session-parts';
import { buildInvokeTable } from './build-invoke-table';
import type { Engine, EngineOptions } from './engine-types';
import { FileConfigStore } from './file-config';
import { InvokeServer } from './invoke-server';
import { RunningEngine } from './running-engine';

export type { Engine, EngineOptions } from './engine-types';

/**
 * The tickets engine (ADR-0088, E2b), composed: the board service, the fleet
 * client and the remote gateway over one tickets vault on disk — no Drey.
 * This is the composition root; each group of parts is built in its own
 * `compose-*-parts.ts`, the invoke table in `build-invoke-table.ts`, the
 * listener is `InvokeServer`, the running engine `RunningEngine`. Since
 * req-164 it is the always-on component of Drey Service (ADR-0092); req-213
 * added `Engine.emitPaths`, the service's way to tell Drey of a worker's
 * vault write.
 */
export async function createEngine(opts: EngineOptions): Promise<Engine> {
  const log = opts.log ?? (() => undefined);
  const config = new FileConfigStore(path.join(opts.home, 'config.json'));
  const token = await tokenOf(config);
  const board = composeBoardParts(opts, config, log);
  const sessions = await composeSessionParts(opts, config, board, log);
  const remote = await composeRemoteParts(opts, config, { board, sessions }, log);
  const learning = await composeLearningParts(config, board, log);
  const parts = { config, board, sessions, remote, learning };

  const table = buildInvokeTable(parts);
  const server = new InvokeServer({ token, vaultPath: opts.vaultPath, table, hub: board.hub, presence: board.presence, log });
  const invokeUrl = await server.listen(opts.invokePort ?? 0);
  return new RunningEngine({ invokeUrl, token, config, parts, table, server });
}

/** The local bearer token: the stored one, or a fresh one stored now. */
async function tokenOf(config: FileConfigStore): Promise<string> {
  const stored = await config.get<string>('engine.token');
  if (stored !== undefined) {
    return stored;
  }
  const fresh = randomBytes(24).toString('hex');
  await config.set('engine.token', fresh);
  return fresh;
}
