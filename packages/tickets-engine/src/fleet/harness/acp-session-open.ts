import type { AcpResumeMethod } from './acp-harness';
import { sessionMcpServers } from './acp-mcp';
import { sessionOfferOf, type AcpSessionOffer } from './acp-session-offer';
import { acpEmit, acpText, type AcpContext } from './acp-state';
import type { AcpTurns } from './acp-turns';
import type { AcpMcpServer } from './contract';

/** How long a replayed history may keep streaming before the updates count again. */
const REPLAY_SETTLE_MS = 300;

/** The resume methods the agent can take, in the harness's order: `resume` only when `initialize` advertised it. */
export function resumeMethodsOf(order: readonly AcpResumeMethod[], agentCapabilities: Readonly<Record<string, unknown>>): AcpResumeMethod[] {
  const session = agentCapabilities['sessionCapabilities'];
  const canResume = typeof session === 'object' && session !== null && (session as Record<string, unknown>)['resume'] !== undefined;
  return order.filter((m) => m === 'load' || canResume);
}

/**
 * Opens an ACP worker's session (req-182): `initialize` with what the
 * harness advertises, then `session/new` — or, to resume, `session/resume`
 * when the agent offers it (no replay) and else `session/load` (the history
 * replays as updates, which are not this run's). A resume that cannot be
 * established is reported once and ends the worker; the supervisor
 * respawns fresh. The vault MCP (req-167) rides every one of these as
 * `mcpServers` when the agent offers HTTP MCP.
 */
export class AcpSessionOpener {
  constructor(
    private readonly ctx: AcpContext,
    private readonly turns: AcpTurns,
  ) {}

  /** The session's offer; null = the resume failed and was reported. */
  async open(): Promise<AcpSessionOffer | null> {
    const { acp, harness, start, state } = this.ctx;
    const init = await acp.result('initialize', { protocolVersion: 1, clientCapabilities: harness.clientCapabilities });
    const capabilities = (init['agentCapabilities'] ?? {}) as Record<string, unknown>;
    const mcp = sessionMcpServers(start.mcp, capabilities, harness.agent);
    if (mcp.note !== null) {
      acpEmit(this.ctx)({ kind: 'note', detail: 'runner', text: mcp.note });
    }
    if (start.resumeRef === null) {
      const opened = await acp.result('session/new', { cwd: start.cwd, mcpServers: mcp.servers });
      state.sessionId = acpText(opened['sessionId']);
      return sessionOfferOf(opened);
    }
    const methods = resumeMethodsOf(harness.resume, capabilities);
    if (methods.length === 0) {
      return this.resumeFailed(`${harness.agent} offers no way to resume a session`);
    }
    return this.resume(methods[0]!, start.resumeRef, mcp.servers);
  }

  private async resume(method: AcpResumeMethod, sessionId: string, mcpServers: readonly AcpMcpServer[]): Promise<AcpSessionOffer | null> {
    const { acp, start, state } = this.ctx;
    state.replaying = method === 'load';
    let reply: Record<string, unknown>;
    try {
      reply = await acp.result(`session/${method}`, { sessionId, cwd: start.cwd, mcpServers });
    } catch (error) {
      state.replaying = false;
      return this.resumeFailed(error instanceof Error ? error.message : String(error));
    }
    if (method === 'load') {
      await new Promise((resolve) => setTimeout(resolve, REPLAY_SETTLE_MS)); // the history replays as updates
    }
    state.replaying = false;
    state.sessionId = sessionId;
    await this.turns.skipEarlierUsage(sessionId);
    return sessionOfferOf(reply);
  }

  private resumeFailed(reason: string): null {
    this.ctx.start.onResumeFailed?.(reason);
    this.ctx.state.initDone = true;
    this.ctx.finish();
    return null;
  }
}
