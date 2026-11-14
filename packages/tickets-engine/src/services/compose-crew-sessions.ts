import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import type { TicketsGit } from '../core/tickets-git';
import { NodeFileSystem } from '../fleet/node-file-system';
import { CrewConfigFiles } from './crew-config-files';
import { CrewConfigMigrator } from './crew-config-migrator';
import { CrewConfigService } from './crew-config-service';
import { CrewPictures } from './crew-pictures';
import { CrewSeeder } from './crew-seeder';
import { CrewLegacyFiles, type FlatConfigStore } from './crew-legacy-files';
import { FreeSessionService, type FreeSessionBoard, type FreeSessionFleet } from './free-session-service';
import type { EngineHost, EngineVault } from './host';
import { PersonaAvatars } from './persona-avatars';
import { PersonaFolders } from './persona-folders';
import { PersonaPictureService } from './persona-picture-service';
import { ServiceModelTable } from './service-model-table';
import { ShippedCrewFiles } from './shipped-crew-files';

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
export function composeFreeSessions(wiring: { readonly board: FreeSessionBoard; readonly fleet: FreeSessionFleet; readonly crew: CrewConfigService; readonly host: EngineHost; readonly home: string; readonly log: Log }): FreeSessionService {
  return new FreeSessionService({ board: wiring.board, fleet: wiring.fleet, crew: wiring.crew, host: wiring.host, isDirectory, log: wiring.log, table: serviceModelTable(wiring.home) });
}

/** req-288: the machine's model table as the engine reads it — `<service home>/service.json`, no runner needed. */
export function serviceModelTable(home: string): ServiceModelTable {
  return new ServiceModelTable(new NodeFileSystem(), path.join(home, 'service.json'));
}

/** req-256's default crew seeder, wired after the crew configuration whose file holds its marker. */
export function composeCrewSeeder(wiring: { readonly host: EngineHost; readonly git: TicketsGit; readonly crew: CrewConfigService; readonly log: Log }): CrewSeeder {
  return new CrewSeeder({
    source: new ShippedCrewFiles(),
    host: wiring.host,
    git: wiring.git,
    folders: new PersonaFolders(wiring.host),
    avatars: new PersonaAvatars(wiring.host),
    crew: wiring.crew,
    log: wiring.log,
  });
}

/** req-288: the owner's picture upload and removal over the board's vault, its git and crew.md. */
export function composePersonaPictures(
  parts: { readonly board: { detect(): Promise<EngineVault | null>; announceChanged(): void }; readonly host: EngineHost; readonly git: TicketsGit; readonly crew: CrewConfigService; readonly avatars: PersonaAvatars },
  log: Log,
): PersonaPictureService {
  return new PersonaPictureService({
    board: parts.board,
    host: parts.host,
    git: parts.git,
    folders: new PersonaFolders(parts.host),
    files: parts.avatars,
    crewFiles: parts.crew.crewFiles,
    changed: () => parts.board.announceChanged(),
    log,
  });
}

/** req-292's backfill of the shipped pictures, run at the engine's start after the crew seeding. */
export function composeCrewPictures(wiring: { readonly host: EngineHost; readonly git: TicketsGit; readonly crew: CrewConfigService; readonly avatars: PersonaAvatars; readonly log: Log }): CrewPictures {
  return new CrewPictures({
    host: wiring.host,
    git: wiring.git,
    folders: new PersonaFolders(wiring.host),
    avatars: wiring.avatars,
    crewFiles: wiring.crew.crewFiles,
    log: wiring.log,
  });
}
