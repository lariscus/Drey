import { describe, expect, it } from 'vitest';
import type { RunInfo } from '../protocol';
import { ChainState } from './chain-state';
import { PersonaBreaker } from './persona-breaker';

function setup(): { state: ChainState; breaker: PersonaBreaker; lines: string[]; now: { t: number } } {
  const state = new ChainState();
  const lines: string[] = [];
  const now = { t: Date.parse('2026-11-12T10:00:00Z') };
  const breaker = new PersonaBreaker(state, { clock: { now: () => new Date(now.t) }, log: (line) => lines.push(line), persist: () => Promise.resolve() });
  return { state, breaker, lines, now };
}

const red = (ticketId: string): RunInfo => ({ ticketId, gateFailure: 'npm test failed', lastError: null }) as unknown as RunInfo;

describe('the persona breaker (concept §9)', () => {
  it('counts red gates per persona, cools it down, and trips it into the pause after the threshold', async () => {
    const { state, breaker, lines, now } = setup();
    await breaker.failed(red('T-1'), 'ben', 3);
    expect(state.personaRedStreak.ben).toBe(1);
    expect(breaker.coolingDown('ben')).toBe(true);
    now.t += 61_000;
    expect(breaker.coolingDown('ben')).toBe(false);
    await breaker.failed(red('T-2'), 'ben', 3);
    await breaker.failed(red('T-1'), 'ben', 3);
    expect(state.pausedPersonas.has('ben')).toBe(true);
    expect(state.personaTripped.ben?.reason).toBe('3 red gates in a row');
    expect(lines.at(-1)).toContain('circuit breaker tripped on persona "ben"');
  });

  it('a green end resets the streak; a quota error or a run without a gate verdict never counts', async () => {
    const { state, breaker } = setup();
    await breaker.failed(red('T-1'), 'ralf');
    breaker.green('ralf');
    expect(state.personaRedStreak.ralf).toBe(0);
    await breaker.failed({ ticketId: 'T-2', gateFailure: null, lastError: 'crashed' } as unknown as RunInfo, 'ralf');
    expect(state.personaRedStreak.ralf).toBe(0);
    expect(state.ticketFailures['T-2']?.count).toBe(1);
  });

  it('the trip is in the chain status and survives the file', () => {
    const { state } = setup();
    state.pausedPersonas.add('ben');
    state.personaTripped.ben = { reason: '3 red gates in a row', at: '2026-11-12T10:00:00.000Z' };
    expect(state.status({ quotaPausedUntil: {}, poolSize: {} }).personaTripped).toEqual({ ben: { reason: '3 red gates in a row', at: '2026-11-12T10:00:00.000Z' } });
    expect(state.file().personaTripped).toEqual(state.personaTripped);
  });
});
