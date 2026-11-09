/**
 * The vault a worker is handed (req-167, ADR-0094), as the spawn path asks
 * for it: Drey Service mints the worker's token, writes what the harness
 * reads and logs every call to the run's stream; the supervisor only opens
 * the access before the spawn and closes it when the worker exits. Types
 * only — the composition root hands in the service's gate.
 */
import type { NormalizedEvent, WorkerMcpLaunch, WorkerMcpServer } from '../harness/contract';

/** Whose access is opened, and where its calls are logged. */
export interface VaultGrantRequest {
  readonly runId: string;
  readonly ticketId: string;
  /** The persona whose `allowed: write-vaults` decides (R5); null = it writes no vault. */
  readonly persona: string | null;
  /** A read-only run (a review, req-183) writes no vault, whatever its persona may. */
  readonly readOnly: boolean;
  /** The run's own folder: a harness's config file lands here, never in the worktree. */
  readonly runDir: string;
  /** The harness's name, for the one stream line when it takes no MCP. */
  readonly harness: string;
  /** Every vault call, and the line about a missing vault, land on the run's stream. */
  readonly emit: (event: NormalizedEvent) => void;
}

/** One worker's open access. */
export interface WorkerVaultAccess {
  readonly launch: WorkerMcpLaunch;
  /** The worker is gone: its token dies and its config files go. */
  close(): void;
}

export interface WorkerVaultGate {
  /**
   * Opens one worker's access. `describe` is the adapter's `mcpLaunch`; null
   * = the harness takes no MCP, and the gate says so on the stream. Null back
   * = no vault for this worker (none described, or the service serves no
   * vault MCP right now).
   */
  open(request: VaultGrantRequest, describe: ((server: WorkerMcpServer) => WorkerMcpLaunch) | null): WorkerVaultAccess | null;
}
