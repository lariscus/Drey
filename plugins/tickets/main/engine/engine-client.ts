import type { EngineBoardService } from '../../../../packages/tickets-engine/src/services/board-service';
import type { ChatStreamEvent } from '../../../../packages/tickets-engine/src/contracts/chat';
import type { FleetClient } from '../../../../packages/tickets-engine/src/services/fleet-client';
import type { RemoteService } from '../../../../packages/tickets-engine/src/server/service';
import { UnconfiguredTicketsError } from './unconfigured-error';
import type { PathsEvent } from './path-announcer';

/**
 * The Drey plugin's client of the standalone tickets engine (ADR-0088,
 * E2b). One loopback channel: `POST /api/invoke {method, payload}` against
 * an explicit method allowlist, bearer-token only, plus the `/api/events`
 * SSE stream for live updates. The service proxies make the ~50 IPC
 * handlers read exactly as before — `board.createTicket(...)` forwards by
 * method name, so activate() keeps its shape.
 */

export interface EngineEndpoints {
  readonly invokeUrl: string;
  readonly token: string;
}

export class EngineError extends Error {}

/**
 * One streamed unit of a Mission Control turn (D-76): the session file it
 * belongs to and the thought / text delta, or the turn's end. A proposal
 * event is not forwarded — the desktop reads the cards from the session
 * file when the turn resolves.
 */
export interface ChatLiveEvent {
  readonly file: string;
  readonly event: Extract<ChatStreamEvent, { kind: 'thought' | 'text' | 'done' | 'error' }>;
}

/** The well-formed live event of a `chat` frame, or null. */
function chatLiveOf(frame: { file?: unknown; event?: unknown }): ChatLiveEvent | null {
  const event = frame.event;
  if (typeof frame.file !== 'string' || typeof event !== 'object' || event === null) {
    return null;
  }
  const { kind, text, message } = event as { kind?: unknown; text?: unknown; message?: unknown };
  if ((kind === 'thought' || kind === 'text') && typeof text === 'string') {
    return { file: frame.file, event: { kind, text } };
  }
  if (kind === 'done') {
    return { file: frame.file, event: { kind } };
  }
  return kind === 'error' ? { file: frame.file, event: { kind, message: typeof message === 'string' ? message : '' } } : null;
}

/** One SSE `data:` line: board / fleet / remote are debounced signals, `paths` and `chat` are payloads. */
export function dispatchFrame(
  json: string,
  fire: (what: 'board' | 'fleet' | 'remote') => void,
  onPaths?: (event: PathsEvent) => void,
  onChat?: (event: ChatLiveEvent) => void,
): void {
  let frame: { change?: string; vaultPath?: unknown; changed?: unknown; deleted?: unknown; file?: unknown; event?: unknown };
  try {
    frame = JSON.parse(json) as typeof frame;
  } catch {
    return;
  }
  if (frame.change === 'board' || frame.change === 'fleet' || frame.change === 'remote') {
    fire(frame.change);
  } else if (frame.change === 'chat' && onChat !== undefined) {
    const live = chatLiveOf(frame);
    if (live !== null) {
      onChat(live);
    }
  } else if (frame.change === 'paths' && onPaths !== undefined && typeof frame.vaultPath === 'string') {
    const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);
    onPaths({ vaultPath: frame.vaultPath, changed: strings(frame.changed), deleted: strings(frame.deleted) });
  }
}

export class EngineClient {
  /**
   * Null until the service is up (D-74): the plugin constructs the client at
   * activation and every engine-bound call answers
   * {@link UnconfiguredTicketsError} until `rebind` points it at the service
   * the setup (or an ordinary start) brought up.
   */
  constructor(private endpoints: EngineEndpoints | null) {}

  /** Whether the client has endpoints to talk to. */
  get bound(): boolean {
    return this.endpoints !== null;
  }

