/**
 * The service window's contract (req-165/166, ADR-0092 later change of
 * 2026-11-09): what the window process's main side
 * (`electron/service-window/`) hands its renderer
 * (`apps/service-window/`) over the preload bridge `window.serviceWindow`.
 *
 * The window owns no state: every value here is read from Drey Service's
 * control API, the Crew runner's API or the engine's invoke channel at the
 * moment it is asked for. Tokens never cross into the renderer — main
 * holds them and the renderer names what it wants, never a URL.
 *
 * Types and constants only; no Node, no Electron, no Angular.
 */

/** The IPC channels between the window's preload and its main side. */
export const SERVICE_WINDOW_CHANNELS = {
  snapshot: 'service-window:snapshot',
  runs: 'service-window:runs',
  stream: 'service-window:stream',
  instruction: 'service-window:instruction',
  logTail: 'service-window:log-tail',
  component: 'service-window:component',
  run: 'service-window:run',
  copyAttach: 'service-window:copy-attach',
  openWorktree: 'service-window:open-worktree',
  openDrey: 'service-window:open-drey',
  quitService: 'service-window:quit-service',
  windowControl: 'service-window:window-control',
  /** main → renderer: one {@link ServiceWindowEvent}. */
  event: 'service-window:event',
  /** main → renderer: show a tab (the tray's entries). */
  showTab: 'service-window:show-tab',
} as const;

export type ServiceWindowTab = 'components' | 'sessions' | 'logs';

export type ComponentState = 'starting' | 'running' | 'sleeping' | 'stopped' | 'failed' | 'external';

/** The rows of board 8a's component list, in order. */
export type ComponentId = 'engine' | 'runner' | 'mcp' | 'gateway' | 'model';

export type ComponentAction = 'restart' | 'stop' | 'start';

export interface EngineFacts {
  readonly state: ComponentState;
  /** `127.0.0.1:<port>` of the invoke channel; null before it binds. */
  readonly address: string | null;
  /** The tickets vault's folder name (`drey-tickets`). */
  readonly vaultName: string | null;
}

export interface RunnerFacts {
  readonly state: ComponentState;
  /** Why it failed or is blocked; null otherwise. */
  readonly reason: string | null;
  readonly liveRuns: number;
}

export interface McpFacts {
  /** The workers' vault MCP (req-167): `running` with its address and live workers once the service listens. */
  readonly state: ComponentState;
  readonly detail: string | null;
}

export interface GatewayFacts {
  readonly state: ComponentState;
  /** The phones' address while it listens. */
  readonly address: string | null;
  readonly devices: number;
  /** Why it does not listen. */
  readonly reason: string | null;
}

export interface LocalModelFacts {
  /** Null while the first probe has not answered, or no local endpoint is configured. */
  readonly reachable: boolean | null;
  /** The endpoint's name for the row: `LM Studio`, or `host:port` when no preset names it. */
  readonly name: string | null;
  /** ISO time the endpoint last answered while this window process ran; null = never. */
  readonly lastSeen: string | null;
}

/** One slot (account) as board 8a's Slots block draws it (req-177's `GET /slots`). */
export interface SlotFacts {
  readonly id: string;
  readonly label: string;
  readonly busy: number;
  readonly total: number;
  /** The share left in the tightest window, 0–1; null = no quota readout. */
  readonly left: number | null;
  /** q = remaining share over remaining time share; null when unknown. */
  readonly q: number | null;
  /** ISO time the tightest window resets; null when unknown. */
  readonly resetsAt: string | null;
  readonly reliability: 'measured' | 'estimated' | 'unknown';
}

/** Settings → Background service's Load group (the governor reads it live, req-180). */
export interface LoadFacts {
  readonly heavySeats: number;
  readonly reserve: number;
  readonly lowPriority: boolean;
  readonly quietHours: string;
}

/** Why a heavy task waits (req-180): a seat, the quiet hours, the load. */
export type GovernorWaitCause = 'seats' | 'quiet' | 'load';

/** The runner's resource governor as the Governor block draws it (`GET /governor`, req-180). */
export interface GovernorFacts {
  readonly heavy: { readonly busy: number; readonly total: number; readonly holders: readonly { readonly ticket: string; readonly task: string }[] };
  readonly light: { readonly busy: number; readonly total: number | null };
  /** The higher of CPU and memory in percent; null before the first sample. */
  readonly load: number | null;
  readonly reserve: number;
  /** The quiet span's end (`07:00`) while it holds. */
  readonly quietUntil: string | null;
  readonly waiting: readonly { readonly ticket: string; readonly task: string; readonly cause: GovernorWaitCause }[];
  /** The dev servers listening on a leased port. */
  readonly devServers: readonly { readonly port: number; readonly ticket: string }[];
}

