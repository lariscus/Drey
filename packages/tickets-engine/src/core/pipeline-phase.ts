import type { PipelinePhase, TicketIssue } from '../contracts/tickets';

/**
 * One phase entry of pipeline.md as the board reads it: a column the
 * board draws — its id, its title, its colour. Tolerant: a present but
 * invalid colour degrades visibly (an issue), never a board error.
 */

/** `color:` in pipeline.md — a `#rrggbb` hex value (T-0084). */
const COLOR_HEX = /^#[0-9a-f]{6}$/i;

/** A present-but-invalid colour degrades to the palette, visibly — never a board error (asymmetric tolerance, like `push:`). */
function colorOf(map: Readonly<Record<string, unknown>>, id: string, issues: TicketIssue[]): string | null {
  const color = typeof map['color'] === 'string' && map['color'].trim() !== '' ? map['color'].trim() : null;
  if (color === null) {
    return null;
  }
  if (COLOR_HEX.test(color)) {
    return color;
  }
  issues.push({ level: 'noise', message: `pipeline.md: ${id}'s color must be #rrggbb — ignored` });
  return null;
}

/** One phase entry (its id already checked). */
export function pipelinePhaseOf(map: Readonly<Record<string, unknown>>, id: string, issues: TicketIssue[]): PipelinePhase {
  const title = map['title'];
  return {
    id,
    title: typeof title === 'string' && title.trim() !== '' ? title.trim() : id,
    color: colorOf(map, id, issues),
  };
}
