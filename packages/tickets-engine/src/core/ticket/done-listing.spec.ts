import { describe, expect, it } from 'vitest';
import { archivedEntriesOf, parseArchivedStamp, recentDoneOf } from './done-listing';

/** A ticket file with the given entered stamps and optional Log lines. */
function ticketFile(entries: {
  entered?: Record<string, string>;
  log?: string[];
  extra?: string;
}): string {
  const stamps = Object.entries(entries.entered ?? {})
    .map(([phase, stamp]) => `entered-${phase}: '${stamp}'`)
    .join('\n');
  return [
    '---',
    "id: T-0001",
    'title: "Drift"',
    'repo: drey',
    'priority: normal',
    'rank: 5000',
    'branch: t/T-0001',
    ...(stamps === '' ? [] : [stamps]),
    ...(entries.extra === undefined ? [] : [entries.extra]),
    '---',
    '',
    '## Description',
    '',
    'Body.',
    '',
    '## Log',
    '',
    ...(entries.log ?? ["- '2026-10-17T09:00:00Z' owner@desk — created in inbox"]),
    '',
  ].join('\n');
}

interface ArchiveFile {
  readonly path: string;
  readonly text: string;
}

describe('parseArchivedStamp', () => {
  it('finds the newest machine-shaped archived marker', () => {
    const text = ticketFile({
      log: [
        "- '2026-10-18T10:00:00Z' owner@desk — archived",
        "- '2026-10-17T09:00:00Z' owner@desk — inbox -> build",
        "- '2026-10-19T08:00:00Z' owner@desk — archived",
      ],
    });
    expect(parseArchivedStamp(text)).toBe('2026-10-19T08:00:00Z');
  });

  it('is null without a marker, and a revive line is not a marker', () => {
    expect(parseArchivedStamp(ticketFile({}))).toBeNull();
    const revived = ticketFile({
      log: ["- '2026-10-18T10:00:00Z' owner@desk — archive -> build"],
    });
    expect(parseArchivedStamp(revived)).toBeNull();
  });
});

describe('recentDoneOf (req-75 W1b)', () => {
  const NOW = Date.parse('2026-10-31T12:00:00Z');

  const archived = (id: string, stamp: string, title = `Ticket ${id}`): ArchiveFile => ({
    path: `tickets/archive/${id}.md`,
    text: [
      '---',
      `id: ${id}`,
      `title: "${title}"`,
      'priority: normal',
      '---',
      '## Log',
      '',
      `- '${stamp}' owner@desk — archived`,
      '',
    ].join('\n'),
  });

  it('keeps the last 7 days, newest first, with title and stamp', () => {
    const files = [
      archived('T-0001', '2026-10-25T12:00:01Z'), // exactly 6 days — in
      archived('T-0002', '2026-10-29T08:00:00Z', 'Newer'),
      archived('T-0003', '2026-10-24T11:59:59Z'), // 7 days and a second — out
      { path: 'tickets/10-inbox/T-0004.md', text: '' },
    ];
    expect(recentDoneOf(files, NOW)).toEqual([
      { id: 'T-0002', title: 'Newer', at: '2026-10-29T08:00:00Z' },
      { id: 'T-0001', title: 'Ticket T-0001', at: '2026-10-25T12:00:01Z' },
    ]);
  });

  it("carries the ticket's own project (req-298) and leaves it out when the ticket names none", () => {
    const own: ArchiveFile = { path: 'tickets/archive/T-0009.md', text: ['---', 'id: T-0009', 'title: "Mine"', 'project: home-lab', '---', '## Log', '', "- '2026-10-30T00:00:00Z' owner@desk — archived", ''].join('\n') };
    expect(recentDoneOf([own, archived('T-0010', '2026-10-29T00:00:00Z')], NOW)).toEqual([
      { id: 'T-0009', title: 'Mine', at: '2026-10-30T00:00:00Z', project: 'home-lab' },
      { id: 'T-0010', title: 'Ticket T-0010', at: '2026-10-29T00:00:00Z' },
    ]);
  });

  it('takes the NEWEST archived stamp, so a revived ticket counts from its re-archival', () => {
    const revived: ArchiveFile = {
      path: 'tickets/archive/T-0005.md',
      text: [
        "- '2026-10-01T00:00:00Z' owner@desk — archived",
        "- '2026-10-30T00:00:00Z' owner@desk — archived",
      ].join('\n'),
    };
    expect(recentDoneOf([archived('T-0006', '2026-10-02T00:00:00Z'), revived], NOW).map((d) => d.id)).toEqual([
      'T-0005',
    ]);
  });

  it('caps at 20 and breaks stamp ties by id', () => {
    const files = Array.from({ length: 25 }, (_, i) =>
      archived(`T-${String(i + 1).padStart(4, '0')}`, '2026-10-30T00:00:00Z'));
    const done = recentDoneOf(files, NOW);
    expect(done).toHaveLength(20);
    expect(done[0]!.id).toBe('T-0001');
    expect(done[19]!.id).toBe('T-0020');
  });

  it('ignores files without an archived marker and folders deeper in the archive', () => {
    const files = [
      { path: 'tickets/archive/T-0007.md', text: "## Log\n\n- '2026-10-30T00:00:00Z' owner@desk — created in inbox" },
      { path: 'tickets/archive/notes/T-0008.md', text: "## Log\n\n- '2026-10-30T00:00:00Z' owner@desk — archived" },
      { path: 'tickets/archive/readme.md', text: '' },
    ];
    expect(recentDoneOf(files, NOW)).toEqual([]);
  });
});

describe('archivedEntriesOf (E13-21 "Show older")', () => {
  const archived = (id: string, stamp: string | null, title = `Ticket ${id}`): ArchiveFile => ({
    path: `tickets/archive/${id}.md`,
    text: ['---', `id: ${id}`, `title: "${title}"`, '---', '## Log', '', ...(stamp === null ? [] : [`- '${stamp}' owner@desk — archived`]), ''].join('\n'),
  });

  it('lists every age, newest first, a ticket without a stamp last', () => {
    const files = [
      archived('T-0001', '2026-01-01T00:00:00Z'),
      archived('T-0002', '2026-10-01T00:00:00Z'),
      archived('T-0003', null),
      { path: 'tickets/10-inbox/T-0004.md', text: '' },
    ];
    expect(archivedEntriesOf(files).map((e) => [e.id, e.at])).toEqual([
      ['T-0002', '2026-10-01T00:00:00Z'],
      ['T-0001', '2026-01-01T00:00:00Z'],
      ['T-0003', ''],
    ]);
  });

  it('narrows by id or title words and honours the limit', () => {
    const files = [
      archived('T-0001', '2026-01-01T00:00:00Z', 'Fix the login'),
      archived('T-0002', '2026-02-01T00:00:00Z', 'Login page redesign'),
      archived('T-0003', '2026-03-01T00:00:00Z', 'Billing'),
    ];
    expect(archivedEntriesOf(files, { query: 'LOGIN' }).map((e) => e.id)).toEqual(['T-0002', 'T-0001']);
    expect(archivedEntriesOf(files, { query: 'login redesign' }).map((e) => e.id)).toEqual(['T-0002']);
    expect(archivedEntriesOf(files, { query: 't-0003' }).map((e) => e.id)).toEqual(['T-0003']);
    expect(archivedEntriesOf(files, { limit: 1 }).map((e) => e.id)).toEqual(['T-0003']);
  });
});
