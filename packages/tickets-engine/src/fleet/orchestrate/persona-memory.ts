import { holdsLesson, personaLessonLine } from '../../core/memory-line';
import { PERSONAS_DIR } from '../../core/persona';
import type { Clock } from '../ports/clock';
import type { FileSystem } from '../ports/file-system';
import { isTicketRun } from '../protocol-session';
import { messageOf, type LiveRun } from './live-run';

/**
 * The persona memory file never grows past this many lines, the `# Memory`
 * header included — the same cap `persona-store` applies on the service
 * side (the two writers keep one file shape).
 */
export const PERSONA_MEMORY_LINE_CAP = 200;

/**
 * A closing round's lesson in its persona's memory (R4/R14, req-169):
 * `- <date> · <ticket> · <persona>/<model> · <lesson>` appended to
 * `tickets/_meta/personas/<persona>/memory.md`, written directly — no
 * proposal card for memory. The next dispatch of the persona reads it back
 * as the instruction's `## Memory` slice. At most one line per round; a
 * smooth run writes nothing (the per-run outcome line of E3 is gone). A
 * lesson the memory already holds is not written twice (req-226). The
 * standalone runner's plain write — in Drey Service the engine writes and
 * commits it (req-225). Every failure is a log line, never a thrown error.
 */
export class PersonaMemory {
  constructor(
    private readonly clock: Clock,
    private readonly fs: FileSystem,
    private readonly log: (message: string) => void,
  ) {}

  /** The lesson as written; null when nothing was written. */
  async appendLesson(run: LiveRun, lesson: string): Promise<string | null> {
    const persona = run.info.persona ?? null;
    if (persona === null || persona.trim() === '' || lesson.trim() === '' || !isTicketRun(run.request)) {
      return null;
    }
    const entry = personaLessonLine({
      date: this.clock.now().toISOString().slice(0, 10),
      ticket: /^T-\d{4,}$/.test(run.info.ticketId) ? run.info.ticketId : null,
      persona,
      model: run.info.model ?? run.request.model ?? 'unknown',
      lesson,
    });
    try {
      const abs = this.fs.join(run.request.ticketsVaultPath, PERSONAS_DIR, persona, 'memory.md');
      const existing = await this.fs.readTextOrNull(abs);
      if (existing !== null && holdsLesson(existing, entry)) {
        return null;
      }
      await this.fs.mkdirp(this.fs.dirname(abs));
      await this.fs.writeText(abs, withEntry(existing, entry));
      return entry;
    } catch (error) {
      this.log(`run ${run.info.id}: persona memory append failed — ${messageOf(error)}`);
      return null;
    }
  }
}

/** The file with one more entry: a `# Memory` header at creation, capped, oldest entries first out. */
function withEntry(existing: string | null, entry: string): string {
  let header: string[] = ['# Memory', ''];
  let entries: string[] = [];
  if (existing !== null && existing.trim() !== '') {
    const lines = existing.replace(/\r\n/g, '\n').split('\n');
    const hasHeader = (lines[0] ?? '').startsWith('#');
    header = hasHeader ? [lines[0]!, ''] : [];
    entries = (hasHeader ? lines.slice(1) : lines).filter((line) => line.trim() !== '');
  }
  entries.push(entry);
  const maxEntries = PERSONA_MEMORY_LINE_CAP - header.length;
  return `${[...header, ...entries.slice(Math.max(0, entries.length - maxEntries))].join('\n')}\n`;
}
