import { usageSince, ZERO_USAGE, type UsageTotals } from './contract';
import { OPENCODE_API, sessionTotals, type OcSession } from './opencode-api';
import { emitOf, type OpencodeContext } from './opencode-state';

/**
 * The run's own spend on an OpenCode session (req-53): the server's totals
 * are cumulative per session, so a resumed run reports them minus what the
 * session had spent before it.
 */
export class OpencodeUsage {
  constructor(private readonly ctx: OpencodeContext) {}

  /** Emits the run's own usage (totals minus base) when any number moved. */
  report(total: UsageTotals): void {
    const state = this.ctx.state;
    if (state.usageBase === null) {
      return;
    }
    const own = usageSince(total, state.usageBase);
    if (own.tokensIn === state.tokensIn && own.tokensOut === state.tokensOut && own.cacheReadTokens === state.cacheReadTokens && own.costUsd === state.costUsd) {
      return;
    }
    state.tokensIn = own.tokensIn;
    state.tokensOut = own.tokensOut;
    state.cacheReadTokens = own.cacheReadTokens;
    state.costUsd = own.costUsd;
    emitOf(this.ctx)({ kind: 'usage', tokensIn: own.tokensIn, tokensOut: own.tokensOut, cacheReadTokens: own.cacheReadTokens, ...(own.costUsd !== null ? { costUsd: own.costUsd } : {}) });
  }

  /** A resumed session's spend before this run; unreadable = zero, said in the stream. */
  async readBase(): Promise<void> {
    const { state, client } = this.ctx;
    if (state.usageBase !== null || state.sessionRef === null) {
      return;
    }
    let base: UsageTotals | null = null;
    try {
      const res = await client.get(OPENCODE_API.session(state.sessionRef));
      if (res.ok) {
        const s = await client.data<OcSession>(res);
        base = s === undefined ? null : sessionTotals(s);
      }
    } catch {
      // reported below
    }
    if (base === null) {
      emitOf(this.ctx)({ kind: 'note', text: "the resumed session's earlier usage could not be read — this run's token counts include it" });
    }
    state.usageBase = base ?? ZERO_USAGE;
    this.ctx.start.onUsageBase?.(state.usageBase);
  }
}
