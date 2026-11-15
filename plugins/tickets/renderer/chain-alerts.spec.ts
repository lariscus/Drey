import { describe, expect, it } from 'vitest';
import type { ChainStatus } from '../../../packages/tickets-engine/src/fleet/protocol';
import { chainAlertsOf, newChainAlerts } from './chain-alerts';

/**
 * The chain alerts fix (2026-10-31): T-0061's three quota failures tripped
 * the build breaker and the Work panel showed nothing. These pin what the
 * panel puts on top: a provider out of quota (a tripped persona breaker
 * shows on its own card; a paused persona is the pool chip's own line).
 */

const chain = (patch: Partial<ChainStatus>): ChainStatus => ({
  configured: true,
  master: 'run',
  columns: {},
  quotaPausedUntil: {},
  ...patch,
});

const NOW = Date.parse('2026-10-31T14:00:00Z');

describe('chainAlertsOf', () => {
  it('a running quota pause alerts without a button; an ended one is gone', () => {
    const paused = chain({ quotaPausedUntil: { opencode: '2026-10-31T14:30:00Z' } });
    const alerts = chainAlertsOf(paused, NOW);
    expect(alerts[0]!.title).toBe('OpenCode is out of quota');
    expect(alerts[0]!.action).toBeNull();
    expect(chainAlertsOf(paused, Date.parse('2026-10-31T14:31:00Z'))).toEqual([]);
  });

  it('no chain, no alerts', () => {
    expect(chainAlertsOf(null, NOW)).toEqual([]);
    expect(chainAlertsOf(chain({ configured: false, master: 'halted' }), NOW)).toEqual([]);
  });
});

describe('newChainAlerts', () => {
  it('announces a quota pause once', () => {
    const alerts = chainAlertsOf(chain({ quotaPausedUntil: { opencode: '2026-10-31T14:30:00Z' } }), NOW);
    const seen = new Set<string>();
    expect(newChainAlerts(alerts, seen).map((a) => a.kind)).toEqual(['quota']);
    expect(newChainAlerts(alerts, seen)).toEqual([]);
  });
});
