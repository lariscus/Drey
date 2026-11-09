import type { EventSink, RunnerEvent } from '../ports/event-sink';
import type { RunInfo } from '../protocol';
import type { SessionCost, SessionRecords } from './ledgers';

/**
 * The session records the ledgers sum over (req-170, ADR-0081): every run
 * record the runner found at its start and every record it persisted since,
 * the latest version of each. It listens on the runner's events like the
 * slots do, so the ledgers never reach into the supervisors.
 */
export class SessionBook implements EventSink, SessionRecords {
  private readonly byId = new Map<string, SessionCost>();

  seed(records: readonly RunInfo[]): void {
    for (const info of records) {
      this.byId.set(info.id, info);
    }
  }

  publish(event: RunnerEvent): void {
    if (event.kind === 'run') {
      this.byId.set(event.info.id, event.info);
    }
  }

  all(): readonly SessionCost[] {
    return [...this.byId.values()];
  }
}
