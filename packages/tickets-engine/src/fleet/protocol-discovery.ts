import type { ClassName } from '../contracts/capability-class';
import type { WorkerProviderId } from './protocol';
import type { ModelCapabilities } from './protocol-routing';

// ---------------------------------------------------------------------------
// Model discovery (req-286, board 7l v3): what each harness on this machine
// offers. No model is typed in — the runner asks the harnesses (an ACP
// harness's `session/new` config options, Claude Code's own model list in
// its stream-json `initialize` reply), and the model table of
// `service.json` is written from what was found. These are the wire shapes
// `GET /models` carries under `discovery`; `fleet/discovery/` computes them.

/** A harness row's state: signed in, installed but signed out, not on PATH, or the probe failed. */
export type HarnessState = 'signed-in' | 'signed-out' | 'not-installed' | 'failed';

/** One harness row of board 7l v3 (`Claude Code 2.1.319 · signed in · 4 models`). */
export interface HarnessReport {
  readonly provider: WorkerProviderId;
  readonly label: string;
  /** The harness's own version; null when not installed or it did not say. */
  readonly version: string | null;
  readonly state: HarnessState;
  /** The model providers it is configured for (opencode's `zai-coding-plan`, `github-copilot`); empty when it serves one. */
  readonly providers: readonly string[];
  /** How many models it offers. */
  readonly models: number;
  /** Why the probe failed; null otherwise. */
  readonly error: string | null;
}

/** A model a harness offers, with what the registry import knows of it. */
export interface DiscoveredModel {
  readonly model: string;
  readonly provider: WorkerProviderId;
  /** The account (slot) it runs on when one is tied to it (opencode's provider entry), else null = every slot of the harness. */
  readonly slot: string | null;
  /** The harness's display name, when it gives one. */
  readonly name: string | null;
  readonly capabilities: ModelCapabilities;
  /** The class the card proposes (the lightest class, or one the name suggests); the owner picks. */
  readonly suggested: ClassName;
}

/** What `GET /models` carries under `discovery`. */
export interface DiscoveryReport {
  /** When the harnesses were last asked (ISO); null = not yet. */
  readonly checkedAt: string | null;
  /** True while a probe runs. */
  readonly running: boolean;
  readonly harnesses: readonly HarnessReport[];
  /** Models found that the table does not hold and the owner did not ignore — the new-model cards. */
  readonly found: readonly DiscoveredModel[];
  /** `<provider>:<model>` keys the owner ignored (`service.json` → `discovery.ignored`). */
  readonly ignored: readonly string[];
}

/** The ignore key of a discovered model. */
export function discoveryKeyOf(model: { readonly provider: WorkerProviderId; readonly model: string }): string {
  return `${model.provider}:${model.model}`;
}

/** One model as a harness names it. */
export interface OfferedModel {
  readonly model: string;
  readonly name: string | null;
}

/** What one probe of a harness found (the runner's `fleet/harness/probe-*`). */
export interface ProbeOutcome {
  readonly installed: boolean;
  readonly version: string | null;
  /** True / false when the harness said; null when it could not tell. */
  readonly signedIn: boolean | null;
  readonly models: readonly OfferedModel[];
  /** Why the probe failed; null when it answered. */
  readonly error: string | null;
}
