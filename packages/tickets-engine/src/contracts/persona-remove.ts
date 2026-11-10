/**
 * Deleting a persona (req-261, milestone 236): what the route carries.
 *
 * `POST /api/personas/<id>/remove` with `{ confirm: <the persona's title> }`
 * deletes `tickets/_meta/personas/<id>/` whole — `persona.md`, `prompt.md`,
 * `memory.md`, the journal and the persona's own skills — in one commit
 * `personas: <id> removed`. The ticket history and the 1:1 chat files under
 * `_meta/chat/` are not the persona's folder and stay.
 *
 * The engine checks the typed title itself: whatever the client did, a
 * mismatch deletes nothing. Every refusal carries a stable `code`; a client
 * shows its own catalog text for it (`persona.delete.error.<code>`) and
 * falls back to the English `error` only for a code it does not know.
 */

export const PERSONA_REMOVE_CODES = [
  'no_vault',
  'no_persona',
  /** The owner's own persona (`you`, `kind: human`) is never deleted. */
  'human',
  /** A live or held run, 1:1 or free session of the persona. */
  'busy',
  /** A pipeline column or the crew's default persona pins it. */
  'pinned',
  /** The typed confirmation is not the persona's title, character for character. */
  'confirm',
  'internal',
] as const;

export type PersonaRemoveCode = (typeof PERSONA_REMOVE_CODES)[number];

export interface PersonaRemoveCommand {
  readonly persona: string;
  /** What the owner typed: the persona's title, exactly. */
  readonly confirm: string;
}

export interface PersonaRemoveFailure {
  readonly ok: false;
  readonly code: PersonaRemoveCode;
  /** English text for logs and for a client that does not know the code. */
  readonly error: string;
  /** `pinned`: the titles of the pipeline columns that pin the persona. */
  readonly columns?: readonly string[];
  /** `pinned`: the crew's `default-persona` is this persona. */
  readonly crewDefault?: boolean;
}

export type PersonaRemoveReply =
  | { readonly ok: true; readonly persona: string; /** The files the commit removed. */ readonly files: number; readonly warning?: string }
  | PersonaRemoveFailure;

/** The route's port: what the engine, the plugin's IPC and the remote protocol all call. */
export interface PersonaRemovePort {
  personaRemove(cmd: PersonaRemoveCommand): Promise<PersonaRemoveReply>;
}
