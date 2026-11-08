import type { RunDkTarget } from '../protocol';
import { RunLease, runOwnerId } from '../run-lease';
import type { StoreForTarget } from '../store/ticket-store';

/** What {@link LeftoverClaims.release} did. */
export interface LeftoverClaimsReport {
  readonly released: readonly string[];
  readonly skipped: readonly { readonly id: string; readonly reason: string }[];
}

/**
 * Gives up the claims no live run of this runner holds (E14-5b (4)): a
 * runner killed with a run in flight leaves its `agent-<run>@<host>` claim
 * on the ticket until the lease ends. Every ticket owned by an agent
 * identity of THIS host that no live run holds is released as that owner:
 * where it sat when dk takes that (R-31 write-back), else one stage back.
 * Never touches another host's claims or a human's.
 */
export class LeftoverClaims {
  constructor(
    private readonly storeFor: StoreForTarget,
    private readonly log: (message: string) => void,
  ) {}

  async release(target: RunDkTarget, retreatByStage: Readonly<Record<string, string | null>>, live: ReadonlySet<string>): Promise<LeftoverClaimsReport> {
    const store = this.storeFor(target);
    const released: string[] = [];
    const skipped: { id: string; reason: string }[] = [];
    const host = runOwnerId('x').slice('agent-x@'.length);
    for (const record of await store.list({})) {
      const owner = record.owner;
      if (owner === null || !owner.startsWith('agent-') || !owner.endsWith(`@${host}`) || live.has(record.id)) {
        continue;
      }
      const lease = new RunLease({ store, ticketId: record.id, actor: owner, runId: 'leftover', size: 'S', log: this.log, onLost: () => undefined });
      lease.preStage = record.stage;
      const result = await lease.release([record.stage, retreatByStage[record.stage] ?? null], 'the claim of a run that no longer exists, released', {
        restoreTo: record.stage,
      });
      if (result.ok) {
        released.push(record.id);
        this.log(`released the leftover claim of ${owner} on ${record.id} (now in ${result.stage})`);
      } else {
        skipped.push({ id: record.id, reason: result.error });
      }
    }
    return { released, skipped };
  }
}
