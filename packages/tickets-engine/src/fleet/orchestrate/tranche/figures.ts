import type { RedTicket } from '../../protocol';
import type { RunFact } from './tranche-record';

/** The median of the figures; null for none. An even count takes the mean of the middle two. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A run's change in lines (added + removed); null when the worktree was not read. */
export function changeOf(fact: RunFact): number | null {
  return fact.added === null || fact.removed === null ? null : fact.added + fact.removed;
}

/** Cents, so a report never shows a float's tail. */
export function dollars(value: number): number {
  return Math.round(value * 100) / 100;
}

/** The tranche's spend: the settled runs' costs. */
export function spentOf(facts: readonly RunFact[]): number {
  return dollars(facts.reduce((sum, fact) => sum + (fact.costUsd ?? 0), 0));
}

/** The facts that went through a gate. */
export function gated(facts: readonly RunFact[]): RunFact[] {
  return facts.filter((fact) => fact.gate !== null);
}

/** The red tickets among the facts, newest red first, each with its red count over `scope`. */
export function redTickets(facts: readonly RunFact[], scope: readonly RunFact[] = facts): RedTicket[] {
  const rows: RedTicket[] = [];
  for (const fact of [...facts].reverse()) {
    if (fact.gate !== 'red' || rows.some((row) => row.ticket === fact.ticket)) {
      continue;
    }
    const red = scope.filter((other) => other.ticket === fact.ticket && other.gate === 'red').length;
    rows.push({ ticket: fact.ticket, phase: fact.phase, persona: fact.persona, red });
  }
  return rows;
}
