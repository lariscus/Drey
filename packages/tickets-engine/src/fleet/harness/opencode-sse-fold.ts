import type { NormalizedEvent } from './contract';
import { activityLine, RESULT_PREFIX, toolActivity } from './event-text';
import { sessionTotals, TEXT_DELTA_MIN_MS, type OcServerEvent } from './opencode-api';
import { emitOf, type OpencodeContext } from './opencode-state';
import type { OpencodeUsage } from './opencode-usage';

type Data = NonNullable<OcServerEvent['data']>;

/**
 * The live half of an OpenCode turn (T-0051): what streams while a turn
 * generates — text parts as they grow (throttled; the seal brings the whole
 * part), every tool call as it starts and settles, the step's context and
 * the session's usage. The poll keeps the turn's end and what the
 * subscription missed.
 */
export class OpencodeSseFold {
  /** Final text parts per message id, sealed by `session.text.ended` (the poll does not repeat them). */
  readonly sealed = new Map<string, string[]>();
  /** Tool names by call id (`session.tool.success` reports no name). */
  private readonly toolNames = new Map<string, string>();
  /** When the last delta of a part was forwarded (the throttle). */
  private readonly deltaAt = new Map<string, number>();
  private readonly emit: (event: Omit<NormalizedEvent, 'ts'>) => void;

  constructor(
    private readonly ctx: OpencodeContext,
    private readonly usage: OpencodeUsage,
  ) {
    this.emit = emitOf(ctx);
  }

  /** One `data:` payload of the stream. */
  onEvent(raw: string): void {
    const { state } = this.ctx;
    if (raw === '' || !state.alive || state.sessionRef === null) {
      return;
    }
    let event: OcServerEvent;
    try {
      event = JSON.parse(raw) as OcServerEvent;
    } catch {
      return;
    }
    const data = event.data;
    if (data !== undefined && data.sessionID === state.sessionRef) {
      this.apply(event.type ?? '', data);
    }
  }

  private apply(type: string, data: Data): void {
    switch (type) {
      case 'session.text.delta':
        return this.delta(data);
      case 'session.text.ended':
        return this.textEnded(data);
      case 'session.tool.input.started':
        return this.toolStarted(data);
      case 'session.tool.called':
        return this.toolCalled(data);
      case 'session.tool.success':
      case 'session.tool.error':
        return this.toolSettled(data, type === 'session.tool.error');
      case 'session.step.started':
        return this.stepStarted();
      case 'session.step.ended':
        return this.stepEnded(data);
      case 'session.usage.updated':
        return this.usage.report(sessionTotals({ ...(data.tokens !== undefined ? { tokens: data.tokens } : {}), ...(data.cost !== undefined ? { cost: data.cost } : {}) }));
      default:
        return;
    }
  }

  private delta(data: Data): void {
    if (data.assistantMessageID === undefined || typeof data.delta !== 'string') {
      return;
    }
    const key = `${data.assistantMessageID}#${data.ordinal ?? 0}`;
    const at = this.ctx.now().getTime();
    const last = this.deltaAt.get(key);
    if (last !== undefined && at - last < TEXT_DELTA_MIN_MS) {
      return; // throttled — the seal brings the whole part
    }
    this.deltaAt.set(key, at);
    this.emit({ kind: 'text-delta', text: data.delta });
  }

  private textEnded(data: Data): void {
    if (data.assistantMessageID === undefined) {
      return;
    }
    const text = typeof data.text === 'string' ? data.text : '';
    this.sealed.set(data.assistantMessageID, [...(this.sealed.get(data.assistantMessageID) ?? []), text]);
    if (text.trim() !== '') {
      this.emit({ kind: 'text-delta', text, detail: 'end', activity: activityLine(text) });
    }
  }

  private toolStarted(data: Data): void {
    if (typeof data.id === 'string') {
      const name = typeof data.name === 'string' && data.name !== '' ? data.name : 'tool';
      this.toolNames.set(data.id, name);
      this.emit({ kind: 'tool', tool: name, detail: 'running', activity: name });
    }
  }

  private toolCalled(data: Data): void {
    if (typeof data.id !== 'string') {
      return;
    }
    const name = this.toolNames.get(data.id) ?? 'tool';
    this.ctx.state.seenTools.add(data.id); // the poll must not repeat this call as its own note
    const activity = toolActivity(name, data.input);
    this.emit({ kind: 'tool', tool: name, text: activity, activity });
  }

  private toolSettled(data: Data, failed: boolean): void {
    if (typeof data.id !== 'string') {
      return;
    }
    const name = this.toolNames.get(data.id) ?? 'tool';
    this.ctx.state.seenTools.add(data.id);
    const first = activityLine((data.content ?? []).map((part) => part.text ?? '').join('\n'));
    this.emit({ kind: 'tool', tool: name, detail: failed ? 'failed' : 'done', ...(first !== '' ? { text: `${RESULT_PREFIX}${failed ? 'failed: ' : ''}${first}` } : {}) });
  }

  private stepStarted(): void {
    if (this.ctx.state.turn !== 'busy') {
      this.ctx.state.turn = 'busy';
      this.emit({ kind: 'usage', turn: 'busy' });
    }
  }

  private stepEnded(data: Data): void {
    const contextTokens = (data.tokens?.input ?? 0) + (data.tokens?.cache?.read ?? 0);
    if (contextTokens > 0) {
      this.ctx.state.contextTokens = contextTokens;
      this.emit({ kind: 'usage', contextTokens });
    }
  }
}
