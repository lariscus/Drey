/**
 * The Done-this-week and archive listings over ticket texts (req-75 W1b, E13-21): pure, no IO —
 * files in, rows out. The board's terminal column and the "Show older" archive both read the
 * store's archived records through it.
 */
import { TICKETS_ARCHIVE_DIR, type RecentDone, type TicketMeta } from '../contracts/tickets';
import { parseTicketFile } from './ticket-files';

/** The newest machine-shaped archive marker —
 *  `- '<stamp>' <who> — archived` — or null when the Log has none. */
export function parseArchivedStamp(text: string): string | null {
  let newest: string | null = null;
  for (const rawLine of text.split('\n')) {
    const match = /^-\s'([^']+)'.*—\sarchived\s*$/.exec(rawLine.trimEnd());
    if (match !== null && (newest === null || compareStamps(match[1]!, newest) > 0)) {
      newest = match[1]!;
    }
  }
  return newest;
}

/** How long a ticket stays in the Done-this-week group (req-75 W1b). */
const RECENT_DONE_MS = 7 * 24 * 60 * 60 * 1000;

/** At most this many rows in the Done-this-week group. */
const RECENT_DONE_MAX = 20;

/**
 * The Done-this-week rows (req-75 W1b): every `tickets/archive/*.md`
 * whose newest `— archived` Log stamp lies within the last 7 days,
 * newest first, at most 20 (stamp ties break by id). Pure — the board
 * service feeds it the file list it read anyway, so a refresh costs no
 * extra reads.
 */
export function recentDoneOf(
  files: readonly { readonly path: string; readonly text: string }[],
  nowMs: number,
): RecentDone[] {
  const prefix = `${TICKETS_ARCHIVE_DIR}/`;
  const found: (RecentDone & { t: number })[] = [];
  for (const file of files) {
    if (!file.path.startsWith(prefix) || !file.path.endsWith('.md') || file.path.slice(prefix.length).includes('/')) {
      continue;
    }
    const at = parseArchivedStamp(file.text);
    if (at === null) {
      continue;
    }
    const t = Date.parse(at);
    if (Number.isNaN(t) || nowMs - t > RECENT_DONE_MS) {
      continue;
    }
    const meta = parseTicketFile(file.text, file.path).meta;
    found.push({ id: file.path.slice(prefix.length, -'.md'.length), title: meta.title, at, ...projectOf(meta), t });
  }
  return found
    .sort((a, b) => (a.t !== b.t ? b.t - a.t : a.id < b.id ? -1 : 1))
    .slice(0, RECENT_DONE_MAX)
    .map(({ t: _t, ...entry }) => entry);
}

/** req-298: a done row's project — the ticket's own `project:`, left out when it names none. */
function projectOf(meta: { readonly project?: string }): { project?: string } {
  return meta.project === undefined || meta.project === '' ? {} : { project: meta.project };
}

/** The most older archived tickets one "Show older" request returns (E13-21). */
export const ARCHIVE_LISTING_MAX = 200;

/**
 * Every archived ticket, any age (E13-21 "Show older"): the archive files
 * with their newest `— archived` stamp (`''` when the Log has none, listed
 * last), newest first, ties by id. `query` narrows by id or title (case
 * insensitive, every word must hit). Pure, like {@link recentDoneOf}.
 */
export function archivedEntriesOf(
  files: readonly { readonly path: string; readonly text: string }[],
  options: { readonly query?: string; readonly limit?: number } = {},
): RecentDone[] {
  const prefix = `${TICKETS_ARCHIVE_DIR}/`;
  const words = (options.query ?? '').toLowerCase().split(/\s+/).filter((w) => w !== '');
  const found: (RecentDone & { t: number })[] = [];
  for (const file of files) {
    if (!file.path.startsWith(prefix) || !file.path.endsWith('.md') || file.path.slice(prefix.length).includes('/')) {
      continue;
    }
    const id = file.path.slice(prefix.length, -'.md'.length);
    const title = parseTicketFile(file.text, file.path).meta.title;
    const hay = `${id} ${title ?? ''}`.toLowerCase();
    if (!words.every((word) => hay.includes(word))) {
      continue;
    }
    const at = parseArchivedStamp(file.text) ?? '';
    const t = Date.parse(at);
    found.push({ id, title, at, t: Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t });
  }
  return found
    .sort((a, b) => (a.t !== b.t ? (a.t < b.t ? 1 : -1) : a.id < b.id ? -1 : 1))
    .slice(0, options.limit ?? ARCHIVE_LISTING_MAX)
    .map(({ id, title, at }) => ({ id, title, at }));
}

/** Stamp comparison: epoch when both parse as dates, else lexicographic. */
function compareStamps(a: string, b: string): number {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (!Number.isNaN(ta) && !Number.isNaN(tb) && ta !== tb) {
    return ta < tb ? -1 : 1;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}
