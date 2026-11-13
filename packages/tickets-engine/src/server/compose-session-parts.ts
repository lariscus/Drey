import * as path from 'node:path';
import { hostname } from 'node:os';
import { createChatBridge } from '../services/chat-llm';
import { ChatService } from '../services/chat-service';
import { ChatVoices } from '../services/chat-voices';
import { composePersonaSessions } from '../services/compose-persona-sessions';
import { loadCrewPrompts } from '../services/crew-prompts';
import { MissionEntryTurns } from '../services/mission-entry-turns';
import { MissionPersonaPrompt } from '../services/mission-persona-prompt';
import { PersonaPinReader } from '../services/persona-pin-reader';
import { PersonaProseMigrator } from '../services/persona-prose-migrator';
import { ProjectMigrator } from '../services/project-migrator';
import { PersonaRemoveService } from '../services/persona-remove-service';
import { ProjectService } from '../services/project-service';
import { PersonaRecords } from '../services/persona-records';
import { PersonaSessionService } from '../services/persona-session-service';
import { FilePlanShadowStore } from '../services/plan-shadow';
import { SkillService } from '../services/skill-service';
import type { BoardParts } from './compose-board-parts';
import type { EngineOptions } from './engine-types';
import type { FileConfigStore } from './file-config';

type Log = NonNullable<EngineOptions['log']>;

