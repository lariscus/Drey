/**
 * The audit of ADR-0075, made real by req-167: every vault MCP call is one
 * `tool` event on the run's stream (`detail: 'audit'`) — tool, persona, vault
 * and path, allowed / refused / failed, how long — so the service window's
 * Sessions tab and Mission Control show it beside the worker's own lines. A
 * refusal also goes to the service log.
 */
import type { McpToolResult } from '../../../../../shared/vault-tools';
import type { VaultCallAudit } from '../../fleet/harness/contract';
import type { TokenSession } from './run-tokens';
import { targetLabel, type VaultCallTarget } from './vault-call-target';

/** The server's name in every harness: the model calls `mcp__drey__vault_read`. */
export const VAULT_MCP_NAME = 'drey';

const REFUSALS = [/ may not write vault "/, / since you read it /];
const MAX_TEXT = 240;

export interface VaultCallAuditorDeps {
  readonly now: () => Date;
  /** One line in the service log (the `mcp` component). */
  readonly log: (message: string, level?: 'info' | 'warn') => void;
}

/** One call as it is audited. */
export interface AuditedCall {
  readonly name: string;
  readonly target: VaultCallTarget;
  readonly result: McpToolResult;
  /** From {@link VaultCallAuditor.start}. */
  readonly timer: number;
}

export class VaultCallAuditor {
  constructor(private readonly deps: VaultCallAuditorDeps) {}

  /** The call's start, for its duration. */
  start(): number {
    return this.deps.now().getTime();
  }

  audit(session: TokenSession, call: AuditedCall): void {
    const ms = Math.max(0, this.deps.now().getTime() - call.timer);
    const text = call.result.content.map((block) => block.text).join('\n');
    const verdict: VaultCallAudit['verdict'] = call.result.isError !== true ? 'allowed' : REFUSALS.some((r) => r.test(text)) ? 'refused' : 'failed';
    const label = targetLabel(call.target);
    const outcome = verdict === 'allowed' ? '' : ` → ${text.split('\n')[0]!.slice(0, MAX_TEXT)}`;
    const { grant } = session;
    grant.emit({
      ts: this.deps.now().toISOString(),
      kind: 'tool',
      tool: `mcp__${VAULT_MCP_NAME}__${call.name}`,
      detail: 'audit',
      text: `vault › ${call.name} ${label}${outcome} · ${ms} ms`,
      audit: { persona: grant.persona, vault: call.target.vault, path: call.target.path, verdict, ms },
    });
    if (verdict === 'refused') {
      this.deps.log(`run ${grant.runId} (${grant.persona ?? 'no persona'}): ${call.name} ${label} refused${outcome}`, 'warn');
    }
  }
}
