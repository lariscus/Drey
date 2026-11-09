import * as path from 'node:path';
import { hostname } from 'node:os';
import { createChatBridge } from '../services/chat-llm';
import { ChatService } from '../services/chat-service';
import { composePersonaSessions } from '../services/compose-persona-sessions';
import { PersonaProseMigrator } from '../services/persona-prose-migrator';
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
export function composeSessionParts(opts: EngineOptions, config: FileConfigStore, parts: BoardParts, log: Log): SessionParts {
  const { board, host, git, fleet, hub } = parts;
  const chat = new ChatService({
    board,
    host,
    git,
    bridge: opts.chatBridge ?? createChatBridge({ config }),
    sessions: parts.freeSessions, // req-173: Pia's startSession card
    shadows: new FilePlanShadowStore(path.join(opts.home, 'plan-shadow.json')),
    modelName: () => config.get<string>('chat.model'),
    actor: `chat@${hostname().toLowerCase()}`,
    log,
    onEvent: (file, event) => hub.emit('chat', { file, event }),
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
    bridge: (systemPrompt) => opts.chatBridge ?? createChatBridge({ config, systemPrompt }),
    log,
    ...(opts.oneOnOneTools === undefined ? {} : { tools: opts.oneOnOneTools }),
  });
  const personaRecords = new PersonaRecords({ board, host, git, log });
  const skills = new SkillService({ board, host, git });
  migrateOnce(log, { personaRecords, skills, prose: new PersonaProseMigrator({ board, host, git, log }) });
  return { chat, personaSessions, personaRecords, skills };
}

/** The migrations that run behind startup: failures are logged, never fatal. */
function migrateOnce(log: Log, migrators: { personaRecords: PersonaRecords; skills: SkillService; prose: PersonaProseMigrator }): void {
  // req-169: friction.md migrates once into each persona's journal.
  void migrators.personaRecords.migrateAll().catch((error: unknown) => log(`friction.md migration failed: ${messageOf(error)}`, 'warn'));
  // req-172: skills as Agent Skills; the legacy flat files migrate once into folders.
  void migrators.skills.migrateAll().catch((error: unknown) => log(`skills migration failed: ${messageOf(error)}`, 'warn'));
  // req-171 (R11): one prose, not two - the prose below a persona.md fence moves once into prompt.md.
  void migrators.prose.migrateAll().catch((error: unknown) => log(`persona prose migration failed: ${messageOf(error)}`, 'warn'));
}

