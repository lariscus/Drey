import { hostname } from 'node:os';
import * as path from 'node:path';
import { TicketsGit } from '../core/tickets-git';
import { FleetEventWriter } from '../fleet/event-writer';
import { normalizeFleetCaps, normalizeFleetHandover, normalizeFleetPools } from '../fleet/protocol';
import { RunnerComponent } from '../service/runner-component';
import { EngineBoardService } from '../services/board-service';
import { composeCrewConfig, composeCrewPictures, composeCrewSeeder, composeFreeSessions } from '../services/compose-crew-sessions';
import type { CrewPictures } from '../services/crew-pictures';
import type { CrewSeeder } from '../services/crew-seeder';
import { FleetClient } from '../services/fleet-client';
import type { FreeSessionService } from '../services/free-session-service';
import { PersonaAvatars } from '../services/persona-avatars';
import { DkHealthProbe } from '../store/dk-health';
import { execProbe } from '../store/dk-health-exec';
import { ChangeHub } from './drey-port';
import { DreyPresence } from './drey-presence';
import type { EngineOptions } from './engine-types';
import type { FileConfigStore } from './file-config';
import { FsEngineHost } from './standalone-host';

type Log = NonNullable<EngineOptions['log']>;

/** The parts the rest of the engine is composed over: the vault, the board, the fleet client, the change hub. */
export interface BoardParts {
  readonly hub: ChangeHub;
  readonly host: FsEngineHost;
  readonly git: TicketsGit;
  readonly fleet: FleetClient;
  readonly presence: DreyPresence;
  readonly events: FleetEventWriter;
  readonly crew: ReturnType<typeof composeCrewConfig>;
  /** req-256: seeds the default crew — "Initialize board" through the board, the engine's start through the session parts; null = `seedDefaultCrew: false`. */
  readonly crewSeeder: CrewSeeder | null;
  /** req-292: the shipped pictures for a board seeded before them, at the engine's start; null with `seedDefaultCrew: false`. */
  readonly crewPictures: CrewPictures | null;
  /** req-292: the persona pictures in the vault — the Crew's circles read them, the human persona's creation copies one. */
  readonly avatars: PersonaAvatars;
  readonly board: EngineBoardService;
  readonly freeSessions: FreeSessionService;
}

/**
 * The board and what it stands on (req-164, req-173): the hub every change
 * fans out over, the host over the vault on disk, the fleet client over the
 * runner the service hands in, the presence of Drey (req-110), the one event
 * writer (E7), the crew configuration (R13), the board and the free sessions.
 */
export function composeBoardParts(opts: EngineOptions, config: FileConfigStore, log: Log): BoardParts {
  const hub = new ChangeHub();
  const host = new FsEngineHost(opts.vaultPath, config, hub, log, opts.home);
  const git = new TicketsGit(() => 'git');
  const fleetRoot = path.join(opts.home, 'fleet');
  const fleet = new FleetClient({ root: fleetRoot, runner: opts.runner ?? ownRunner(fleetRoot, config, log), log, onFleetChanged: () => hub.emit('fleet') });
  const presence = new DreyPresence(() => retireWhenIdle(fleet, log), opts.dreyGoneGraceMs ?? 5_000);
  // E7: one shared event writer for the engine process — the board stamps
  // ledger phase/merged/archived lines, the verify service proof_ready
  // lines; the append-only files ride the next regular commit.
  const events = new FleetEventWriter({ vaultPath: opts.vaultPath, log });
  // req-173 (R13): the vault layer of the configuration, `_meta/crew.md` — the board resolves its crew
  // keys from it; the first read of a vault moves the old keys of config.json and chain.json in once.
  const crew = composeCrewConfig({ host, git, config, fleetRoot, log });
  const crewSeeder = opts.seedDefaultCrew === false ? null : composeCrewSeeder({ host, git, crew, log });
  const avatars = new PersonaAvatars(host);
  const crewPictures = opts.seedDefaultCrew === false ? null : composeCrewPictures({ host, git, crew, avatars, log });
  const board = new EngineBoardService(
    host,
    git,
    'opencode',
    'accept-edits',
    '',
    fleet,
    fleetRoot,
    normalizeFleetCaps({}),
    normalizeFleetPools({}),
    normalizeFleetHandover({}),
    `engine@${hostname().toLowerCase()}`,
    { events, crew, dkHealth: new DkHealthProbe(execProbe), avatars, ...(crewSeeder === null ? {} : { crewSeeder }) },
  );
  // req-173 (R12): the free sessions the owner opens (service window, Crew tab) or accepts from Pia's card.
  const freeSessions = composeFreeSessions({ board, fleet, crew, host, home: opts.home, log });
  board.onChanged(() => hub.emit('board'));
  return { hub, host, git, fleet, presence, events, crew, crewSeeder, crewPictures, avatars, board, freeSessions };
}

/** No runner was handed in: the engine's own, in-process, over `<home>/fleet`. */
function ownRunner(root: string, config: FileConfigStore, log: Log): RunnerComponent {
  return new RunnerComponent({
    root,
    storeBacked: async () => ((await config.get<string>('dk.store')) ?? '').trim() !== '',
    log: (line) => log(line),
    onChange: () => undefined,
  });
}

/**
 * req-110: when the last Drey instance's event stream has been closed for
 * the grace span, the runner is asked to retire if idle — the runner keeps
 * itself for a live run or an On/Paused Autopilot.
 */
function retireWhenIdle(fleet: FleetClient, log: Log): void {
  void fleet.retireIfIdle().then(
    (reply) => {
      if (!reply.ok) {
        log(`the fleet runner could not be asked to retire: ${reply.error}`, 'warn');
      }
    },
    (error: unknown) => log(`the fleet runner could not be asked to retire: ${String(error)}`, 'warn'),
  );
}
