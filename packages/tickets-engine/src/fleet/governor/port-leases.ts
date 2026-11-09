import type { PortRange } from '../protocol-governor';

/** A leased dev-server port. */
export interface PortLease {
  readonly port: number;
  readonly worktree: string;
  readonly runId: string;
  readonly ticket: string;
}

/** Worktree paths compare without case and slash direction (Windows). */
function keyOf(worktree: string): string {
  return worktree.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();
}

/**
 * One dev-server port per worktree (req-180): the lowest free port of the
 * range; a worktree that holds one keeps it for its next run. A settled
 * run gives it back.
 */
export class PortLeases {
  private readonly byKey = new Map<string, PortLease>();

  constructor(private readonly range: PortRange) {}

  /** The worktree's port, or null when the range is used up. */
  lease(worktree: string, runId: string, ticket: string): number | null {
    const key = keyOf(worktree);
    const held = this.byKey.get(key);
    if (held !== undefined) {
      this.byKey.set(key, { ...held, runId, ticket });
      return held.port;
    }
    const taken = new Set([...this.byKey.values()].map((lease) => lease.port));
    for (let port = this.range.from; port <= this.range.to; port++) {
      if (!taken.has(port)) {
        this.byKey.set(key, { port, worktree, runId, ticket });
        return port;
      }
    }
    return null;
  }

  /** A restart's live run keeps the port its record names; false when another worktree holds it. */
  seed(lease: PortLease): boolean {
    const own = keyOf(lease.worktree);
    const clash = [...this.byKey.entries()].some(([key, held]) => held.port === lease.port && key !== own);
    if (clash) {
      return false;
    }
    this.byKey.set(own, lease);
    return true;
  }

  /** The run's port goes back; the returned lease, or null when it held none. */
  returnFor(runId: string): PortLease | null {
    for (const [key, lease] of this.byKey) {
      if (lease.runId === runId) {
        this.byKey.delete(key);
        return lease;
      }
    }
    return null;
  }

  list(): readonly PortLease[] {
    return [...this.byKey.values()].sort((a, b) => a.port - b.port);
  }
}
