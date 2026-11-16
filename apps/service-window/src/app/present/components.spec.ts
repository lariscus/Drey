import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, createI18n, loadCatalog } from '../../../../../shared/i18n';
import type { ServiceSnapshot } from '../../../../../shared/service-window/contract';
import { demoLog, demoRuns, demoSnapshot } from '../api/demo-data';
import { componentRows } from './component-rows';
import { clock, compact, joinParts, money, shortRef } from './format';
import { appendLog, logRows, LOG_LIMIT } from './log-rows';
import { governorRows } from './governor-rows';
import { slotRows } from './slot-rows';
import { statusLine } from './status-line';

const i18n = createI18n({ locale: DEFAULT_LOCALE, catalog: loadCatalog(DEFAULT_LOCALE) });

function withComponents(patch: Partial<ServiceSnapshot['components']>): ServiceSnapshot {
  const base = demoSnapshot();
  return { ...base, components: { ...base.components, ...patch } };
}

describe('format', () => {
  it('joins present parts with the dot', () => {
    expect(joinParts(['a', null, '', 'b', undefined, false])).toBe('a · b');
  });
  it('formats clock, compact numbers, money and refs', () => {
    expect(clock('2026-11-09T08:12:03', true)).toBe('08:12:03');
    expect(clock('2026-11-09T08:12:03')).toBe('08:12');
    expect(clock('nope')).toBe('');
    expect(compact(i18n, 112_000)).toBe('112k');
    expect(compact(i18n, 4_100)).toBe('4.1k');
    expect(money(i18n, 4.1)).toBe('$4.10');
    expect(money(i18n, 15)).toBe('$15');
    expect(shortRef('e4b9a7d3c02e71c0')).toBe('e4b9…71c0');
    expect(shortRef('abc')).toBe('abc');
  });
});

describe('statusLine', () => {
  it('reads the board 8a line', () => {
    const line = statusLine(i18n, demoSnapshot());
    expect(line.running).toBe(true);
    expect(line.text).toBe('Running since 08:12 · pid 18240 · 4 components · 2 runs live · $4.10 of $15 today');
  });
  it('omits the money, and the limit, when unknown', () => {
    expect(statusLine(i18n, { ...demoSnapshot(), spend: null }).text).not.toContain('today');
    expect(statusLine(i18n, { ...demoSnapshot(), spend: { spent: 2, limit: null } }).text).toContain('$2 today');
  });
  it('reads stopped for a null snapshot or a stopped service', () => {
    expect(statusLine(i18n, null)).toEqual({ running: false, text: 'Service not running' });
    expect(statusLine(i18n, { ...demoSnapshot(), running: false }).running).toBe(false);
  });
});

describe('componentRows', () => {
  const now = Date.now();
  const rows = componentRows(i18n, demoSnapshot(), demoRuns(), now);

  it('draws the five rows with their detail lines', () => {
    expect(rows.map((row) => row.name)).toEqual([
      'Tickets engine',
      'Crew runner',
      'MCP server',
      'Remote gateway',
      'Local model (LM Studio)',
    ]);
    expect(rows[0]?.detail).toBe('127.0.0.1:52114 · vault drey-tickets');
    expect(rows[1]?.detail).toBe('2 runs live · 1:1 with Ben idle 4 min');
    expect(rows[3]?.detail).toBe('off · phones and iPad');
    expect(rows[4]?.detail).toBe('not reachable · last seen 07:40');
    expect(rows.map((row) => row.dot)).toEqual(['running', 'running', 'running', 'off', 'failed']);
  });

  it('gives buttons per row', () => {
    expect(rows.map((row) => row.buttons.map((button) => button.action))).toEqual([
      ['restart'],
      ['restart', 'stop'],
      [],
      ['start'],
      [],
    ]);
    expect(rows[1]?.buttons[0]?.label).toBe('Restart Crew runner');
  });

  it('offers start while the runner sleeps and says asleep', () => {
    const asleep = componentRows(
      i18n,
      withComponents({ runner: { state: 'sleeping', reason: null, liveRuns: 0 } }),
      [],
      now,
    );
    expect(asleep[1]?.detail).toBe('asleep');
    expect(asleep[1]?.buttons.map((button) => button.action)).toEqual(['restart', 'start']);
  });

  it('shows the failure reason and a running gateway with its devices', () => {
    const failed = componentRows(
      i18n,
      withComponents({
        runner: { state: 'failed', reason: 'port in use', liveRuns: 0 },
        gateway: { state: 'running', address: '192.168.1.5:8443', devices: 2, reason: null },
        model: { reachable: null, name: null, lastSeen: null },
      }),
      [],
      now,
    );
    expect(failed[1]?.detail).toBe('port in use');
    expect(failed[3]?.detail).toBe('192.168.1.5:8443 · 2 paired devices');
    expect(failed[3]?.buttons.map((button) => button.action)).toEqual(['restart', 'stop']);
    expect(failed[4]?.name).toBe('Local model');
    expect(failed[4]?.detail).toBe('');
  });

  it('has no rows without a snapshot', () => {
    expect(componentRows(i18n, null, [], now)).toEqual([]);
  });
});

