import { promises as fsp } from 'node:fs';
import type { TicketsGit } from '../core/tickets-git';
import { CrewConfigFiles } from './crew-config-files';
import { CrewConfigMigrator } from './crew-config-migrator';
import { CrewConfigService } from './crew-config-service';
import { CrewLegacyFiles, type FlatConfigStore } from './crew-legacy-files';
import { FreeSessionService, type FreeSessionBoard, type FreeSessionFleet } from './free-session-service';
import type { EngineHost } from './host';

type Log = (message: string, level?: 'info' | 'warn' | 'error') => void;

/** A folder, something else, or nothing there. */
async function isDirectory(path: string): Promise<boolean | null> {
  try {
    return (await fsp.stat(path)).isDirectory();
  } catch {
    return null;
  }
}

/**
 * req-173's vault layer, wired once in the engine's composition (before the
 * board, which reads it): `_meta/crew.md` and its one-time migration from
 * the engine's `config.json` and the fleet root's old `chain.json`.
 */
export function composeCrewConfig(wiring: { readonly host: EngineHost; readonly git: TicketsGit; readonly config: FlatConfigStore; readonly fleetRoot: string; readonly log: Log }): CrewConfigService {
  const files = new CrewConfigFiles(wiring.host, wiring.git);
  const migrator = new CrewConfigMigrator(files, new CrewLegacyFiles(wiring.config, wiring.fleetRoot), wiring.log);
  return new CrewConfigService(files, migrator, wiring.log);
}

/** req-173's free sessions, wired after the board they read personas and repos from. */
export function composeFreeSessions(wiring: { readonly board: FreeSessionBoard; readonly fleet: FreeSessionFleet; readonly crew: CrewConfigService; readonly host: EngineHost; readonly log: Log }): FreeSessionService {
  return new FreeSessionService({ board: wiring.board, fleet: wiring.fleet, crew: wiring.crew, host: wiring.host, isDirectory, log: wiring.log });
}
