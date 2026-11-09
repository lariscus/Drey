import type { ChatBridge } from '../contracts/chat';
import type { ChatChangePayload } from '../contracts/remote-protocol';
import type { VerifyHarness } from '../contracts/verify';
import type { OneOnOneToolSeam } from '../fleet/one-on-one-toolset';
import type { RunnerLocator } from '../services/fleet-client';
import type { PathsChange } from './drey-port';
import type { FileConfigStore } from './file-config';
import type { RemoteStatus } from './service';

/**
 * The tickets engine's public face (ADR-0088, E2b): what a host starts it
 * with and what it hands back. Since req-164 the engine is the always-on
 * component of Drey Service (`../service/`, ADR-0092): the Drey plugin
 * starts the service or adopts a live one through `service.lock`; both then
 * talk to the engine over the invoke channel, and phones talk to it through
 * the gateway's pairing. The composition is `engine.ts`.
 */
export interface EngineOptions {
  /** Absolute path of the tickets vault (the folder containing `tickets/`). */
  readonly vaultPath: string;
  /** The engine home: config, lockfile, run history, the legacy worktree base. */
  readonly home: string;
  /** The built phone client's folder (served by the gateway). */
  readonly clientDir: string;
  readonly log?: (message: string, level?: 'info' | 'warn' | 'error') => void;
  /** The invoke listener's port; 0 picks a free one. */
  readonly invokePort?: number;
  /** The verify step's harness; the Playwright driver by default (the specs' seam). */
  readonly verifyHarness?: VerifyHarness;
  /** The Mission Control chat's LLM bridge; `createChatBridge` by default (the specs' seam). */
  readonly chatBridge?: ChatBridge;
  /**
   * The Crew runner (req-164): Drey Service hands its runner component; a
   * spec may hand a fixed locator. Absent, the engine makes its own
   * in-process runner component over `<home>/fleet`.
   */
  readonly runner?: RunnerLocator;
  /**
   * How long after the last Drey event stream closed the engine asks the
   * runner to retire if idle (req-110); 5 s by default, longer than the
   * client's 2 s reconnect.
   */
  readonly dreyGoneGraceMs?: number;
  /**
   * The tools attached to a persona's 1:1 session (req-217): Drey Service
   * hands its vault MCP's answer; absent = no tool is attached and the brief
   * names none (a standalone engine, a spec).
   */
  readonly oneOnOneTools?: OneOnOneToolSeam;
}

export interface Engine {
  /** The loopbase for the invoke channel, e.g. http://127.0.0.1:41231. */
  readonly invokeUrl: string;
  /** The local bearer token every invoke call carries. */
  readonly token: string;
  config: FileConfigStore;
  invoke(method: string, payload?: unknown): Promise<unknown>;
  onEvent(listener: (what: 'board' | 'fleet' | 'remote' | 'chat', payload?: ChatChangePayload) => void): () => void;
  /** The files engine writes touched (D-3): the plugin-only paths channel. */
  onPaths(listener: (change: PathsChange) => void): () => void;
  /**
   * Tells the paths channel of files written outside the engine's own
   * services (req-213: a worker's vault write through Drey Service's MCP) —
   * Drey's vault round then reloads clean open tabs and refreshes its
   * indexes, with the watcher on or off.
   */
  emitPaths(change: PathsChange): void;
  /** Drey instances holding the event stream now (req-164: the service's "is a Drey here"). */
  dreyClients(): number;
  /** The remote gateway's state (the service's gateway row and its sleep verdict). */
  remoteStatus(): RemoteStatus;
  /** Settles once the startup housekeeping that runs behind `createEngine` (the videos folder, the retired config key) has finished. */
  readonly ready: Promise<void>;
  /** Stops the engine; resolves only after the startup housekeeping ended, so no file is written after it. */
  close(): Promise<void>;
}
