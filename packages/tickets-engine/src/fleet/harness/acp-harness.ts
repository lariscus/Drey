/**
 * What sets one ACP harness apart from another (req-182, ADR-0096 later
 * change): the one `AcpClient` and the one worker serve Kimi, Copilot CLI
 * and opencode; each harness is a thin launch description — the process,
 * what the client advertises, how a resume opens the session, where the
 * model pin goes, which session mode a permission mode is, and where its
 * token usage comes from. Types only: no Node, no process.
 */
import type { PermissionMode, WorkerProviderId } from '../protocol';
import type { ProviderStart } from './contract';

/** The process a start runs: the command, its arguments, the environment beside the slot's. */
export interface AcpLaunch {
  readonly command: string;
  readonly args: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  /** One line for the run's stream about how the process was set up (opencode's context cap); absent = none. */
  readonly note?: string;
}

/** One session config option the model pin sets (`session/set_config_option`). */
export interface AcpConfigSetting {
  readonly configId: string;
  readonly value: string;
}

/** The session mode a start asks for (`session/set_mode`); null = none is set. */
export interface AcpModeChoice {
  readonly modeId: string | null;
  /** One line for the run's stream when the asked behaviour is not available; null otherwise. */
  readonly note: string | null;
}

/** One model call (or one turn) of a session: its tokens, as the harness reports them. */
export interface AcpUsageRecord {
  readonly model: string | null;
  readonly inputOther: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheCreation: number;
  /** The record sums a whole turn (the prompt reply), not one model call: it is no context size. */
  readonly aggregate?: boolean;
}

/** Where a harness's token usage comes from after a turn. */
export interface AcpUsageMeter {
  /** A resumed session: what it spent before this run is not this run's. */
  skipEarlier(sessionId: string): Promise<void>;
  /** The model calls the finished turn added — read off its `session/prompt` reply, or the harness's own log. */
  turnRecords(sessionId: string, reply: Readonly<Record<string, unknown>>): Promise<readonly AcpUsageRecord[]>;
}

/** How a resume opens the session, in the order tried. `resume` only when the agent advertises it. */
export type AcpResumeMethod = 'resume' | 'load';

export interface AcpHarness {
  readonly id: WorkerProviderId;
  readonly label: string;
  /** The command's name in the run's stream and its errors (`kimi`, `copilot`, `opencode`). */
  readonly agent: string;
  launch(start: ProviderStart): AcpLaunch;
  /** What `initialize` advertises — e.g. `elicitation.form`, the questions of opencode's question tool. */
  readonly clientCapabilities: Readonly<Record<string, unknown>>;
  readonly resume: readonly AcpResumeMethod[];
  /**
   * The config options a model pin sets per session (`model`, opencode's
   * `effort` for a `#variant`); empty = the pin is fixed at launch
   * (Copilot CLI's `--model`). An option other than `model` is set only
   * when the session offers it.
   */
  modelSettings(model: string): readonly AcpConfigSetting[];
  /** The session mode for a start's permission mode, given the modes the session offered (null: it named none). */
  modeFor(mode: PermissionMode, offered: readonly string[] | null): AcpModeChoice;
  /** The usage source of one worker. */
  meter(): AcpUsageMeter;
  /**
   * A turn with no message, no tool call and no usage record is the
   * provider's refusal (T-0061). Only where the meter reads the turn off the
   * prompt reply; Kimi's wire log may simply be unreadable.
   */
  readonly emptyTurnIsRefusal: boolean;
}
