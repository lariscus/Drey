/**
 * The persona 1:1's session file — the reader and the answer's proposal
 * blocks (req-168, ADR-0093, R3; the format is `persona-session-file.ts`).
 * The reader forgives (ADR-0076): an unreadable line or card is skipped,
 * never a guess.
 */
import { splitFrontmatter } from '../../../../shared/frontmatter';
import type { PersonaMessage, PersonaProposal, PersonaProposalCommand, PersonaSessionFile } from '../contracts/persona-session';
import { sessionPersonaOf } from './chat-session';

const NL = String.fromCharCode(10);
const FENCE = '```';

function rec(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/** A proposal's command off the page or the answer; null when it is not one. */
export function personaCommandOf(raw: unknown): PersonaProposalCommand | null {
  const value = rec(raw);
  if (value?.['kind'] === 'prompt' && typeof value['text'] === 'string' && value['text'].trim() !== '') {
    return { kind: 'prompt', text: value['text'] };
  }
  if (value?.['kind'] === 'skill' && typeof value['skill'] === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value['skill'].trim())) {
    return { kind: 'skill', skill: value['skill'].trim() };
  }
  return null;
}

/** A message line's continuation: the two-space lines after it (an empty line inside is written as two spaces). */
function continuation(lines: readonly string[], from: number): { readonly text: string[]; readonly next: number } {
  const text: string[] = [];
  let i = from;
  while (i < lines.length && lines[i]!.startsWith('  ') && !lines[i]!.trimStart().startsWith(FENCE)) {
    text.push(lines[i]!.slice(2));
    i++;
  }
  return { text, next: i };
}

/** The card's JSON block right after its line. */
function blockAfter(lines: readonly string[], at: number): unknown {
  const block = lines.slice(at + 1, at + 4).map((l) => l.trim());
  return block[0] === `${FENCE}json` && block[2] === FENCE ? safeJson(block[1] ?? '') : null;
}

interface ParseState {
  readonly messages: PersonaMessage[];
  readonly proposals: PersonaProposal[];
  migrated: number | null;
}

function readCard(line: string, lines: readonly string[], i: number, state: ParseState): boolean {
  const pending = /^- '([^']+)' proposal (p-\d+) pending — (.*)$/.exec(line);
  if (pending !== null) {
    const command = personaCommandOf(blockAfter(lines, i));
    if (command !== null) {
      state.proposals.push({ id: pending[2]!, state: 'pending', summary: pending[3]!, command, at: pending[1]!, decidedAt: null, outcome: null });
    }
    return true;
  }
  const decided = /^- '([^']+)' proposal (p-\d+) (confirmed|dismissed) — (.*?)(?: → (.*))?$/.exec(line);
  if (decided === null) {
    return false;
  }
  const at = state.proposals.findIndex((p) => p.id === decided[2] && p.state === 'pending');
  if (at >= 0) {
    state.proposals[at] = { ...state.proposals[at]!, state: decided[3] as 'confirmed' | 'dismissed', decidedAt: decided[1]!, outcome: decided[5] ?? null };
  }
  return true;
}

/** Reads a persona session file back; null when it has no frontmatter or no `persona:` key. */
export function parsePersonaSession(text: string, file: string): PersonaSessionFile | null {
  const { yamlText, body, hadFence } = splitFrontmatter(text);
  const persona = hadFence && yamlText !== null ? sessionPersonaOf(yamlText) : null;
  if (persona === null || yamlText === null) {
    return null;
  }
  const title = /^title:\s*"(.*)"\s*$/m.exec(yamlText)?.[1] ?? `1:1 with ${persona}`;
  const createdAt = /^created:\s*'([^']+)'/m.exec(yamlText)?.[1] ?? '';
  const state: ParseState = { messages: [], proposals: [], migrated: null };
  const lines = body.replace(/\r\n?/g, NL).split(NL);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const message = /^- '([^']+)' (owner|persona) — (.*)$/.exec(line);
    if (message !== null) {
      const more = continuation(lines, i + 1);
      state.messages.push({ role: message[2] as 'owner' | 'persona', text: [message[3]!, ...more.text].join(NL).replace(/\s+$/, ''), at: message[1]! });
      i = more.next - 1;
      continue;
    }
    const migrated = /^- '[^']+' migrated — (\d+) lines? from thread\.md$/.exec(line);
    if (migrated !== null) {
      state.migrated = Number(migrated[1]);
      continue;
    }
    readCard(line, lines, i, state);
  }
  return { file, title, createdAt, persona, messages: state.messages, proposals: state.proposals, migrated: state.migrated };
}

/** What the persona proposed in an answer, and the answer without the blocks. */
export interface ExtractedAnswer {
  readonly text: string;
  readonly proposals: readonly { readonly summary: string; readonly command: PersonaProposalCommand }[];
}

/**
 * Pulls the ```proposal blocks out of an answer (the brief's grammar): each
 * readable one becomes a card, an unreadable one stays in the text where
 * the owner sees it — never silently dropped.
 */
export function extractProposals(answer: string): ExtractedAnswer {
  const proposals: { summary: string; command: PersonaProposalCommand }[] = [];
  const pattern = new RegExp(`${FENCE}proposal\\s*${NL}([\\s\\S]*?)${NL}?${FENCE}`, 'g');
  const text = answer.replace(/\r\n?/g, NL).replace(pattern, (whole: string, body: string) => {
    const raw = rec(safeJson(body.trim()));
    const command = personaCommandOf(raw);
    if (command === null) {
      return whole;
    }
    const summary = typeof raw?.['summary'] === 'string' && raw['summary'].trim() !== '' ? raw['summary'].trim() : command.kind === 'prompt' ? 'Change my instructions' : `Add the skill ${command.skill}`;
    proposals.push({ summary, command });
    return '';
  });
  return { text: text.replace(new RegExp(`${NL}{3,}`, 'g'), `${NL}${NL}`).trim(), proposals };
}
