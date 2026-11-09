import { PERSONAS_DIR } from '../../core/persona';
import type { Clock } from '../ports/clock';
import type { FileSystem } from '../ports/file-system';
import { isOneOnOne } from '../protocol-session';
import type { TerminalRunState } from '../run/run-state';
import { messageOf, type LiveRun } from './live-run';

/**
 * The persona memory file never grows past this many lines, the `# Memory`
 * header included — the same cap `persona-store` applies on the service
 * side (the two writers keep one file shape).
 */
export const PERSONA_MEMORY_LINE_CAP = 200;

/**
 * A settled run's one-line lesson in its persona's memory (E3, ADR-0088):
 * `- <date> · <ticket> · <outcome> · <tokens> tokens` appended to
 * `tickets/_meta/personas/<persona>/memory.md`. The next dispatch of the
 * persona reads it back as the instruction's `## Memory` slice. Every
 * failure is a log line, never a thrown error. A 1:1 (req-168) writes
 * nothing: what a conversation teaches lands in memory only through the
 * owner (or req-169's closing round), never unasked.
 */
export class PersonaMemory {
  constructor(
    private readonly clock: Clock,
    private readonly fs: FileSystem,
    private readonly log: (message: string) => void,
  ) {}

  async append(run: LiveRun, state: TerminalRunState): Promise<void> {
    const persona = run.info.persona ?? null;
    if (persona === null || persona.trim() === '' || isOneOnOne(run.request)) {
      return;
    }
    const outcome = state === 'done' ? 'handed-over' : state;
    const entry = `- ${this.clock.now().toISOString().slice(0, 10)} · ${run.info.ticketId} · ${outcome} · ${run.info.tokensIn + run.info.tokensOut} tokens`;
    try {
      const abs = this.fs.join(run.request.ticketsVaultPath, PERSONAS_DIR, persona, 'memory.md');
      const existing = await this.fs.readTextOrNull(abs);
      await this.fs.mkdirp(this.fs.dirname(abs));
      await this.fs.writeText(abs, withEntry(existing, entry));
    } catch (error) {
      this.log(`run ${run.info.id}: persona memory append failed — ${messageOf(error)}`);
    }
  }
}

/** The file with one more entry: a `# Memory` header at creation, capped, oldest entries first out. */
function withEntry(existing: string | null, entry: string): string {
  let header: string[] = ['# Memory', ''];
  let entries: string[] = [];
  if (existing !== null && existing.trim() !== '') {
    const lines = existing.split('\n');
    const hasHeader = (lines[0] ?? '').startsWith('#');
    header = hasHeader ? [lines[0]!, ''] : [];
    entries = (hasHeader ? lines.slice(1) : lines).filter((line) => line.trim() !== '');
  }
  entries.push(entry);
  const maxEntries = PERSONA_MEMORY_LINE_CAP - header.length;
  return `${[...header, ...entries.slice(Math.max(0, entries.length - maxEntries))].join('\n')}\n`;
}
