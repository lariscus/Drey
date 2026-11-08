import type { RunnerProcess } from '../procs';
import { LineBuffer, stderrLines } from './line-buffer';

/** One JSON-RPC 2.0 message as an ACP agent sends it. */
export interface RpcMessage {
  readonly id?: number | string;
  readonly method?: string;
  readonly params?: Record<string, unknown>;
  readonly result?: Record<string, unknown>;
  readonly error?: { readonly code?: number; readonly message?: string };
}

/** What the client hands on: the agent's requests, its notifications, and what it writes that is no JSON. */
export interface AcpHandlers {
  readonly onRequest: (message: RpcMessage) => void;
  readonly onNotification: (message: RpcMessage) => void;
  readonly onNoise: (line: string, stream: 'stdout' | 'stderr') => void;
}

/**
 * The Agent Client Protocol over an agent's stdio (ADR-0096: ACP is the
 * target adapter protocol): newline-delimited JSON-RPC 2.0 — calls that
 * resolve with the reply, notifications, replies to the agent's own
 * requests. A process exit answers every open call with an error.
 */
export class AcpClient {
  private readonly lines = new LineBuffer();
  private readonly calls = new Map<number | string, (reply: RpcMessage) => void>();
  private nextId = 1;

  constructor(
    private readonly proc: RunnerProcess,
    private readonly handlers: AcpHandlers,
  ) {
    proc.onStdout((chunk) => this.lines.feed(chunk).forEach((line) => this.read(line)));
    proc.onStderr((chunk) => stderrLines(chunk).forEach((line) => handlers.onNoise(line, 'stderr')));
    proc.onExit((code) => {
      for (const resolve of this.calls.values()) {
        resolve({ error: { message: `kimi exited (${code ?? 'signal'})` } });
      }
      this.calls.clear();
    });
  }

  /** A call to the agent; resolves with its reply (an `error` reply included). */
  call(method: string, params: Record<string, unknown>): Promise<RpcMessage> {
    return new Promise((resolve) => {
      const id = this.nextId++;
      this.calls.set(id, resolve);
      this.send({ id, method, params });
    });
  }

  /** A call whose reply must be a result: throws with the agent's error message otherwise. */
  async result(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const reply = await this.call(method, params);
    if (reply.error !== undefined) {
      throw new Error(reply.error.message ?? `error ${reply.error.code ?? ''}`);
    }
    return reply.result ?? {};
  }

  notify(method: string, params: Record<string, unknown>): void {
    this.send({ method, params });
  }

  /** The reply to one of the agent's own requests. */
  reply(id: number | string, body: { readonly result: Record<string, unknown> } | { readonly error: { readonly code: number; readonly message: string } }): void {
    this.send({ id, ...body });
  }

  private send(message: Record<string, unknown>): void {
    this.proc.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  }

  private read(line: string): void {
    let message: RpcMessage;
    try {
      message = JSON.parse(line) as RpcMessage;
    } catch {
      this.handlers.onNoise(line.slice(0, 400), 'stdout');
      return;
    }
    if (message.method !== undefined && message.id !== undefined) {
      this.handlers.onRequest(message);
    } else if (message.method !== undefined) {
      this.handlers.onNotification(message);
    } else if (message.id !== undefined) {
      const resolve = this.calls.get(message.id);
      this.calls.delete(message.id);
      resolve?.(message);
    }
  }
}
