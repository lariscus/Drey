/**
 * A slot (req-177, ADR-0095 later change): one account a worker runs on.
 * The slot names the harness login it maps to — it never holds a key: a
 * Claude account is a `CLAUDE_CONFIG_DIR`, z.ai is an entry of opencode's
 * `auth.json`, Kimi is the CLI's credentials file. The runner reads the
 * secret from there when it fetches a quota, and forgets it. Req-290
 * retired the profile a slot once carried: every slot may serve every
 * repository.
 */
import type { QuotaKind, SlotBilling, WorkerProviderId } from '../protocol';

/** The harness login a slot maps to; every field is a reference, never a secret. */
export interface SlotLogin {
  /** Claude Code: the account's config folder, spawned as `CLAUDE_CONFIG_DIR`; absent = the default login. */
  readonly claudeConfigDir?: string;
  /** opencode: the provider entry in its `auth.json` (`zai-coding-plan`). */
  readonly opencodeAuthEntry?: string;
  /** opencode: the `auth.json` path; absent = opencode's own (`~/.local/share/opencode/auth.json`). */
  readonly opencodeAuthFile?: string;
  /** Kimi: the CLI's credentials file; absent = the first one in `<KIMI_HOME>/credentials/`. */
  readonly kimiCredentials?: string;
  /** Kimi: a second account's home, spawned as `KIMI_HOME`. */
  readonly kimiHome?: string;
  /** Copilot CLI (req-182): a second account's config folder, spawned as `COPILOT_HOME`; absent = `~/.copilot`. */
  readonly copilotHome?: string;
}

/** A window the runner counts itself (no readout): its budget per span. */
export interface SlotLimit {
  readonly window: '5h' | '7d' | 'month';
  readonly budget: number;
  readonly unit: 'tokens' | 'runs';
}

export interface Slot {
  readonly id: string;
  readonly label: string;
  readonly provider: WorkerProviderId;
  readonly billing: SlotBilling | null;
  /** Concurrent sessions the account serves; null = the provider's pool decides alone. */
  readonly sessions: number | null;
  readonly login: SlotLogin;
  readonly quota: QuotaKind;
  /** The budgets the counting fallback measures against; empty = it counts without a share. */
  readonly limits: readonly SlotLimit[];
  /** The stand-in for a provider `service.json` names no slot for. */
  readonly implied: boolean;
}

/** The environment a worker of this slot is spawned with: the account's login folder. */
export function slotEnv(slot: Slot): Readonly<Record<string, string>> | undefined {
  if (slot.provider === 'claude-code' && slot.login.claudeConfigDir !== undefined) {
    return { CLAUDE_CONFIG_DIR: slot.login.claudeConfigDir };
  }
  if (slot.provider === 'kimi' && slot.login.kimiHome !== undefined) {
    return { KIMI_HOME: slot.login.kimiHome };
  }
  if (slot.provider === 'copilot' && slot.login.copilotHome !== undefined) {
    return { COPILOT_HOME: slot.login.copilotHome };
  }
  return undefined;
}
