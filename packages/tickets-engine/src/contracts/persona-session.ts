/**
 * The persona 1:1 as the clients read it (req-168, ADR-0093, R3): the
 * conversation in the persona's chat session file, its proposal cards and
 * the state of the session behind it. The wire shape of `personaThread` /
 * `personaThreadAppend` and of `GET|POST /api/personas/<id>/thread`.
 */

/** What a persona proposes in a 1:1: its instructions rewritten, or a skill added. Nothing is adopted before the owner accepts. */
export type PersonaProposalCommand =
  | { readonly kind: 'prompt'; readonly text: string }
  | { readonly kind: 'skill'; readonly skill: string };

export interface PersonaProposal {
  /** `p-<n>`, minted per session file. */
  readonly id: string;
  readonly state: 'pending' | 'confirmed' | 'dismissed';
  readonly summary: string;
  readonly command: PersonaProposalCommand;
  readonly at: string;
  readonly decidedAt: string | null;
  readonly outcome: string | null;
}

/** One message of the 1:1: the owner's line or the persona's answer (multi-line Markdown). */
export interface PersonaMessage {
  readonly role: 'owner' | 'persona';
  readonly text: string;
  readonly at: string;
}

/**
 * The session behind the conversation: `none` (no session — the next line
 * starts one), `starting`, `answering` (a turn runs), `held` (it stands,
 * waiting for the next line, until its idle release), `bridge` (an `api`
 * persona: no session, the chat bridge answers each line).
 */
export type PersonaSessionState = 'none' | 'starting' | 'answering' | 'held' | 'bridge';

/** The parsed persona session file. */
export interface PersonaSessionFile {
  readonly file: string;
  readonly title: string;
  readonly createdAt: string;
  readonly persona: string;
  readonly messages: readonly PersonaMessage[];
  readonly proposals: readonly PersonaProposal[];
  /** How many `thread.md` lines migrated into this file (req-168's one migration); null when none did. */
  readonly migrated: number | null;
}

/** `personaThread` / `personaThreadAppend`: the conversation, its cards and the session's state. */
export type PersonaThreadReply =
  | {
      readonly ok: true;
      readonly messages: readonly PersonaMessage[];
      readonly proposals?: readonly PersonaProposal[];
      /** The session file; absent while the persona has none yet. */
      readonly file?: string;
      readonly session?: PersonaSessionState;
      /** The live session's run id, while one is held or answering. */
      readonly runId?: string;
      /** When the held session will be released if nothing follows (ISO). */
      readonly releaseAt?: string;
      /** What the live session has cost so far (USD); null while its harness reported none. */
      readonly costUsd?: number | null;
      /** The last turn failed: why (the answer never came). */
      readonly failure?: string;
      readonly warning?: string;
    }
  | { readonly ok: false; readonly error: string };

/** A proposal card's decision (`POST /api/personas/<id>/thread/proposals/<p>/<confirm|dismiss>`). */
export type PersonaProposalDecision = 'confirm' | 'dismiss';
