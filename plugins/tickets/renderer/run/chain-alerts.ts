/**
 * The chain's alerts: what stops the fleet from working the board, as rows
 * the Work panel puts on top — a provider out of quota. (A tripped
 * breaker shows on the persona's own card; a paused persona is the pool
 * chip's own line.) Pure — the panel and the notifications share it, the
 * spec pins it.
 */
import type { ChainStatus } from '../../../../packages/tickets-engine/src/fleet/protocol';

export type ChainAlertKind = 'quota';

/** What the alert's one button does; null = nothing to press (a quota waits by itself). */
export type ChainAlertAction = { readonly kind: 'run-chain'; readonly label: string };

export interface ChainAlert {
  readonly kind: ChainAlertKind;
  /** Stable per cause: the notification tag and the "already announced" key. */
  readonly key: string;
  readonly title: string;
  readonly text: string;
  readonly action: ChainAlertAction | null;
}

/** `16:05` in the viewer's time. */
function clock(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** A provider id as people read it. */
function providerLabel(provider: string): string {
  return provider === 'opencode' ? 'OpenCode' : provider === 'claude-code' ? 'Claude Code' : provider === 'kimi' ? 'Kimi Code' : provider === 'copilot' ? 'Copilot CLI' : provider;
}

export function chainAlertsOf(chain: ChainStatus | null, nowMs: number): readonly ChainAlert[] {
  if (chain === null || !chain.configured) {
    return [];
  }
  const alerts: ChainAlert[] = [];
  for (const [provider, until] of Object.entries(chain.quotaPausedUntil ?? {})) {
    if (Date.parse(until) > nowMs) {
      alerts.push({
        kind: 'quota',
        key: `quota:${provider}:${until}`,
        title: `${providerLabel(provider)} is out of quota`,
        text: `Its usage limit is spent — no new ${providerLabel(provider)} run before ${clock(until)}, then the chain tries again by itself.`,
        action: null,
      });
    }
  }
  return alerts;
}

/**
 * The alerts worth an OS notification that `announced` has not seen
 * yet; marks them seen. A quota pause notifies.
 */
export function newChainAlerts(alerts: readonly ChainAlert[], announced: Set<string>): readonly ChainAlert[] {
  const fresh = alerts.filter((alert) => alert.kind === 'quota' && !announced.has(alert.key));
  for (const alert of fresh) {
    announced.add(alert.key);
  }
  return fresh;
}