/** The conversational parts: the Mission Control chat, the persona 1:1, the Memory tab's records, the skills. */
export interface SessionParts {
  readonly chat: ChatService;
  readonly personaSessions: PersonaSessionService;
  readonly personaRecords: PersonaRecords;
  readonly skills: SkillService;
  /** req-261: deleting a persona. */
  readonly personaRemoval: PersonaRemoveService;
  /** req-284: Settings → Projects' writes, one commit each. */
  readonly projects: ProjectService;
  /** The start's own work (req-256: seeding the default crew): `ready` of the engine awaits it, and so does `close`. */
  readonly startupWork: Promise<void>;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * E5a: the Mission Control chat — sessions under `tickets/_meta/chat/`, one
 * mission turn per owner message, every mutation a proposal card that
 * executes only on the owner's confirm, through the same board methods the
 * invoke channel exposes. The stream rides the hub as 'chat' changes
 * carrying { file, event }. Beside it: the persona 1:1 (req-168), the
 * Memory tab's journal (req-169), the skills (req-172) and the one-time
 * migrations those moved (the persona prose, req-171).
 */
export async function composeSessionParts(opts: EngineOptions, config: FileConfigStore, parts: BoardParts, log: Log): Promise<SessionParts> {
  const { board, host, git, fleet, hub } = parts;
  // req-279: the crew's chat prompts load here, once — the compose is the
  // engine's async wiring, a missing file names itself at the start.
  const crew = await loadCrewPrompts();
  const missionPrompt = new MissionPersonaPrompt(board, host);
  // req-257: Pia's entry in a ticket's chain — set once the chat exists, the chat's confirm reaches it late-bound.
  let missionEntries: MissionEntryTurns | null = null;
  const chat = new ChatService({
    board,
    host,
    git,
    // req-269: Mission Control speaks with its persona's prompt (Pia), read on every turn.
    // req-293/294/296: her memory and skills ride the prompt, her `model:` pins the model of her own turns.
    bridge: opts.chatBridge ?? createChatBridge({ config, crew, missionPersona: () => missionPrompt.text(), model: () => missionPrompt.model() }),
    sessions: parts.freeSessions, // req-173: Pia's startSession card
    shadows: new FilePlanShadowStore(path.join(opts.home, 'plan-shadow.json')),
    modelName: () => config.get<string>('chat.model'),
    // req-272: Shape and Flow chat speak as the persona of the chain's entries, the crew read on every turn.
    voices: new ChatVoices(board, host),
    actor: `chat@${hostname().toLowerCase()}`,
    log,
    onEvent: (file, event) => hub.emit('chat', { file, event }),
    onConfirmed: (title) => missionEntries?.confirmed(title) ?? Promise.resolve(),
  });
  missionEntries = new MissionEntryTurns(board, chat, (message, level) => log(message, level ?? 'info'));
  const entries = missionEntries;
  hub.subscribe((what) => {
    if (what === 'board' || what === 'fleet') {
      void entries.sweep().catch((error: unknown) => log(`mission entry turns failed: ${messageOf(error)}`, 'warn'));
    }
  });
  // req-168 (ADR-0093): the persona 1:1 — a held session of the persona's own harness over the runner,
  // or the chat bridge for an `api` persona; the conversation in its chat session file. req-217: the
  // vault read tools the service attaches ride its brief.
  const personaSessions = composePersonaSessions({
    board,
    host,
    git,
    fleet,
    fleetChanges: (listener) => hub.subscribe((what) => (what === 'fleet' ? listener() : undefined)),
    changed: (file) => hub.emit('chat', { file, event: { kind: 'done' } }),
    bridge: (systemPrompt, model) => opts.chatBridge ?? createChatBridge({ config, crew, systemPrompt, ...(model === null ? {} : { model: () => Promise.resolve(model) }) }),
    log,
    ...(opts.oneOnOneTools === undefined ? {} : { tools: opts.oneOnOneTools }),
  });
  const personaRecords = new PersonaRecords({ board, host, git, log });
  const skills = new SkillService({ board, host, git });
  const personaRemoval = new PersonaRemoveService({ board, fleet, host, git, pins: new PersonaPinReader(host, parts.crew.crewFiles) });
  const projects = new ProjectService({ board, host, git, changed: () => board.announceChanged() });
  const startupWork = migrateOnce(log, {
    personaRecords,
    skills,
    prose: new PersonaProseMigrator({ board, host, git, log }),
    crew: { board, seeder: parts.crewSeeder, pictures: parts.crewPictures },
    projects: (opts.migrateProjects ?? opts.seedDefaultCrew !== false) ? new ProjectMigrator({ board, host, git, log }) : null,
  });
  return { chat, personaSessions, personaRecords, skills, personaRemoval, projects, startupWork };
}

/** The one-time migrations of the engine's start. */
interface StartupMigrators {
  readonly personaRecords: PersonaRecords;
  readonly skills: SkillService;
  readonly prose: PersonaProseMigrator;
  readonly crew: { board: Pick<BoardParts['board'], 'detect'>; seeder: BoardParts['crewSeeder']; pictures: BoardParts['crewPictures'] };
  /** req-282: null = `migrateProjects: false`. */
  readonly projects: ProjectMigrator | null;
}

/** The migrations that run behind startup: failures are logged, never fatal. */
function migrateOnce(log: Log, migrators: StartupMigrators): Promise<void> {
  // req-169: friction.md migrates once into each persona's journal.
  void migrators.personaRecords.migrateAll().catch((error: unknown) => log(`friction.md migration failed: ${messageOf(error)}`, 'warn'));
  // req-172: skills as Agent Skills; the legacy flat files migrate once into folders.
  void migrators.skills.migrateAll().catch((error: unknown) => log(`skills migration failed: ${messageOf(error)}`, 'warn'));
  // req-171 (R11): one prose, not two - the prose below a persona.md fence moves once into prompt.md.
  void migrators.prose.migrateAll().catch((error: unknown) => log(`persona prose migration failed: ${messageOf(error)}`, 'warn'));
  // req-256: a board that lacks the default crew gets it once (the `seeded-crew:` marker in crew.md keeps a deleted persona deleted).
  // req-292: then the seeded crew and `you` get the shipped pictures they lack (the `seeded-pictures:` marker keeps a removed one removed).
  const { board, seeder, pictures } = migrators.crew;
  return board
    .detect()
    .then(async (vault) => {
      if (vault !== null) {
        await seeder?.seed(vault);
        await pictures?.backfill(vault);
      }
    })
    .catch((error: unknown) => log(`default crew seeding failed: ${messageOf(error)}`, 'warn'))
    // req-282: a board without project records gets its first one — after the seeding, so the two never commit at once.
    .then(() => migrators.projects?.migrate())
    .then(
      () => undefined,
      (error: unknown) => log(`the first project could not be written: ${messageOf(error)}`, 'warn'),
    );
}
