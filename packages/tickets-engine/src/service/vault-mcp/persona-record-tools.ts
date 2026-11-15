/**
 * The worker's own persona writes (req-226), served beside the vault tools:
 * `memory_write` saves one lesson to the run's persona's `memory.md`,
 * `journal_write` one note to its `reviews.md` — once each per run, in the
 * closing round's line form and caps, through the engine's one writer of
 * the tickets repository (one commit each, req-225). Only the token's own
 * persona is ever written; a 1:1, a free session and a run without a
 * persona are not offered the tools.
 */
import { fail, type McpToolDef, type McpToolResult } from '../../../../../shared/vault-tools';
import type { RunJournalWrite, RunMemoryWrite, RunRecordAuthor, RunRecordReply } from '../../contracts/persona-run-records';
import { PERSONAS_DIR } from '../../core/persona/persona';
import { JOURNAL_FILE, oneLine } from '../../core/persona/persona-journal';
import { CLOSING_FRICTION_MAX, CLOSING_LESSON_MAX } from '../../fleet/runner/closing-round-prompt';
import { JOURNAL_WRITE_TOOL, MEMORY_WRITE_TOOL } from '../../fleet/protocol-closing';
import type { TokenSession } from './run-tokens';
import type { VaultCallTarget } from './vault-call-target';

/** The engine's writer, as the vault MCP reaches it (the invoke channel). */
export interface PersonaRecordsPort {
  memoryWrite(write: RunMemoryWrite): Promise<RunRecordReply>;
  journalWrite(write: RunJournalWrite): Promise<RunRecordReply>;
}

const TOOLS: readonly McpToolDef[] = [
  {
    name: MEMORY_WRITE_TOOL,
    description: `Save one lesson to your persona memory now, while you remember it: one concrete, reusable rule the NEXT run of yours should know — not a story of this run. One line, at most ${CLOSING_LESSON_MAX} characters, once per run; it is that run's lesson, so the closing round asks for none. A wrong lesson misleads every later run: when in doubt, do not write.`,
    inputSchema: { type: 'object', properties: { lesson: { type: 'string', description: 'The lesson, one line.' } }, required: ['lesson'] },
  },
  {
    name: JOURNAL_WRITE_TOOL,
    description: `Note in your persona journal where this run stumbled: what you lacked, guessed or hit twice. One line, at most ${CLOSING_FRICTION_MAX} characters, once per run. The journal is the owner's evidence; it is never read back into a run.`,
    inputSchema: { type: 'object', properties: { note: { type: 'string', description: 'The note, one line.' } }, required: ['note'] },
  },
];

const NAMES = new Set(TOOLS.map((tool) => tool.name));

export class PersonaRecordTools {
  constructor(private readonly port: PersonaRecordsPort) {}

  /** The two tools for a ticket run with a persona; none for anyone else. */
  list(session: TokenSession | undefined): McpToolDef[] {
    return session?.grant.records !== undefined && session.grant.persona !== null ? [...TOOLS] : [];
  }

  handles(name: string): boolean {
    return NAMES.has(name);
  }

  /** What the audit line names: the persona file the call writes. */
  targetOf(session: TokenSession, name: string): VaultCallTarget {
    const file = name === MEMORY_WRITE_TOOL ? 'memory.md' : JOURNAL_FILE;
    return { vault: null, path: `${PERSONAS_DIR}/${session.grant.persona ?? '?'}/${file}` };
  }

  async call(session: TokenSession, name: string, args: Readonly<Record<string, unknown>>): Promise<McpToolResult> {
    const { persona, records, ticketId } = session.grant;
    if (persona === null || records === undefined) {
      return fail(`Error: ${name} is not available to this call`);
    }
    const key = name === MEMORY_WRITE_TOOL ? 'lesson' : 'note';
    const raw = args[key];
    const text = typeof raw === 'string' ? oneLine(raw, name === MEMORY_WRITE_TOOL ? CLOSING_LESSON_MAX : CLOSING_FRICTION_MAX) : '';
    if (text === '') {
      return fail(`Error: ${name} needs a non-empty "${key}" — one line`);
    }
    if (!session.quota.take(name)) {
      return fail(`Error: this run already used ${name} — once per run`);
    }
    const author = { persona, ticket: ticketId, harness: records.harness, model: records.model };
    const reply = await this.write(name, author, text);
    if (!reply.ok) {
      session.quota.giveBack(name);
      return fail(`Error: ${reply.error}`);
    }
    const where = name === MEMORY_WRITE_TOOL ? 'your memory' : 'your journal';
    return { content: [{ type: 'text', text: `Saved to ${where}:\n${reply.line}${reply.warning !== undefined ? `\n(${reply.warning})` : ''}` }] };
  }
  /** The engine's reply; a channel that is down is a failed write, never a thrown error. */
  private async write(name: string, author: RunRecordAuthor, text: string): Promise<RunRecordReply> {
    try {
      return name === MEMORY_WRITE_TOOL ? await this.port.memoryWrite({ ...author, lesson: text }) : await this.port.journalWrite({ ...author, note: text });
    } catch (error) {
      return { ok: false, error: `the record could not be written (${error instanceof Error ? error.message : String(error)})` };
    }
  }
}
