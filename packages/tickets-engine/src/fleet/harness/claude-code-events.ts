/**
 * Claude Code's stream-json messages as normalized events (ADR-0075): the
 * transcript (thinking, replies, tool calls, tool results), the per-call
 * usage, the turn's end and — since req-176 — the quota windows of the
 * `rate_limit_event` the CLI writes after each assistant turn.
 */
import { parseShapedQuestion } from '../../contracts/question-shape';
import type { RunUsage } from '../protocol';
import type { NormalizedEvent, RateLimitReading, RateLimitWindow } from './contract';
import { activityLine, blockedOf, editChanges, questionOf, RESULT_PREFIX, THINK_MAX, THINK_PREFIX, toolActivity } from './event-text';
import type { ClaudeUsage, StreamJsonMessage, StreamJsonPart, StreamJsonWindow } from './stream-json-codec';

type Event = Omit<NormalizedEvent, 'ts'>;

/** A tool's outcome under its call: the first line of what it returned. */
export function toolResultEvents(message: StreamJsonMessage): Event[] {
  const events: Event[] = [];
  for (const part of message.message?.content ?? []) {
    if (part.type !== 'tool_result') {
      continue;
    }
    const first = activityLine(typeof part.content === 'string' ? part.content : '');
    if (first !== '' || part.is_error === true) {
      events.push({ kind: 'note', text: `${RESULT_PREFIX}${part.is_error === true ? 'failed: ' : ''}${first}` });
    }
  }
  return events;
}

/** The call's own usage: the input side is the context right now; the per-turn copy feeds the telemetry. */
function callUsage(usage: ClaudeUsage | undefined): Event | null {
  if (usage === undefined) {
    return null;
  }
  const contextTokens = (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
  const turnUsage: RunUsage = { input: usage.input_tokens ?? null, cacheRead: usage.cache_read_input_tokens ?? null, cacheCreation: usage.cache_creation_input_tokens ?? null, output: usage.output_tokens ?? null };
  return { kind: 'usage', contextTokens, turnUsage };
}

/** One content part as the transcript shows it: the event and the activity it sets, or null for a part it skips. */
function partEvent(part: StreamJsonPart): { event: Event; activity: string | null } | null {
  const thinking = (part.thinking ?? '').trim();
  const text = part.text ?? '';
  if (part.type === 'thinking' && thinking !== '') {
    return { event: { kind: 'note', text: `${THINK_PREFIX}${thinking.slice(0, THINK_MAX)}` }, activity: null };
  }
  if (part.type === 'text' && text.trim() !== '') {
    return { event: { kind: 'text', text: text.slice(0, 8_000) }, activity: activityLine(text) };
  }
  if (part.type !== 'tool_use') {
    return null;
  }
  const activity = toolActivity(part.name, part.input);
  const changes = editChanges(part.name, part.input);
  return { event: { kind: 'note', text: activity, ...(changes !== null ? { changes } : {}), ...(part.name !== undefined ? { tool: part.name } : {}) }, activity };
}

/** One assistant message: thinking, replies and every tool call, then the call's usage with the last activity. */
export function assistantEvents(message: StreamJsonMessage): Event[] {
  const events: Event[] = [];
  let activity = '';
  for (const part of message.message?.content ?? []) {
    const shown = partEvent(part);
    if (shown !== null) {
      events.push(shown.event);
      activity = shown.activity ?? activity;
    }
  }
  const usage = callUsage(message.message?.usage);
  if (usage !== null || activity !== '') {
    events.push({ kind: 'usage', ...(usage ?? {}), ...(activity !== '' ? { activity } : {}) });
  }
  return events;
}

/** The result event's cumulative usage (input counts cache reads) and the CLI's own cost. */
function totalsOf(message: StreamJsonMessage): Event {
  const usage: ClaudeUsage = message.usage ?? message.message?.usage ?? {};
  const cacheReadTokens = usage.cache_read_input_tokens ?? 0;
  const cost = typeof message.total_cost_usd === 'number' ? { costUsd: message.total_cost_usd } : {};
  return { kind: 'usage', tokensIn: (usage.input_tokens ?? 0) + cacheReadTokens, tokensOut: usage.output_tokens ?? 0, cacheReadTokens, ...cost };
}

/** How a turn ended: failed (no completion), a question to the owner (it stands), or done. */
export type TurnEnd = { readonly kind: 'failed' | 'question' | 'done'; readonly events: readonly Event[] };

/** The result event: the run's cumulative usage, and how the turn ended. */
export function turnEnd(message: StreamJsonMessage): TurnEnd {
  const totals = totalsOf(message);
  const result = message.result ?? '';
  // A failed turn (usage limit, auth, max turns) is no completion declaration — it used to count as "done".
  if (message.is_error === true || (message.subtype ?? '').startsWith('error')) {
    const error: Event = { kind: 'error', text: `${message.subtype ?? 'error'}: ${(message.result ?? 'the turn failed').slice(0, 300)}` };
    return { kind: 'failed', events: [totals, error, { kind: 'usage', turn: 'idle' }] };
  }
  const question = questionOf(result);
  if (question !== null) {
    const shaped = parseShapedQuestion(question);
    const waiting: Event = { kind: 'usage', turn: 'idle', waiting: { kind: 'question', text: question, ...(shaped !== null ? { shaped } : {}) } };
    return { kind: 'question', events: [totals, waiting] };
  }
  return { kind: 'done', events: [{ ...totals, kind: 'result', text: result.slice(0, 8_000), blocked: blockedOf(result) }, { kind: 'usage', turn: 'idle' }] };
}

function windowOf(raw: StreamJsonWindow | undefined): RateLimitWindow | null {
  if (raw === undefined) {
    return null;
  }
  const status = raw.status === 'allowed' || raw.status === 'allowed_warning' || raw.status === 'rejected' ? raw.status : null;
  return {
    utilization: typeof raw.utilization === 'number' ? raw.utilization : null,
    resetsAt: typeof raw.resetsAt === 'number' ? new Date(raw.resetsAt * 1000).toISOString() : null,
    status,
  };
}

/** The quota windows after a turn (`rate_limit_info.unifiedWindows`), or null when the event carries none. */
export function rateLimitEvent(message: StreamJsonMessage): Event | null {
  const windows = message.rate_limit_info?.unifiedWindows;
  const rateLimit: RateLimitReading = { fiveHour: windowOf(windows?.five_hour), sevenDay: windowOf(windows?.seven_day) };
  return rateLimit.fiveHour === null && rateLimit.sevenDay === null ? null : { kind: 'usage', rateLimit };
}
