/**
 * The workers' bearer tokens (req-167, ADR-0094): one per worker, minted at
 * its spawn, dead when it exits. The store keeps only the token's hash beside
 * whose it is — the plain token goes into the worker's MCP configuration and
 * nowhere else; it never reaches a ticket file, the run record or a log. A
 * second token kind beside the gateway's device tokens, which stay the
 * phones'. In memory only: a worker never outlives its service (no harness
 * attaches since req-182), so nothing needs to survive a restart.
 */
import type { NormalizedEvent } from '../../fleet/harness/contract';
import type { PersonaRecordsGrant, VaultScope } from '../../fleet/runner/worker-vault';
import { RecordQuota } from './record-quota';
import { StaleWriteGuard } from './stale-writes';

/** Random token and its hash: crypto is an adapter ({@link NodeTokenCrypto}). */
export interface TokenCrypto {
  token(): string;
  hash(token: string): string;
}

/** Whose a token is. */
export interface VaultGrant {
  readonly runId: string;
  readonly ticketId: string;
  readonly persona: string | null;
  readonly readOnly: boolean;
  /** req-283: the project whose vaults and folders the token reaches (a 1:1: every project's). */
  readonly scope: VaultScope;
  /**
   * The vault tools this worker is offered and may call (a 1:1: the read
   * cut, req-217); absent = every tool the service serves workers. A second
   * line behind `readOnly`, which already refuses every change.
   */
  readonly tools?: readonly string[];
  /** req-226: present = the persona may write its memory line and journal note, once each. */
  readonly records?: PersonaRecordsGrant;
  /** The run's stream: every call is audited there. */
  readonly emit: (event: NormalizedEvent) => void;
}

/** One live token's session: its grant and what its worker has read. */
export interface TokenSession {
  readonly grant: VaultGrant;
  readonly reads: StaleWriteGuard;
  /** req-226: the persona writes this worker has left. */
  readonly quota: RecordQuota;
}

export class RunTokens {
  private readonly sessions = new Map<string, TokenSession>();

  constructor(private readonly crypto: TokenCrypto) {}

  mint(grant: VaultGrant): string {
    const token = this.crypto.token();
    this.sessions.set(this.crypto.hash(token), { grant, reads: new StaleWriteGuard(), quota: new RecordQuota() });
    return token;
  }

  /** The session of a live token; null for an unknown or revoked one. */
  resolve(token: string): TokenSession | null {
    return token === '' ? null : (this.sessions.get(this.crypto.hash(token)) ?? null);
  }

  revoke(token: string): void {
    this.sessions.delete(this.crypto.hash(token));
  }

  get live(): number {
    return this.sessions.size;
  }
}
