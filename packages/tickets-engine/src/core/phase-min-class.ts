import type { TicketIssue } from '../contracts/tickets';

/**
 * A phase's class floor (`min-class:` in pipeline.md, req-170): no run of
 * the phase asks the pool for a lighter class — plan and review not below
 * B in the stock pipeline. Tolerant: anything but A, B or C is ignored
 * visibly.
 */
export function phaseMinClassOf(raw: unknown, phaseId: string, issues: TicketIssue[]): 'A' | 'B' | 'C' | null {
  if (raw === undefined || raw === null || raw === '') {
    return null;
  }
  const value = typeof raw === 'string' ? raw.trim() : raw;
  if (value === 'A' || value === 'B' || value === 'C') {
    return value;
  }
  issues.push({ level: 'noise', message: `pipeline.md: ${phaseId}'s min-class must be A, B or C — ignored` });
  return null;
}