export interface ServiceSnapshot {
  readonly running: boolean;
  readonly pid: number | null;
  /** ISO. */
  readonly startedAt: string | null;
  readonly components: {
    readonly engine: EngineFacts;
    readonly runner: RunnerFacts;
    readonly mcp: McpFacts;
    readonly gateway: GatewayFacts;
    readonly model: LocalModelFacts;
  };
  /** Today's spend against the provider ledgers (ADR-0095); null while the runner sleeps. */
  readonly spend: { readonly spent: number; readonly limit: number | null } | null;
  /** Null while the runner sleeps (no `GET /slots` to ask). */
  readonly slots: readonly SlotFacts[] | null;
  readonly load: LoadFacts;
  /** The governor's live seats and waits; null while the runner sleeps (nothing runs then). */
  readonly governor: GovernorFacts | null;
  /** Start with Windows (`service.autostart` while the service is enabled). */
  readonly autostart: boolean;
}

/** A run as the Sessions tab needs it — a lean copy of the runner's `RunInfo`. */
export interface SessionRun {
  readonly id: string;
  readonly ticketId: string;
  readonly persona: string | null;
  /** The harness: `claude-code`, `opencode`, `kimi`. */
  readonly provider: string;
  readonly model: string | null;
  readonly phase: string | null;
  readonly state: 'starting' | 'running' | 'stopping' | 'done' | 'stopped' | 'failed' | 'detached';
  readonly pid: number | null;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly lastActivity: string;
  readonly sessionRef: string | null;
  readonly tokensIn: number;
  readonly cacheReadTokens: number;
  readonly tokensOut: number;
  readonly costUsd: number | null;
  /** Mid-turn or standing; null while the harness has not said. */
  readonly turn: 'busy' | 'idle' | null;
  readonly turns: number | null;
  /** The owner holds the run (a takeover, an interactive dialog). */
  readonly held: boolean;
  /** An interactive dialog run (req-65): a 1:1 with a persona. */
  readonly interactive: boolean;
  readonly origin: string | null;
  readonly handoverMode: string | null;
  readonly worktreePath: string;
  readonly slot: { readonly id: string; readonly label: string } | null;
  /** The capability class the pool granted (`B`); null before the pool. */
  readonly grantClass: string | null;
  /** The permission mode the run started with, when known. */
  readonly permission: string | null;
}

/** One line of a run's normalized stream (`stream.jsonl`, the harness contract's `NormalizedEvent`). */
export interface StreamEvent {
  readonly ts: string;
  readonly kind: 'note' | 'text' | 'usage' | 'result' | 'error' | 'tool' | 'text-delta';
  readonly text?: string;
  readonly tool?: string;
  readonly detail?: string;
  readonly tokensIn?: number;
  readonly tokensOut?: number;
  readonly cacheReadTokens?: number;
  readonly costUsd?: number;
  readonly changes?: { readonly added: number; readonly removed: number };
  readonly turn?: 'busy' | 'idle';
  readonly turnUsage?: {
    readonly input?: number | null;
    readonly output?: number | null;
    readonly cacheRead?: number | null;
    readonly cacheCreation?: number | null;
  };
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** One line of the service log. */
export interface LogLine {
  /** ISO. */
  readonly at: string;
  readonly level: LogLevel;
  /** `service`, `engine`, `runner`, `gateway`, `mcp`, `window`. */
  readonly component: string;
  readonly message: string;
}

export type ServiceWindowEvent =
  | { readonly kind: 'run'; readonly run: SessionRun }
  | { readonly kind: 'line'; readonly runId: string; readonly event: StreamEvent }
  | { readonly kind: 'log'; readonly line: LogLine }
  /** The service came, went, or its components changed: ask for a new snapshot. */
  | { readonly kind: 'status' };

export type ActionReply = { readonly ok: true } | { readonly ok: false; readonly error: string };

export type RunAction = 'send' | 'interrupt' | 'resume' | 'stop';

/** `window.serviceWindow` — the preload's whole surface. */
export interface ServiceWindowApi {
  snapshot(): Promise<ServiceSnapshot>;
  /** The live runs plus today's ended ones, newest first. */
  runs(): Promise<readonly SessionRun[]>;
  stream(runId: string): Promise<readonly StreamEvent[]>;
  /** The composed instruction the run started with; null when the runner does not have it. */
  instruction(runId: string): Promise<string | null>;
  logTail(): Promise<readonly LogLine[]>;
  component(id: ComponentId, action: ComponentAction): Promise<ActionReply>;
  /** Send (text) / interrupt / resume / stop — the steer ladder at raw level (ADR-0075). */
  run(runId: string, action: RunAction, text?: string): Promise<ActionReply>;
  copyAttachCommand(runId: string): Promise<ActionReply>;
  openWorktree(runId: string): Promise<ActionReply>;
  openDrey(): Promise<void>;
  /** Asks natively first while runs live; then `POST /shutdown`. */
  quitService(): Promise<ActionReply>;
  windowControl(action: 'minimize' | 'maximize' | 'close'): void;
  /** Returns the unsubscribe. */
  onEvent(listener: (event: ServiceWindowEvent) => void): () => void;
  onShowTab(listener: (tab: ServiceWindowTab) => void): () => void;
}
