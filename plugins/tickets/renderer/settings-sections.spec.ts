// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- the spec stands in for the host, which owns the catalog at runtime
import { i18n } from '../../../shared/i18n';
import { TICKETS_ENTRIES, TICKETS_SECTIONS, ticketsEntries, ticketsSections } from './settings-sections';

describe('Settings -> Tickets sections (E13-22)', () => {
  it('has unique section ids and every entry points at a declared section', () => {
    const ids = TICKETS_SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of TICKETS_ENTRIES) {
      expect(ids, entry.key).toContain(entry.section);
    }
  });

  it('has unique entry keys', () => {
    const keys = TICKETS_ENTRIES.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('Settings -> Tickets, the board 7g sections and rows', () => {
  it('lists the six headings of the board first, in its order', () => {
    expect(TICKETS_SECTIONS.slice(0, 6).map((s) => s.label)).toEqual([
      'Crew',
      'Flow',
      'Autopilot',
      'Budget and runners',
      'Walkthrough videos',
      'Devices',
    ]);
  });
  it('finds the two Autopilot rows under Autopilot', () => {
    const rows = TICKETS_ENTRIES.filter((e) => e.key.startsWith('autopilot'));
    expect(rows.map((e) => e.label)).toEqual(['Autopilot', 'Resume paused autopilot at']);
    expect(rows.every((e) => e.section === 'autopilot')).toBe(true);
  });
  it('gives every entry a scope', () => {
    expect(TICKETS_ENTRIES.every((e) => e.scope !== undefined)).toBe(true);
  });
});

describe('Settings -> Tickets, board 7l (req-186)', () => {
  it('puts Models right after Autopilot, as the board 7l nav has it', () => {
    expect(ticketsSections(i18n).map((s) => s.label).slice(0, 5)).toEqual(['Crew', 'Flow', 'Autopilot', 'Models', 'Budget and runners']);
  });
  it('points every entry at a section of the page, the Models ones included', () => {
    const ids = ticketsSections(i18n).map((s) => s.id);
    const entries = ticketsEntries(i18n);
    for (const entry of entries) {
      expect(ids, entry.key).toContain(entry.section);
    }
    expect(new Set(entries.map((e) => e.key)).size).toBe(entries.length);
    expect(entries.filter((e) => e.section === 'models').length).toBeGreaterThan(0);
  });
});
