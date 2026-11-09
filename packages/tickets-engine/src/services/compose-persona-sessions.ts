import type { ChatBridge } from '../contracts/chat';
import type { TicketsGit } from '../core/tickets-git';
import { NO_TOOLS, type OneOnOneToolSeam } from '../fleet/one-on-one-toolset';
import { bridgeTurnRunner } from './api-persona-turn';
import type { EngineHost } from './host';
import { PersonaSessionContext } from './persona-session-context';
import { PersonaSessionFiles } from './persona-session-files';
import { PersonaSessionService, type PersonaSessionBoard, type PersonaSessionFleet } from './persona-session-service';
import { PersonaTurnWatcher, type FleetChanges } from './persona-turn-watcher';

export interface PersonaSessionsWiring {
  readonly board: PersonaSessionBoard;
  readonly host: EngineHost;
  readonly git: TicketsGit;
  readonly fleet: PersonaSessionFleet & { stream(runId: string): Promise<string | null> };
  /** Every change of the fleet's state (the runner's record moves when a turn ends). */
  readonly fleetChanges: FleetChanges;
  /** A 1:1 session file changed without a client's call. */
  readonly changed: (file: string) => void;
  /** A chat bridge over a system prompt — the `api` persona's way. */
  readonly bridge: (systemPrompt: string) => ChatBridge;
  readonly log: (message: string, level?: 'info' | 'warn' | 'error') => void;
  /** The tools attached to a 1:1 (req-217: the service's vault MCP); absent = none (no service). */
  readonly tools?: OneOnOneToolSeam;
}

/** The persona 1:1's parts (req-168), wired once in the engine's composition. */
export function composePersonaSessions(wiring: PersonaSessionsWiring): PersonaSessionService {
  const { board, host, git, fleet, log } = wiring;
  return new PersonaSessionService({
    board,
    fleet,
    files: new PersonaSessionFiles({ host, git, log }),
    context: new PersonaSessionContext({ host, runs: () => fleet.runs(), tools: wiring.tools ?? NO_TOOLS }),
    watcher: new PersonaTurnWatcher(fleet, wiring.fleetChanges),
    bridge: bridgeTurnRunner(wiring.bridge),
    onChanged: wiring.changed,
    log,
  });
}
