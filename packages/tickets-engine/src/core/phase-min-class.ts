import { classNameOf, type ClassName } from '../contracts/capability-class';
import type { TicketIssue } from '../contracts/tickets';

/**
 * A phase's class floor (`min-class:` in pipeline.md, req-170): no run of
 * the phase asks the pool for a lighter class — plan and review not below
 * standard in the stock pipeline. Tolerant: anything but a class name (or
 * an old letter A, B, C — req-287) is ignored visibly.
 */
export function phaseMinClassOf(raw: unknown, phaseId: string, issues: TicketIssue[]): ClassName | null {
  if (raw === undefined || raw === null || raw === '') {
    return null;
  }
  const name = classNameOf(raw);
  if (name !== null) {
    return name;
  }
  issues.push({ level: 'noise', message: `pipeline.md: ${phaseId}'s min-class must be a class name such as standard — ignored` });
  return null;
}
