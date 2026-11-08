import { describe, expect, it } from 'vitest';
import { normalizeFleetPools, type FleetPools } from '../protocol';
import { effectivePoolSizes, isQuotaError, isRateLimitError, QUOTA_PAUSE_MS, RATE_LIMIT_SHRINK_MS, type PoolReading } from './pool-sizes';

/** The pools' sizes as pure math (req-63): configured, probed, shrunk, paused. */

const pools: FleetPools = normalizeFleetPools({ opencode: { size: 4 }, 'claude-code': { size: 2 } });

/** A reading of `pools` at `nowMs` with nothing probed, shrunk or paused unless given. */
const reading = (over: Partial<PoolReading> = {}): PoolReading => ({ pools, probed: {}, shrink: {}, nowMs: 0, ...over });

describe('provider pools (req-63)', () => {
  it('normalizes sizes and probe URLs per provider', () => {
    expect(normalizeFleetPools(undefined)).toEqual({
      opencode: { size: 1, probeUrl: null },
      'claude-code': { size: 1, probeUrl: null },
      kimi: { size: 1, probeUrl: null },
    });
    expect(normalizeFleetPools({ opencode: { size: 0, probeUrl: 'ftp://x' } }).opencode).toEqual({ size: 1, probeUrl: null });
    expect(normalizeFleetPools({ opencode: { size: 3, probeUrl: ' http://h:8080 ' } }).opencode).toEqual({ size: 3, probeUrl: 'http://h:8080' });
  });

  it('the effective size is capped by a probe and shrunk by a rate limit, never below one', () => {
    expect(effectivePoolSizes(reading())).toEqual({ opencode: 4, 'claude-code': 2, kimi: 1 });
    expect(effectivePoolSizes(reading({ probed: { opencode: 2 } })).opencode).toBe(2);
    expect(effectivePoolSizes(reading({ probed: { opencode: 8 } })).opencode).toBe(4);
    const shrink = { 'claude-code': { count: 5, untilMs: RATE_LIMIT_SHRINK_MS } };
    expect(effectivePoolSizes(reading({ shrink }))['claude-code']).toBe(1);
    expect(effectivePoolSizes(reading({ shrink, nowMs: RATE_LIMIT_SHRINK_MS }))['claude-code']).toBe(2);
  });

  it('a provider paused for its quota has no slot until the pause ends', () => {
    const pausedUntil = { opencode: QUOTA_PAUSE_MS };
    expect(effectivePoolSizes(reading({ pausedUntil })).opencode).toBe(0);
    expect(effectivePoolSizes(reading({ pausedUntil }))['claude-code']).toBe(2);
    expect(effectivePoolSizes(reading({ pausedUntil, nowMs: QUOTA_PAUSE_MS })).opencode).toBe(4);
  });

  it('reads a spent usage quota', () => {
    expect(isQuotaError('provider.quota 429: Usage limit reached for 5 hour.')).toBe(true);
    expect(isQuotaError('insufficient_quota')).toBe(true);
    expect(isQuotaError('prompt failed: 429')).toBe(false);
    expect(isQuotaError(null)).toBe(false);
  });

  it('reads 429 and rate-limit errors', () => {
    expect(isRateLimitError('prompt failed: 429')).toBe(true);
    expect(isRateLimitError('Error: rate_limit_error')).toBe(true);
    expect(isRateLimitError('Too Many Requests')).toBe(true);
    expect(isRateLimitError('prompt failed: 500')).toBe(false);
    expect(isRateLimitError(null)).toBe(false);
  });
});
