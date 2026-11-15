// i18n: catalog
/**
 * The pool's queue on a card and a Work row (req-186, board 7e): a ticket
 * the capacity pool did not grant a session waits with `queued · waits for
 * a B slot · 2nd`. The words are composed here from the entry's fields —
 * the class, the reason, the place — not taken from the engine's English
 * `line`, so they come from the catalog.
 */
import type { QueueEntry } from '../../../../packages/tickets-engine/src/fleet/protocol';
import type { I18n } from '../../../../shared/i18n/types';

export interface QueueWords {
  /** `queued · waits for a B slot` — the card's right-hand words. */
  readonly short: string;
  /** `queued · waits for a B slot · 2nd` — the Work row's step words. */
  readonly full: string;
  /** The hover text: the reason as the engine words it, and the place. */
  readonly title: string;
}

function reasonOf(entry: QueueEntry, i18n: I18n): string {
  switch (entry.reason) {
    case 'capacity':
      return entry.class === null ? i18n.t('tickets.queue.waits_slot') : i18n.t('tickets.queue.waits_class', { class: entry.class });
    case 'ledger':
      return i18n.t('tickets.queue.waits_ledger');
    case 'config':
      return i18n.t('tickets.queue.waits_config');
  }
}

/** The words of one queue entry. */
export function queueWordsOf(entry: QueueEntry, i18n: I18n): QueueWords {
  const reason = reasonOf(entry, i18n);
  const place = i18n.t('capacity.queue.position', { n: entry.position });
  return {
    short: i18n.t('tickets.queue.line', { reason }),
    full: i18n.t('tickets.queue.line_position', { reason, position: place }),
    title: entry.detail === '' ? `${reason} · ${place}` : `${entry.detail} · ${place}`,
  };
}

/** The words of a ticket's place in the queue; null when the pool holds no entry for it. */
export function queueWordsFor(queue: readonly QueueEntry[] | undefined, ticket: string, i18n: I18n): QueueWords | null {
  const entry = queue?.find((candidate) => candidate.ticket === ticket);
  return entry === undefined ? null : queueWordsOf(entry, i18n);
}
