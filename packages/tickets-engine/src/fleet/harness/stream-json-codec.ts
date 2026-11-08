import { LineBuffer } from './line-buffer';

/** A model call's usage as Claude Code reports it. */
export interface ClaudeUsage {
  readonly input_tokens?: number;
  readonly cache_read_input_tokens?: number;
  readonly cache_creation_input_tokens?: number;
  readonly output_tokens?: number;
}

/** One content part of an assistant or user message. */
export interface StreamJsonPart {
  readonly type?: string;
  readonly name?: string;
  readonly text?: string;
  readonly thinking?: string;
  readonly input?: Record<string, unknown>;
  readonly content?: unknown;
  readonly is_error?: boolean;
}

/** One quota window of a `rate_limit_event` (spike 4, CLI 2.1.318). */
export interface StreamJsonWindow {
  readonly utilization?: number;
  /** Epoch seconds. */
  readonly resetsAt?: number;
  readonly status?: string;
}

/** One line of Claude Code's stream-json output, the fields the adapter reads. */
export interface StreamJsonMessage {
  readonly type?: string;
  readonly subtype?: string;
  readonly session_id?: string;
  readonly slash_commands?: unknown[];
  readonly message?: { readonly usage?: ClaudeUsage; readonly content?: readonly StreamJsonPart[] };
  readonly usage?: ClaudeUsage;
  readonly total_cost_usd?: number;
  readonly result?: string;
  readonly is_error?: boolean;
  readonly rate_limit_info?: { readonly unifiedWindows?: { readonly five_hour?: StreamJsonWindow; readonly seven_day?: StreamJsonWindow } };
}

/** A decoded line: a message, or text the CLI wrote that is no JSON. */
export type StreamJsonLine = { readonly message: StreamJsonMessage } | { readonly garbage: string };

/**
 * Claude Code's stream-json over stdio (`--input-format stream-json
 * --output-format stream-json`): the output decoded line by line, the input
 * encoded as user messages and the SDK's own control requests.
 */
export class StreamJsonCodec {
  private readonly lines = new LineBuffer();

  decode(chunk: string): StreamJsonLine[] {
    return this.lines.feed(chunk).map((line) => {
      try {
        return { message: JSON.parse(line) as StreamJsonMessage };
      } catch {
        return { garbage: line };
      }
    });
  }

  userMessage(text: string): string {
    return `${JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } })}\n`;
  }

  /** The control request the Claude SDK sends for its own interrupt: the turn stops, session and process stay. */
  interrupt(requestId: string): string {
    return `${JSON.stringify({ type: 'control_request', request_id: requestId, request: { subtype: 'interrupt' } })}\n`;
  }
}
