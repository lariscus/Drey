import { describe, expect, it } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- the spec stands in for the host, which owns the catalog at runtime
import { i18n } from '../../../../shared/i18n';
import type { QueueEntry } from '../../../../packages/tickets-engine/src/fleet/protocol';
import { queueWordsFor, queueWordsOf } from './queue-line';

const entry = (extra: Partial<QueueEntry> = {}): QueueEntry => ({
  ticket: 'T-0123',
  persona: 'ben',
  class: 'B',
  reason: 'capacity',
  line: 'waits for a B slot',
  detail: 'No class B session is free: Claude A 2 of 5.',
  position: 2,
  since: '2026-11-09T09:00:00Z',
  ...extra,
});

describe('the pool queue in words (req-186)', () => {
  it('composes the card line and the Work row line from the entry, the place only on the row', () => {
    const words = queueWordsOf(entry(), i18n);
    expect(words.short).toBe('queued · waits for a B slot');
    expect(words.full).toBe('queued · waits for a B slot · 2nd');
    expect(words.title).toBe('No class B session is free: Claude A 2 of 5. · 2nd');
  });

  it('names no class for a pinned model, and says what a full ledger or a missing model means', () => {
    expect(queueWordsOf(entry({ class: null }), i18n).short).toBe('queued · waits for a slot');
    expect(queueWordsOf(entry({ reason: 'ledger' }), i18n).short).toBe('queued · waits for budget');
    expect(queueWordsOf(entry({ reason: 'config', detail: '' }), i18n)).toMatchObject({ short: 'queued · no slot can serve it', title: 'no slot can serve it · 2nd' });
  });

  it('finds a ticket in the queue, null when the pool holds none for it', () => {
    expect(queueWordsFor([entry()], 'T-0123', i18n)?.short).toBe('queued · waits for a B slot');
    expect(queueWordsFor([entry()], 'T-0001', i18n)).toBeNull();
    expect(queueWordsFor(undefined, 'T-0123', i18n)).toBeNull();
  });
});
