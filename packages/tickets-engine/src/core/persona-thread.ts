import { splitFrontmatter } from '../../../../shared/frontmatter';
import { PERSONAS_DIR } from './persona';

/**
 * The retired persona thread (ADR-0088, U4 — concept §4.5): the owner's
 * coaching notes, one Markdown file per persona under
 * `tickets/_meta/personas/<id>/thread.md`. req-168 (ADR-0093, R3) retired
 * it: the 1:1 is a persona session in a chat session file, and a thread's
 * lines migrate ONCE into the persona's first 1:1 session
 * (`persona-session-file.ts` `migrateThread`), after which the file is
 * removed. Only the reader stays, for that migration; nothing writes a
 * thread any more. The reader forgives: an unreadable line is skipped,
 * never a guess (ADR-0076's asymmetric tolerance).
 *
 *     - '2026-11-03T09:01:00.000Z' owner — Treat rank fields as the owner's word
 */

export interface PersonaThreadMessage {
  /** The message instant (ISO). */
  readonly at: string;
  /** The message's author role; only the owner writes this file today. */
  readonly role: 'owner';
  /** The message text, one line. */
  readonly text: string;
}

const NL = String.fromCharCode(10);

/** The vault-relative path of one persona's coaching thread. */
export function threadPathFor(id: string): string {
  return `${PERSONAS_DIR}/${id}/thread.md`;
}

/** Reads a thread file back; the body only — the frontmatter is not messages. */
export function parseThread(text: string): readonly PersonaThreadMessage[] {
  const { body, hadFence } = splitFrontmatter(text);
  const source = hadFence ? body : text;
  const messages: PersonaThreadMessage[] = [];
  for (const line of source.split(NL)) {
    const match = /^- '([^']+)' owner — (.*)$/.exec(line);
    if (match !== null) {
      messages.push({ at: match[1]!, role: 'owner', text: match[2]! });
    }
  }
  return messages;
}
