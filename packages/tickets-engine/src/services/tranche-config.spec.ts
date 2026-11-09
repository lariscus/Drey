import { describe, expect, it } from 'vitest';
import { DEFAULT_TRANCHE } from '../fleet/protocol';
import { trancheConfigOf, trancheValueOf } from './tranche-config';

const host = (values: Record<string, unknown>) => ({ configGet: async <T>(key: string): Promise<T | undefined> => values[key] as T | undefined });

describe('trancheConfigOf', () => {
  it('takes the defaults when nothing is set', async () => {
    expect(await trancheConfigOf(host({}))).toEqual(DEFAULT_TRANCHE);
  });

  it('reads the autopilot.tranche and autopilot.earlyStop keys, numbers or numeric text', async () => {
    const config = await trancheConfigOf(host({ 'autopilot.tranche.runs': '6', 'autopilot.tranche.budgetShare': 0.5, 'autopilot.tranche.minutes': 90, 'autopilot.earlyStop.redGates': '4', 'autopilot.earlyStop.costFactor': 'off' }));
    expect(config).toMatchObject({ runs: 6, budgetShare: 0.5, minutes: 90, earlyStop: { redGates: 4, gateWindow: 6, costFactor: null } });
  });

  it('switches a limit off with 0 or off, and ignores junk', async () => {
    const config = await trancheConfigOf(host({ 'autopilot.tranche.runs': 0, 'autopilot.tranche.minutes': 'later', 'autopilot.tranche.budgetShare': 'off' }));
    expect(config).toMatchObject({ runs: null, minutes: DEFAULT_TRANCHE.minutes, budgetShare: null });
  });
});

describe('trancheValueOf', () => {
  it('maps the field texts', () => {
    expect(trancheValueOf('')).toBeUndefined();
    expect(trancheValueOf(' 12 ')).toBe(12);
    expect(trancheValueOf('0')).toBeNull();
    expect(trancheValueOf(false)).toBeNull();
  });
});
