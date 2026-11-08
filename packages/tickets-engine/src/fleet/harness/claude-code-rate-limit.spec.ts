import { describe, expect, it } from 'vitest';
import { rateLimitEvent } from './claude-code-events';
import { claudeCodeAdapter } from './claude-code';
import type { NormalizedEvent, ProviderStart } from './contract';
import { ContractProcess } from './contract-process.fake';

/**
 * Claude Code's quota readout (spike 4, CLI 2.1.318; req-176 step 3): after
 * each assistant turn the stream-json output carries a `rate_limit_event`
 * whose `rate_limit_info.unifiedWindows` holds the five-hour and seven-day
 * windows. The adapter surfaces it as a normalized `usage` event with
 * `rateLimit`; req-177 consumes it later.
 */

const EVENT = {
  type: 'rate_limit_event',
  rate_limit_info: {
    unifiedWindows: {
      five_hour: { utilization: 0.42, resetsAt: 1_793_000_000, status: 'allowed' },
      seven_day: { utilization: 0.91, resetsAt: 1_793_400_000, status: 'allowed_warning' },
    },
    isUsingOverage: false,
  },
};

describe('rateLimitEvent — the quota windows after a turn', () => {
  it('reads both windows: utilization, the reset as an ISO instant, the status', () => {
    expect(rateLimitEvent(EVENT)).toEqual({
      kind: 'usage',
      rateLimit: {
        fiveHour: { utilization: 0.42, resetsAt: new Date(1_793_000_000_000).toISOString(), status: 'allowed' },
        sevenDay: { utilization: 0.91, resetsAt: new Date(1_793_400_000_000).toISOString(), status: 'allowed_warning' },
      },
    });
  });

  it('keeps a window it can read, nulls the fields it cannot, and drops an unknown status', () => {
    const event = rateLimitEvent({ type: 'rate_limit_event', rate_limit_info: { unifiedWindows: { five_hour: { utilization: 1, status: 'over_the_moon' } } } });
    expect(event?.rateLimit).toEqual({ fiveHour: { utilization: 1, resetsAt: null, status: null }, sevenDay: null });
  });

  it('an event without windows is no reading', () => {
    expect(rateLimitEvent({ type: 'rate_limit_event' })).toBeNull();
    expect(rateLimitEvent({ type: 'rate_limit_event', rate_limit_info: {} })).toBeNull();
  });
});

describe('the claude-code adapter surfaces the rate_limit_event', () => {
  it('as one usage event with the reading, between the turn and its result', () => {
    const proc = new ContractProcess();
    const events: NormalizedEvent[] = [];
    const start: ProviderStart = { cwd: 'W:/kt', instruction: 'Go.', model: null, permissionMode: 'accept-edits', resumeRef: null, ticketId: 'T-0001', onEvent: (e) => events.push(e), onSessionRef: () => undefined };
    claudeCodeAdapter(proc.spawnFn(), () => new Date('2026-11-08T12:00:00Z')).spawn(start);
    proc.say({ type: 'assistant', message: { content: [{ type: 'text', text: 'Working.' }] } });
    proc.say(EVENT);
    proc.say({ type: 'result', subtype: 'success', result: 'Done.' });
    const readings = events.filter((e) => e.rateLimit !== undefined);
    expect(readings).toHaveLength(1);
    expect(readings[0]).toMatchObject({ ts: '2026-11-08T12:00:00.000Z', kind: 'usage', rateLimit: { fiveHour: { utilization: 0.42 }, sevenDay: { status: 'allowed_warning' } } });
    expect(events.findIndex((e) => e.rateLimit !== undefined)).toBeLessThan(events.findIndex((e) => e.kind === 'result'));
  });
});