describe('slotRows and governorRows', () => {
  it('draws seats, bars, quota text and reliability', () => {
    const rows = slotRows(i18n, demoSnapshot().slots);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ label: 'Claude A', seats: [true, false], fill: 62, reliabilityLabel: 'measured' });
    expect(rows[0]?.text).toMatch(/^62 % · q 1\.4 · resets Mon \d\d:\d\d$/);
    expect(rows[2]).toMatchObject({ seats: [true, false, false], reliability: 'estimated' });
    expect(rows[3]).toMatchObject({ fill: null, text: '184,000 tokens counted', reliabilityLabel: 'counted' });
  });
  it('req-317: without a share the row says what was counted, or that nothing ran yet', () => {
    const slot = { id: 'openai', label: 'OpenAI', busy: 0, total: 1, left: null, q: null, resetsAt: null, reliability: 'unknown' as const };
    const text = (used: number | null, unit: 'tokens' | 'runs' | null): string | undefined => slotRows(i18n, [{ ...slot, used, unit }])[0]?.text;
    expect(text(null, null)).toBe('no runs yet');
    expect(text(0, 'tokens')).toBe('no runs yet');
    expect(text(1, 'runs')).toBe('1 run counted');
    expect(text(12, 'runs')).toBe('12 runs counted');
    expect(text(2_500_000, 'tokens')).toBe('2,500,000 tokens counted');
    expect(slotRows(i18n, [{ ...slot, left: 0.4, used: 5, unit: 'tokens' }])[0]).toMatchObject({ fill: 40, text: '40 %' });
  });
  it('draws no rows while the runner sleeps', () => {
    expect(slotRows(i18n, null)).toEqual([]);
  });
  it('draws the governor as board 8a writes it (req-180)', () => {
    const snapshot = demoSnapshot();
    const rows = governorRows(i18n, snapshot.load, snapshot.governor);
    expect(rows.map((row) => row.label)).toEqual(['Heavy seats', 'Light seats', 'Reserve', 'Waiting', 'Dev servers']);
    expect(rows.map((row) => row.value)).toEqual([
      '1 of 2 busy · tests for T-0126',
      '2 of 6 busy',
      '25 % CPU and RAM kept free · load 41 %',
      '1 heavy task (build T-0121) · starts when a seat frees',
      '1 · port 4302 (T-0126)',
    ]);
  });
  it('says when a wait ends: the quiet span, the load; several tasks counted', () => {
    const base = demoSnapshot().governor!;
    const quiet = { ...base, quietUntil: '07:00', waiting: [{ ticket: 'T-1', task: 'build', cause: 'quiet' as const }, { ticket: 'T-2', task: 'tests', cause: 'quiet' as const }] };
    expect(governorRows(i18n, demoSnapshot().load, quiet)[3]?.value).toBe('2 heavy tasks (build T-1, tests T-2) · starts at 07:00');
    const load = { ...base, waiting: [{ ticket: 'T-3', task: 'command', cause: 'load' as const }] };
    expect(governorRows(i18n, demoSnapshot().load, load)[3]?.value).toBe('1 heavy task (command T-3) · starts when the load drops');
  });
  it('draws an idle governor while the runner sleeps: nothing busy, nothing waits, the load unmeasured', () => {
    const rows = governorRows(i18n, demoSnapshot().load, null);
    expect(rows.map((row) => row.value)).toEqual(['0 of 2 busy', '0 busy', '25 % CPU and RAM kept free', 'none', 'none']);
  });
});

describe('log rows', () => {
  const lines = demoLog();
  it('filters by level and component', () => {
    expect(logRows(lines, 'all', 'all')).toHaveLength(14);
    expect(logRows(lines, 'warn', 'all').map((row) => row.level)).toEqual(['warn', 'error']);
    expect(logRows(lines, 'error', 'all')).toHaveLength(1);
    expect(logRows(lines, 'all', 'engine')).toHaveLength(1);
    expect(logRows(lines, 'all', 'all')[0]?.time).toBe('08:12:03');
  });
  it('keeps the last 2000 lines', () => {
    const many = Array.from({ length: LOG_LIMIT + 5 }, (_, index) => ({ ...lines[0]!, message: String(index) }));
    const kept = appendLog([], many);
    expect(kept).toHaveLength(LOG_LIMIT);
    expect(kept[0]?.message).toBe('5');
  });
});