  /**
   * Points the client at a restarted service (Settings → Background service,
   * Restart / Start — and the setup's first start, D-74). Every call and the
   * event stream's reconnect read the endpoints when they run, so nothing
   * else needs to know.
   */
  rebind(endpoints: EngineEndpoints): void {
    this.endpoints = endpoints;
  }

  async health(): Promise<boolean> {
    if (this.endpoints === null) {
      return false;
    }
    try {
      const response = await fetch(`${this.endpoints.invokeUrl}/api/health`, {
        headers: { authorization: `Bearer ${this.endpoints.token}` },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async invoke(method: string, payload?: unknown): Promise<unknown> {
    if (this.endpoints === null) {
      throw new UnconfiguredTicketsError();
    }
    const response = await fetch(`${this.endpoints.invokeUrl}/api/invoke`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.endpoints.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ method, ...(payload === undefined ? {} : { payload }) }),
    });
    const body = (await response.json().catch(() => ({ ok: false, error: 'the engine returned no JSON' }))) as {
      ok?: boolean;
      value?: unknown;
      error?: string;
    };
    if (!response.ok || body.ok !== true) {
      throw new EngineError(body.error ?? `the engine answered ${response.status}`);
    }
    return body.value;
  }

  /** The engine's live-update stream (board | fleet | remote), debounced per kind. */
  onEvent(
    listener: (what: 'board' | 'fleet' | 'remote') => void,
    debounceMs = 200,
    /** The `paths` frames (D-3): undebounced -- the receiver batches. */
    onPaths?: (event: PathsEvent) => void,
    /** The `chat` frames (D-76): a Mission Control turn's thought / text deltas, undebounced. */
    onChat?: (event: ChatLiveEvent) => void,
  ): () => void {
    const endpoints = this.endpoints;
    if (endpoints === null) {
      return () => undefined; // the unconfigured state never opens the stream (D-74)
    }
    let closed = false;
    let current: AbortController | null = null;
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const fire = (what: 'board' | 'fleet' | 'remote'): void => {
      if (timers.has(what)) {
        return;
      }
      timers.set(
        what,
        setTimeout(() => {
          timers.delete(what);
          listener(what);
        }, debounceMs),
      );
    };
    const connect = async (): Promise<void> => {
      while (!closed) {
        current = new AbortController();
        try {
          const response = await fetch(`${endpoints.invokeUrl}/api/events`, {
            headers: { authorization: `Bearer ${endpoints.token}` },
            signal: current.signal,
          });
          if (!response.ok || response.body === null) {
            await new Promise((resolve) => setTimeout(resolve, 2_000));
            continue;
          }
          let buffer = '';
          const decoder = new TextDecoder();
          for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
            buffer += decoder.decode(chunk, { stream: true });
            const frames = buffer.split('\n\n');
            buffer = frames.pop() ?? '';
            for (const frame of frames) {
              for (const line of frame.split('\n')) {
                if (line.startsWith('data: ')) {
                  dispatchFrame(line.slice(6), fire, onPaths, onChat);
                }
              }
            }
          }
        } catch {
          // dropped — reconnect below
        }
        if (!closed) {
          await new Promise((resolve) => setTimeout(resolve, 2_000));
        }
      }
    };
    void connect();
    return () => {
      closed = true;
      current?.abort();
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
    };
  }

  /** A proxy that forwards every method call as an invoke, typed as the real service. */
  private proxy<T extends object>(): T {
    return new Proxy(
      {},
      {
        get: (_target, prop: string | symbol) => {
          if (prop === 'then' || typeof prop !== 'string') {
            return undefined; // never look thenable
          }
          return (input?: unknown) => this.invoke(prop, input);
        },
      },
    ) as T;
  }

  board = (): EngineBoardService => this.proxy<EngineBoardService>();

  fleet = (): FleetClient => this.proxy<FleetClient>();

  remote = (): RemoteService => this.proxy<RemoteService>();
}
