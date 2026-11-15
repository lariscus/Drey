/**
 * The persona 1:1's session file — the writers (req-168, ADR-0093, R3): a
 * Mission Control chat session (`core/chat-session.ts`, one file under
 * `tickets/_meta/chat/`) with a `persona:` key, so it stays openable in
 * Drey's editor and diffable in git. Beyond the MC lines it holds:
 *
 *     ---
 *     title: "1:1 with Ben"
 *     created: '2026-11-09T10:00:00.000Z'
 *     persona: ben
 *     ---
 *
 *     - '2026-11-03T09:01:00.000Z' owner — Treat rank fields as the owner's word
 *     - '2026-11-09T10:00:00.000Z' migrated — 1 line from thread.md
 *     - '2026-11-09T10:01:00.000Z' owner — Why did T-0007 fail?
 *     - '2026-11-09T10:02:10.000Z' persona — The gate ran `npm test`:
 *
 *       three specs failed on the date format.
 *     - '2026-11-09T10:02:10.000Z' proposal p-1 pending — Name the date format in my instructions
 *       ```json
 *       {"kind":"prompt","text":"…"}
 *       ```
 *
 * A message spans lines: every line after the first is indented two
 * spaces (an empty line is written as the two spaces), so the generic MC
 * reader still sees one line per message. Writes are strict, the reader
 * forgives (ADR-0076). Decisions on cards reuse `decideProposal`.
 */
import type { PersonaProposalCommand } from '../../contracts/persona-session';
import { newSessionText } from '../chat/chat-session';
import { parseThread } from './persona-thread';

const NL = String.fromCharCode(10);

/** The title of a persona's 1:1 session. */
export function personaSessionTitle(title: string): string {
  return `1:1 with ${title.trim() === '' ? 'persona' : title.trim()}`;
}

/** A fresh persona session file: the MC session header with the `persona:` key. */
export function newPersonaSessionText(title: string, now: Date, persona: string): string {
  return newSessionText(personaSessionTitle(title), now, undefined, persona);
}

function withNewline(text: string): string {
  return text.endsWith(NL) ? text : `${text}${NL}`;
}

/** One message line with its continuation lines (two spaces in front). */
function messageLines(at: string, role: 'owner' | 'persona', message: string): string {
  const lines = message.replace(/\r\n?/g, NL).replace(/\s+$/, '').split(NL);
  const rest = lines.slice(1).map((line) => `  ${line}`);
  return [`- '${at}' ${role} — ${lines[0] ?? ''}`, ...rest].join(NL) + NL;
}

/** The owner's line (multi-line kept); an empty message refuses. */
export function appendPersonaOwner(text: string, now: Date, message: string): string {
  if (message.trim() === '') {
    throw new Error('a 1:1 message is not empty');
  }
  return withNewline(text) + messageLines(now.toISOString(), 'owner', message.trim());
}

/** The persona's answer (multi-line Markdown kept); an empty answer writes nothing. */
export function appendPersonaAnswer(text: string, now: Date, answer: string): string {
  return answer.trim() === '' ? text : withNewline(text) + messageLines(now.toISOString(), 'persona', answer.trim());
}

function nextProposalId(text: string): string {
  let max = 0;
  for (const match of text.matchAll(/proposal p-(\d+) pending/g)) {
    max = Math.max(max, Number(match[1]));
  }
  return `p-${max + 1}`;
}

/** A pending card for what the persona proposed; the minted id comes back. */
export function appendPersonaProposal(
  text: string,
  now: Date,
  summary: string,
  command: PersonaProposalCommand,
): { readonly text: string; readonly id: string } {
  const id = nextProposalId(text);
  const line = `- '${now.toISOString()}' proposal ${id} pending — ${summary.replace(/\s+/g, ' ').trim()}`;
  return { id, text: withNewline(text) + `${line}${NL}  \`\`\`json${NL}  ${JSON.stringify(command)}${NL}  \`\`\`${NL}` };
}

/**
 * The one migration of `thread.md` (req-168, R3): its owner lines, with
 * their own stamps, open the persona's first 1:1 session, followed by the
 * `migrated` line that says how many came over. A thread without a
 * readable line migrates nothing (count 0, the session text unchanged).
 */
export function migrateThread(sessionText: string, threadText: string, now: Date): { readonly text: string; readonly count: number } {
  const lines = parseThread(threadText);
  if (lines.length === 0) {
    return { text: sessionText, count: 0 };
  }
  let text = withNewline(sessionText);
  for (const line of lines) {
    text += messageLines(line.at, 'owner', line.text);
  }
  const noun = lines.length === 1 ? 'line' : 'lines';
  return { text: `${text}- '${now.toISOString()}' migrated — ${lines.length} ${noun} from thread.md${NL}`, count: lines.length };
}
