import { describe, expect, it } from 'vitest';
import { i18n } from '../../shared/i18n';
import { STATUS_COLOURS, trayTooltip, trayVerdictOf, type TrayStatusFacts } from './tray-status';

/** req-276: the service's state → the dot's colour and the tooltip's words. */
const t = (key: string, params?: Record<string, string | number>): string => i18n.lookup(key, params);

const healthy = {
  components: {
    engine: { state: 'running' },
    runner: { state: 'sleeping' },
    mcp: { state: 'running' },
    gateway: { state: 'stopped' },
  },
};
const facts = (over: Partial<TrayStatusFacts>): TrayStatusFacts => ({ locked: true, status: healthy, autopilot: 'off', ...over });
const withComponent = (id: string, state: string) => ({ components: { ...healthy.components, [id]: { state } } });

describe('trayVerdictOf', () => {
  it('no lock and no answer: stopped (grey)', () => {
    expect(trayVerdictOf(facts({ locked: false, status: null }))).toEqual({ status: 'stopped', problem: null });
  });

  it('a lock whose service does not answer: a problem (red)', () => {
    expect(trayVerdictOf(facts({ status: null }))).toEqual({ status: 'problem', problem: { kind: 'not_answering' } });
  });

  it('any failed component: a problem naming the first in engine, runner, MCP, gateway order', () => {
    for (const id of ['engine', 'runner', 'mcp', 'gateway'] as const) {
      expect(trayVerdictOf(facts({ status: withComponent(id, 'failed') }))).toEqual({ status: 'problem', problem: { kind: 'failed', component: id } });
    }
    const two = { components: { ...healthy.components, runner: { state: 'failed' }, gateway: { state: 'failed' } } };
    expect(trayVerdictOf(facts({ status: two })).problem).toEqual({ kind: 'failed', component: 'runner' });
  });

  it('the Autopilot Paused: paused (orange) — a failure still wins', () => {
    expect(trayVerdictOf(facts({ autopilot: 'paused' }))).toEqual({ status: 'paused', problem: null });
    expect(trayVerdictOf(facts({ autopilot: 'paused', status: withComponent('mcp', 'failed') })).status).toBe('problem');
  });

  it('running (green) also with the runner asleep or starting, the gateway off, the Autopilot On or Off, an older service without components', () => {
    expect(trayVerdictOf(facts({})).status).toBe('running');
    expect(trayVerdictOf(facts({ autopilot: 'on', status: withComponent('runner', 'starting') })).status).toBe('running');
    expect(trayVerdictOf(facts({ status: {} })).status).toBe('running');
  });

  it('has one distinct colour per state', () => {
    const colours = Object.values(STATUS_COLOURS).map((rgb) => rgb.join(','));
    expect(new Set(colours).size).toBe(4);
  });
});

describe('trayTooltip', () => {
  it('names the state in words, and what is wrong or paused on a second line', () => {
    expect(trayTooltip({ status: 'running', problem: null }, t)).toBe('Drey Service · running');
    expect(trayTooltip({ status: 'stopped', problem: null }, t)).toBe('Drey Service · stopped');
    expect(trayTooltip({ status: 'paused', problem: null }, t)).toBe('Drey Service · paused\nAutopilot paused');
    expect(trayTooltip({ status: 'problem', problem: { kind: 'failed', component: 'runner' } }, t)).toBe('Drey Service · problem\nCrew runner failed');
    expect(trayTooltip({ status: 'problem', problem: { kind: 'not_answering' } }, t)).toBe('Drey Service · problem\nThe service does not answer');
  });
});
