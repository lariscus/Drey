import type { NormalizedEvent } from './contract';
import { activityLine, editChanges, RESULT_PREFIX, THINK_MAX, THINK_PREFIX, toolActivity } from './event-text';
import { acpEmit, acpText, type AcpContext } from './acp-state';

/** A tool's output: Kimi's `rawOutput` text, else the first text content (opencode). */
function outputOf(update: Record<string, unknown>): string {
  const raw = update['rawOutput'];
  if (typeof raw === 'string') {
    return raw;
  }
  const content = update['content'] as ReadonlyArray<{ content?: { text?: unknown } }> | undefined;
  return acpText(content?.[0]?.content?.text);
}

/**
 * An ACP agent's `session/update` notifications as the run's transcript
 * (E10-8, req-182): message and thought chunks gathered until a tool call or
 * the turn's end, each tool call noted once its arguments are known (they
 * stream in after the first `tool_call`), its result under it, the context
 * size, the session's cumulative cost when the agent reports one (opencode's
 * `usage_update`) and the slash commands.
 */
export class AcpUpdateFold {
  private text = '';
  private thought = '';
  private toolNames = new Map<string, string>();
  private readonly toolArgs = new Map<string, Record<string, unknown>>();
  private readonly noted = new Set<string>();
  private readonly emit: (event: Omit<NormalizedEvent, 'ts'>) => void;

  constructor(private readonly ctx: Pick<AcpContext, 'start' | 'now' | 'state'>) {
    this.emit = acpEmit(ctx);
  }

  /** A new turn: its own text, its own tool names. */
  resetTurn(): void {
    this.text = '';
    this.toolNames = new Map();
  }

  /** The turn's answer so far: the message text after its last tool call. */
  get answer(): string {
    return this.text.trim();
  }

  argsOf(toolCallId: string): Record<string, unknown> | undefined {
    return this.toolArgs.get(toolCallId);
  }

  onUpdate(update: Record<string, unknown>): void {
    const content = update['content'] as { type?: string; text?: string } | undefined;
    switch (acpText(update['sessionUpdate'])) {
      case 'agent_message_chunk':
        this.text += acpText(content?.text);
        return;
      case 'agent_thought_chunk':
        this.thought += acpText(content?.text);
        return;
      case 'tool_call':
        this.flushThought();
        this.flushText();
        return this.toolCall(update);
      case 'tool_call_update':
        return this.toolUpdate(update);
      case 'usage_update':
        return this.usage(update);
      case 'available_commands_update':
        return this.commands(update);
      default:
        return;
    }
  }

  /** The message text before a tool call is a progress line. */
  flushText(): void {
    const t = this.text.trim();
    if (t !== '') {
      this.emit({ kind: 'text', text: t.slice(0, 8_000) });
    }
    this.text = '';
  }

  flushThought(): void {
    const t = this.thought.trim();
    this.thought = '';
    if (t !== '') {
      this.emit({ kind: 'note', text: `${THINK_PREFIX}${t.slice(0, THINK_MAX)}` });
    }
  }

  private toolCall(update: Record<string, unknown>): void {
    const id = acpText(update['toolCallId']);
    const content = update['content'] as ReadonlyArray<{ content?: { text?: string } }> | undefined;
    this.keepRawInput(id, update);
    // The first call's content wins over its raw input: it carries the arguments as the agent sent them.
    try {
      const parsed: unknown = JSON.parse(content?.[0]?.content?.text ?? '{}');
      this.toolArgs.set(id, typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {});
    } catch {
      this.toolArgs.set(id, {});
    }
    this.toolNames.set(id, acpText(update['title']));
  }

  private toolUpdate(update: Record<string, unknown>): void {
    const id = acpText(update['toolCallId']);
    this.keepRawInput(id, update);
    const status = acpText(update['status']);
    if (status === 'in_progress' && Object.keys(this.toolArgs.get(id) ?? {}).length > 0) {
      this.note(id);
    }
    if (status === 'completed' || status === 'failed') {
      this.note(id);
      const out = activityLine(outputOf(update));
      if (out !== '' || status === 'failed') {
        this.emit({ kind: 'note', text: `${RESULT_PREFIX}${status === 'failed' ? 'failed: ' : ''}${out}` });
      }
    }
  }

  private keepRawInput(id: string, update: Record<string, unknown>): void {
    const raw = update['rawInput'];
    if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
      this.toolArgs.set(id, raw as Record<string, unknown>);
    }
  }

  /** The call's note: once, when its arguments are known. */
  private note(id: string): void {
    if (this.noted.has(id)) {
      return;
    }
    this.noted.add(id);
    const title = this.toolNames.get(id) ?? 'tool';
    const input = this.toolArgs.get(id) ?? {};
    const activity = toolActivity(title, input);
    const changes = editChanges(title, input);
    this.emit({ kind: 'note', text: activity, ...(changes !== null ? { changes } : {}), tool: title });
    this.emit({ kind: 'usage', activity });
  }

  private usage(update: Record<string, unknown>): void {
    const used = update['used'];
    const size = update['size'];
    const cost = (update['cost'] as { amount?: unknown } | undefined)?.amount;
    if (typeof cost === 'number') {
      this.ctx.state.reportedCost = cost;
    }
    if (typeof used === 'number') {
      this.emit({ kind: 'usage', contextTokens: used, ...(typeof size === 'number' ? { contextWindow: size } : {}) });
    }
  }

  private commands(update: Record<string, unknown>): void {
    const cmds = update['availableCommands'];
    if (Array.isArray(cmds)) {
      this.emit({ kind: 'usage', commands: cmds.map((c: { name?: unknown }) => acpText(c.name)).filter((n) => n !== '') });
    }
  }
}
