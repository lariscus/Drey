/**
 * The free session's wire shapes (req-173, R12): what the owner asks for
 * ("New session… persona, folder, class" — service window, Crew tab, or
 * Pia's card) and what the form offers. Shared by the engine, the tickets
 * plugin, the service window and Mission Control.
 */

export type SessionPermission = 'read-only' | 'accept-edits' | 'bypass';

export const SESSION_PERMISSIONS: readonly SessionPermission[] = ['read-only', 'accept-edits', 'bypass'];

/** One free session asked for. */
export interface FreeSessionAsk {
  readonly persona: string;
  /** Absolute: the folder the session works in. */
  readonly directory: string;
  /** The class asked of the pool; absent/null = the model table's class of the persona's model. */
  readonly poolClass?: 'A' | 'B' | 'C' | null;
  /** The session's permission override; absent = the vault's `permission-mode` (`_meta/crew.md`). */
  readonly permissionMode?: SessionPermission;
  /** A model pin for this session; absent = the persona's. */
  readonly model?: string | null;
  /** What the owner wants done first: sent as the first line (with the brief). Absent = the session waits. */
  readonly firstLine?: string;
  /**
   * req-283: the project the session works in — its vaults and folders are
   * what the session's vault token reaches. Absent = the folder's: the one
   * project whose repository's checkout holds the directory (none when no
   * project, or more than one, names such a repository: no vault).
   */
  readonly project?: string;
}

/** The persona as the form lists it. */
export interface SessionPersonaOption {
  readonly id: string;
  readonly title: string;
  /** The harness, `claude-code` / `opencode` / …; `api` personas are not offered. */
  readonly worker: string;
}

/** What the "New session…" form offers. */
export type SessionOptionsReply =
  | {
      readonly ok: true;
      readonly personas: readonly SessionPersonaOption[];
      /** The classes the model table knows, strongest first. */
      readonly classes: readonly ('A' | 'B' | 'C')[];
      /** The tickets repository — offered first: it is an allowed directory (R12). */
      readonly ticketsVault: string;
      /** The work repositories' local checkouts (`_meta/repos.md` `path:`), by name. */
      readonly repos: readonly { readonly name: string; readonly path: string }[];
      /** The vault's permission mode — the form's default. */
      readonly permissionMode: SessionPermission;
      readonly defaultPersona: string | null;
      /** req-283: the board's projects a session may be started in, by id. */
      readonly projects?: readonly { readonly id: string; readonly name: string }[];
    }
  | { readonly ok: false; readonly error: string };

export type FreeSessionStartReply = { readonly ok: true; readonly runId: string } | { readonly ok: false; readonly error: string };
