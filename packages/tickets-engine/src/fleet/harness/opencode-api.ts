/**
 * The OpenCode v2 server API the adapter speaks (pinned by the owner's
 * spike against v2.0.32): the server prints `server password <token>` on
 * stdout, every request carries HTTP BASIC auth (`opencode:<token>`),
 * responses wrap in `{data}`, and a turn ends with an `idle` message in the
 * list. The shapes are truncated to what the adapter reads.
 */
import type { PermissionMode } from '../protocol';
import type { UsageTotals } from './contract';

export interface OcUsage {
  readonly input?: number;
  readonly output?: number;
  readonly cache?: { readonly read?: number; readonly write?: number };
}

export interface OcContentPart {
  readonly type?: string;
  readonly text?: string;
  /** A `tool` part: the call's id, the tool's name and its input. */
  readonly id?: string;
  readonly name?: string;
  readonly state?: { readonly input?: Readonly<Record<string, unknown>> };
}

/** One message-list item — FLAT in v2 (no v1-style `info` wrapper). */
export interface OcMessage {
  readonly id?: string;
  readonly type?: string;
  readonly content?: ReadonlyArray<OcContentPart>;
  readonly tokens?: OcUsage;
  readonly cost?: number;
  readonly time?: { readonly created?: number; readonly completed?: number };
  /** The idle marker's verdict on the turn: `succeeded`, `interrupted`, `failed`. */
  readonly outcome?: string;
  /** Why a turn failed — the provider's refusal (`provider.quota`, 429, …). */
  readonly error?: { readonly type?: string; readonly message?: string; readonly status?: number };
}

/** One SSE event of `GET /api/event` (T-0051): `session.text.*`, `session.tool.*`, `session.step.*`, `session.usage.updated`. */
export interface OcServerEvent {
  readonly type?: string;
  readonly data?: {
    readonly sessionID?: string;
    readonly assistantMessageID?: string;
    readonly ordinal?: number;
    readonly id?: string;
    readonly name?: string;
    readonly text?: string;
    readonly delta?: string;
    readonly input?: Readonly<Record<string, unknown>>;
    readonly content?: ReadonlyArray<{ readonly type?: string; readonly text?: string }>;
    readonly tokens?: OcUsage;
    readonly cost?: number;
  };
}

export interface OcSession {
  readonly cost?: number;
  readonly tokens?: OcUsage;
}

/** One pending permission request (v2 `Permission.Request`, req-64). */
export interface OcPermissionRequest {
  readonly id?: string;
  readonly action?: string;
  readonly resources?: readonly string[];
  readonly message?: string;
}

/** One model-catalog entry — v2's `Model.Info` (`limit.context` is the window). */
export interface OcModel {
  readonly id?: string;
  readonly modelID?: string;
  readonly providerID?: string;
  readonly limit?: { readonly context?: number };
}

export const OPENCODE_API = {
  info: '/api/info',
  createSession: '/api/session',
  session: (id: string): string => `/api/session/${id}`,
  prompt: (id: string): string => `/api/session/${id}/prompt`,
  messages: (id: string): string => `/api/session/${id}/message`,
  interrupt: (id: string): string => `/api/session/${id}/interrupt`,
  /** The server's SSE event stream (T-0051): `data:` lines, one `{id, type, data}` JSON object each. */
  event: '/api/event',
  /** The project's custom commands (`GET`, `{data: [{name, …}]}`). */
  commands: '/api/command',
  command: (id: string): string => `/api/session/${id}/command`,
  compact: (id: string): string => `/api/session/${id}/compact`,
  /** The session's pending permission requests (req-64). */
  permissions: (id: string): string => `/api/session/${id}/permission`,
  /** The answer to one (`POST {decision: once | always | reject}`, 204). */
  permissionReply: (id: string, requestId: string): string => `/api/session/${id}/permission/${encodeURIComponent(requestId)}/reply`,
  /** The session's pending forms — the `question` tool asks through one. */
  forms: (id: string): string => `/api/session/${id}/form`,
  /** The answer to one (`POST {answer: {q0: …}}`, 204). */
  formReply: (id: string, formId: string): string => `/api/session/${id}/form/${encodeURIComponent(formId)}/reply`,
  models: '/api/model',
  modelDefault: '/api/model/default',
} as const;

