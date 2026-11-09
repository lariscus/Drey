import { splitFrontmatter } from '../../../../shared/frontmatter';
import { parsePersonaFile } from './persona';

/**
 * One prose, not two (R11, req-171): `persona.md` keeps the frontmatter,
 * the persona's "who it is" lives at the top of `prompt.md`. This is the
 * pure half of the one-time migration: given the two files' text it says
 * what they become, or null when nothing is left to move (idempotent — a
 * second run finds a persona.md without a body).
 */

/** The sentences the engine itself once wrote below the fence; they carry nothing and disappear. */
const PLACEHOLDERS: readonly RegExp[] = [
  /^Who .+ is: role, tone, limits\. Edit freely — the next run reads it\.$/,
  /^.+ is you: manual steps park the ticket here until you accept or send it back\.$/,
];

export interface ProseMigration {
  /** The new `persona.md`: the frontmatter fence and nothing below it. */
  readonly persona: string;
  /** The new `prompt.md`; null when the prompt stays as it is (the prose was a placeholder or already there). */
  readonly prompt: string | null;
  /** What moved, for the log: the prose's length in lines, 0 for a dropped placeholder. */
  readonly lines: number;
}

const isPlaceholder = (prose: string): boolean => PLACEHOLDERS.some((pattern) => pattern.test(prose.replace(/\s+/g, ' ').trim()));

/** The persona.md text with its body removed, the frontmatter bytes untouched. */
function withoutBody(text: string): string {
  const fence = /^(---\r?\n[\s\S]*?\r?\n---)[ \t]*(?:\r?\n|$)/.exec(text);
  return fence === null ? text : `${fence[1]!.replace(/\r\n/g, '\n')}\n`;
}

/** `## Who Ben is` and the prose above the prompt's own text. */
function promptWith(title: string, prose: string, existing: string): string {
  const head = `## Who ${title} is\n\n${prose}`;
  const rest = existing.replace(/\r\n/g, '\n').trim();
  return rest === '' ? `${head}\n` : `${head}\n\n${rest}\n`;
}

export function proseMigrationOf(id: string, personaText: string, promptText: string | null): ProseMigration | null {
  const { body, hadFence } = splitFrontmatter(personaText);
  const prose = body.replace(/\r\n/g, '\n').trim();
  if (!hadFence || prose === '') {
    return null;
  }
  const persona = withoutBody(personaText);
  const existing = promptText ?? '';
  if (isPlaceholder(prose) || existing.replace(/\r\n/g, '\n').includes(prose)) {
    return { persona, prompt: null, lines: 0 };
  }
  return { persona, prompt: promptWith(parsePersonaFile(id, personaText).title, prose, existing), lines: prose.split('\n').length };
}
