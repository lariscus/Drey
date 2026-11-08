import type { NormalizedEvent } from './contract';
import { blockedOf, permissionText } from './event-text';
import { OPENCODE_API, POLL_MS, sessionTotals, type OcMessage, type OcPermissionRequest, type OcSession } from './opencode-api';
import type { OpencodeMessageWalk } from './opencode-message-walk';
import { emitOf, type OpencodeContext } from './opencode-state';
import type { OpencodeUsage } from './opencode-usage';
import { formQuestions, formText, type OcForm } from './question-forms';

/**
 * The poll of an OpenCode worker (every 2 s): the session's usage, the
 * message list (the `idle` marker is the one authoritative "turn is over"),
 * a pending permission request or question form as the run's wait, and the
 * turn's result. An attached worker has no process exit to tell its end:
 * three failed rounds in a row mean its server is gone.
 */
export class OpencodePoller {
  private timer: ReturnType<typeof setInterval> | null = null;
  private failures = 0;
  private readonly emit: (event: Omit<NormalizedEvent, 'ts'>) => void;

  constructor(
    private readonly ctx: OpencodeContext,
    private readonly parts: { readonly usage: OpencodeUsage; readonly walk: OpencodeMessageWalk; readonly attached: boolean; readonly gone: () => void },
  ) {
    this.emit = emitOf(ctx);
  }

  start(): void {
    this.timer = setInterval(() => void this.round(), POLL_MS);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** One poll round: cumulative usage + stream text + the turn's end. */
  async round(): Promise<void> {
    const { state, client } = this.ctx;
    if (!state.alive || state.sessionRef === null || !client.bound || state.turnDone || state.usageBase === null) {
      return;
    }
    try {
      const sessionRef = state.sessionRef;
      await this.usage(sessionRef);
      const list = await client.get(OPENCODE_API.messages(sessionRef));
      if (list.ok) {
        this.parts.walk.walk((await client.data<OcMessage[]>(list)) ?? []);
      }
      await this.permissions(sessionRef);
      await this.forms(sessionRef);
      this.endTurn();
      this.failures = 0;
    } catch {
      // A dropped round is noise, the next catches up — unless the worker is attached: three in a row = its server is gone.
      this.failures++;
      if (this.parts.attached && this.failures >= 3) {
        this.parts.gone();
      }
    }
  }

  private async usage(sessionRef: string): Promise<void> {
    const res = await this.ctx.client.get(OPENCODE_API.session(sessionRef));
    const s = res.ok ? await this.ctx.client.data<OcSession>(res) : undefined;
    if (s !== undefined) {
      this.parts.usage.report(sessionTotals(s));
    }
  }

  /** A tool call the server wants approved blocks the turn silently: the pending request becomes the run's wait (req-64). */
  private async permissions(sessionRef: string): Promise<void> {
    const { state, client } = this.ctx;
    const res = await client.get(OPENCODE_API.permissions(sessionRef)).catch(() => null);
    if (res === null || !res.ok) {
      return;
    }
    const first = ((await client.data<ReadonlyArray<OcPermissionRequest>>(res)) ?? []).find((r) => typeof r.id === 'string');
    if (first !== undefined && first.id !== state.permissionId) {
      state.permissionId = first.id!;
      this.emit({ kind: 'usage', waiting: { kind: 'permission', text: permissionText(first), requestId: first.id! } });
    } else if (first === undefined && state.permissionId !== null) {
      state.permissionId = null;
      this.emit({ kind: 'usage', waiting: null });
    }
  }

  /** The `question` tool asks through a form and blocks its call: the pending form becomes the run's wait, with its choices. */
  private async forms(sessionRef: string): Promise<void> {
    const { state, client } = this.ctx;
    const res = await client.get(OPENCODE_API.forms(sessionRef)).catch(() => null);
    if (res === null || !res.ok) {
      return;
    }
    const form = ((await client.data<readonly OcForm[]>(res)) ?? []).find((f) => typeof f.id === 'string' && (f.fields ?? []).length > 0);
    if (form !== undefined && form.id !== state.formId) {
      state.formId = form.id!;
      const questions = formQuestions(form);
      this.emit({ kind: 'usage', waiting: { kind: 'question', text: formText(questions), requestId: form.id!, questions } });
    } else if (form === undefined && state.formId !== null) {
      state.formId = null;
      this.emit({ kind: 'usage', waiting: null });
    }
  }

  /** The turn is over: the result, then the fleet owns the worker process. */
  private endTurn(): void {
    const { state } = this.ctx;
    if (!state.turnDone || state.ended) {
      return;
    }
    state.ended = true;
    this.emit({
      kind: 'result',
      text: state.lastText.slice(0, 8_000),
      blocked: blockedOf(state.lastText),
      tokensIn: state.tokensIn,
      tokensOut: state.tokensOut,
      cacheReadTokens: state.cacheReadTokens,
      ...(state.costUsd !== null ? { costUsd: state.costUsd } : {}),
    });
    void this.ctx.kill();
  }
}