/** A dropped event subscription is retried after this long; polling covers the gap. */
export const EVENT_RETRY_MS = 2_000;

/** Live `text-delta` events are capped at this spacing per part (the seal carries the whole part). */
export const TEXT_DELTA_MIN_MS = 500;

/** The slash commands every OpenCode worker has besides the project's own. */
export const OPENCODE_BUILTIN_COMMANDS: readonly string[] = ['compact'];

/** How long a stop waits for the server's answer to the soft interrupt before it kills the tree. */
export const INTERRUPT_WAIT_MS = 3_000;

/** The poll's cadence: usage, the message list and the turn's end. */
export const POLL_MS = 2_000;

/** The prompt body with the model pin in the v2 shape (`providerID` + `modelID`, split once at the first slash). */
export function modelBody(model: string | null, text: string): { text: string; model?: { providerID: string; modelID: string } } {
  if (model === null || model.trim() === '') {
    return { text };
  }
  const slashAt = model.indexOf('/');
  if (slashAt === -1) {
    return { text, model: { providerID: '', modelID: model.trim() } };
  }
  return { text, model: { providerID: model.slice(0, slashAt).trim(), modelID: model.slice(slashAt + 1).trim() } };
}

/** req-183: the agent a prompt asks for — a read-only start runs opencode's built-in `plan` agent (edits denied); otherwise the default. */
export function agentBody(mode: PermissionMode): { agent?: string } {
  return mode === 'read-only' ? { agent: 'plan' } : {};
}

/** Drops a `#variant` suffix a pin or a catalog id may carry (`glm-5.3#fast`). */
export function stripVariant(id: string): string {
  const at = id.indexOf('#');
  return at === -1 ? id : id.slice(0, at);
}

/**
 * The inline config that caps the pinned model's window (req-80): OpenCode
 * auto-compacts against `limit.context`, and an override naming `context`
 * alone is dropped whole, so the output limit rides too.
 */
export function opencodeCapConfig(model: string | null, cap: number): string | null {
  if (model === null || !(cap > 0)) {
    return null;
  }
  const slashAt = model.indexOf('/');
  if (slashAt <= 0 || slashAt === model.length - 1) {
    return null;
  }
  const providerID = model.slice(0, slashAt).trim();
  const modelID = stripVariant(model.slice(slashAt + 1).trim());
  const limit = { context: Math.floor(cap), output: Math.min(32_000, Math.floor(cap / 4)) };
  return JSON.stringify({ provider: { [providerID]: { models: { [modelID]: { limit } } } } });
}

/** The error line of a turn the provider refused: type, status, message. */
export function providerErrorText(error: OcMessage['error']): string {
  const head = [error?.type ?? 'provider error', error?.status !== undefined ? String(error.status) : null].filter((part) => part !== null).join(' ');
  return `${head}: ${error?.message ?? 'the turn failed'}`.slice(0, 400);
}

/** The session's cumulative usage as the server reports it (input counts cache reads). */
export function sessionTotals(s: OcSession): UsageTotals {
  const cacheReadTokens = s.tokens?.cache?.read ?? 0;
  return { tokensIn: (s.tokens?.input ?? 0) + cacheReadTokens, tokensOut: s.tokens?.output ?? 0, cacheReadTokens, costUsd: s.cost ?? null };
}

/** Text of the message's `text` content parts, trimmed. */
export function messageText(m: OcMessage): string {
  return (m.content ?? [])
    .filter((part) => part.type === 'text')
    .map((part) => part.text ?? '')
    .join('\n')
    .trim();
}
