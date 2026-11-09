import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import { NOTES_VAULT_KEY } from '../contracts/notes';
import { NotesService } from '../services/notes-service';
import type { BoardParts } from './compose-board-parts';
import type { SessionParts } from './compose-session-parts';
import type { VerifyParts } from './compose-verify-parts';
import { DreyTicketsPort } from './drey-port';
import type { EngineOptions } from './engine-types';
import type { FileConfigStore } from './file-config';
import { RemoteService } from './service';

type Log = NonNullable<EngineOptions['log']>;

/** What the phones and Drey's team views stand on: the remote port, the notes API, the gateway's service. */
export interface RemoteParts {
  readonly remotePort: DreyTicketsPort;
  readonly remoteService: RemoteService;
}

/**
 * The remote port over the board, the fleet and the conversational parts,
 * the notes of the active vault for paired devices (req-100) and the
 * gateway's service. A phone's note save tells Drey's vault round through
 * the hub's paths channel (D-3).
 */
export async function composeRemoteParts(opts: EngineOptions, config: FileConfigStore, parts: { board: BoardParts; verify: VerifyParts; sessions: SessionParts }, log: Log): Promise<RemoteParts> {
  const { board, verify, sessions } = parts;
  // Resolved lazily: the port asks the service about bypass runs, the service takes the port.
  let remoteService: RemoteService | null = null;
  const remotePort = new DreyTicketsPort(
    board.board,
    board.fleet,
    board.hub,
    { allowBypass: () => remoteService?.allowBypass() ?? false },
    sessions.chat,
    sessions.personaSessions,
    sessions.personaRecords,
    sessions.skills,
  );
  // req-100: the active vault's notes for paired devices. Drey keeps the key on
  // its active vault; without Drey it is the last one it named, or the hosted vault.
  const notes = new NotesService({
    root: async () => {
      const named = await config.get<unknown>(NOTES_VAULT_KEY);
      return typeof named === 'string' && path.isAbsolute(named) ? named : opts.vaultPath;
    },
    log,
  });
  notes.onChanged(({ vaultPath, changed }) => board.hub.emitPaths({ vaultPath, changed, deleted: [] }));
  remoteService = new RemoteService({
    config,
    port: remotePort,
    clientDir: opts.clientDir,
    notes,
    // E5c: the proof card's gallery — attachment bytes straight from the
    // vault, authorized per device token (the gateway stays vault-agnostic).
    attachments: async (name) => {
      const vault = await board.board.detect();
      if (vault === null) {
        return null;
      }
      try {
        return await fsp.readFile(path.join(vault.path, 'tickets', 'attachments', name));
      } catch {
        return null;
      }
    },
    // E12-3: the settings screen's "Include the n existing videos" count.
    countVideos: async () => (await verify.videos.status()).count,
    videos: (name) => verify.videos.stat(name),
    videosChanged: async (includeExisting) => {
      await verify.videos.applyInGit(includeExisting);
    },
    log,
    onChanged: () => board.hub.emit('remote'),
  });
  await remoteService.init();
  return { remotePort, remoteService };
}
