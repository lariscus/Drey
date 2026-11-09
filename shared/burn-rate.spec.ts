import { describe, expect, it } from 'vitest';
import { burnRateCardOf, burnRateHoldOf, burnRateLineOf, type BurnRateFormat } from './burn-rate';
import { i18n } from './i18n';

const format: BurnRateFormat = { t: (key, params) => i18n.t(key, params), time: (date) => date.toISOString().slice(11, 16) };

const HOLD = { reason: 'burn-rate', spent: 0.2149, limit: 0.2, resumesAt: '2026-11-10T00:00:00.000Z', basis: 'measured', since: '2026-11-09T22:40:00.000Z' };

describe('the burn rate on every client (req-181)', () => {
  it('reads the chain status hold tolerantly', () => {
    expect(burnRateHoldOf({ hold: HOLD })).toEqual({ spent: 0.2149, limit: 0.2, resumesAt: '2026-11-10T00:00:00.000Z', basis: 'measured', since: '2026-11-09T22:40:00.000Z' });
    expect(burnRateHoldOf({ hold: null })).toBeNull();
    expect(burnRateHoldOf({})).toBeNull();
    expect(burnRateHoldOf(null)).toBeNull();
    expect(burnRateHoldOf({ hold: { ...HOLD, reason: 'other' } })).toBeNull();
    expect(burnRateHoldOf({ hold: { ...HOLD, resumesAt: 'soon' } })).toBeNull();
    expect(burnRateHoldOf({ hold: { ...HOLD, basis: 'guess', since: 5 } })).toMatchObject({ basis: 'measured', since: null });
  });

  it('words the popover line and the status tooltip', () => {
    const view = burnRateHoldOf({ hold: HOLD })!;
    expect(burnRateLineOf(view, format)).toBe('Burn rate reached · resumes at 00:00');
    expect(i18n.t('status.autopilot.tooltip_burn_rate', { state: 'On', time: '00:00', chord: 'Ctrl+Alt+P' })).toBe('Autopilot: On · Burn rate reached · resumes at 00:00 (Ctrl+Alt+P)');
  });

  it('builds the Needs-you card: peach, title, body, chips, Wait first', () => {
    const card = burnRateCardOf(burnRateHoldOf({ hold: HOLD })!, format);
    expect(card).toEqual({
      id: 'burn-rate-2026-11-10T00:00:00.000Z',
      tone: 'attention',
      title: 'Burn rate reached · 20 % of the week today',
      body: 'Nothing new starts until 00:00. Running steps finish.',
      chips: ['spent 21 %', 'resumes 00:00'],
      at: '2026-11-09T22:40:00.000Z',
      actions: [
        { id: 'wait', label: 'Wait', primary: true },
        { id: 'allow_once', label: 'Allow today once', primary: false },
      ],
    });
  });

  it('says so when the figure was estimated', () => {
    expect(burnRateCardOf(burnRateHoldOf({ hold: { ...HOLD, basis: 'estimated' } })!, format).chips).toEqual(['spent 21 %', 'resumes 00:00', 'estimated']);
    expect(burnRateCardOf(burnRateHoldOf({ hold: { ...HOLD, basis: 'mixed' } })!, format).chips[2]).toBe('partly estimated');
  });
});
