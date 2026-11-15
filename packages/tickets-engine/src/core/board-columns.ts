import type { BoardColumn } from '../contracts/tickets';

/** The id of the column after `phaseId` on the board, null on the last one (or an unknown id). */
export function columnAfter(columns: readonly BoardColumn[], phaseId: string): string | null {
  const index = columns.findIndex((c) => c.phase.id === phaseId);
  return index < 0 || index + 1 >= columns.length ? null : columns[index + 1]!.phase.id;
}
