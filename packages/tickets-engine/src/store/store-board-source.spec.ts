import { describe, expect, it, vi } from 'vitest';
import { TicketStoreError, type TicketDetail, type TicketRecord, type TicketStore } from '../ports/ticket-store';
import { StoreBoardSource } from './store-board-source';
import { StoreReader } from './store-reader';
import type { StoreSettings } from './store-settings';

const PIPELINE = `---
phases:
  - { id: inbox, title: Inbox, handover: manual }
  - { id: done, title: Done, handover: none }
---
`;
const BASE = { vaultId: 'v', vaultName: 'v', activeVaultName: 'v', isGitRepo: true, defaultWorker: 'opencode', pipelineText: PIPELINE, reposText: null };
const SETTINGS: StoreSettings = { dkPath: '', dkStore: 'https://example.invalid/t.git#tickets', dkDataDir: '', dkCheckout: '', dkSyncSeconds: 30 };

function detail(id: string, rev: number, extra: Partial<TicketDetail> = {}): TicketDetail {
  return {
    id, stage: 'inbox', title: id, owner: null, priority: 'normal', kind: null, epoch: 0, rev, labels: [], dependsOn: [], parent: null,
    claimedAt: null, leaseUntil: null, size: null, branch: null, repos: [], extensions: {}, text: '', body: '', ...extra,
  };
}

function fakeStore(details: TicketDetail[]): TicketStore & { shows: string[] } {
  const shows: string[] = [];
  return {
    shows,
    capabilities: () => Promise.resolve({ comments: false, leases: true, version: 'v0.6.0' }),
    list: () => Promise.resolve(details.map<TicketRecord>((d) => ({ ...d }))),
    show: (id) => {
      shows.push(id);
      const found = details.find((d) => d.id === id);
      return found === undefined ? Promise.reject(new TicketStoreError('not-found', id)) : Promise.resolve(found);
    },
    claim: () => Promise.reject(new Error('read-only')),
    release: () => Promise.reject(new Error('read-only')),
    extend: () => Promise.reject(new Error('read-only')),
    comment: () => Promise.reject(new Error('read-only')),
    comments: () => Promise.resolve([]),
  };
}

describe('StoreReader', () => {
  it('re-reads only tickets whose row changed', async () => {
    const details = [detail('T-0001', 1), detail('T-0002', 1)];
    const store = fakeStore(details);
    const reader = new StoreReader(store, 2);
    expect((await reader.readAll()).map((d) => d.id)).toEqual(['T-0001', 'T-0002']);
    expect(store.shows).toEqual(['T-0001', 'T-0002']);
    await reader.readAll();
    expect(store.shows).toHaveLength(2);
    details[1] = detail('T-0002', 2);
    await reader.readAll();
    expect(store.shows).toEqual(['T-0001', 'T-0002', 'T-0002']);
  });

  it('keeps the list order whatever the parallelism', async () => {
    const details = Array.from({ length: 20 }, (_, i) => detail(`T-${String(i + 1).padStart(4, '0')}`, 1));
    const out = await new StoreReader(fakeStore(details), 5).readAll();
    expect(out.map((d) => d.id)).toEqual(details.map((d) => d.id));
  });
});

describe('StoreBoardSource', () => {
  it('builds the dricket board, or an empty one with an error issue when the store fails', async () => {
    const ok = new StoreBoardSource(vi.fn(), () => fakeStore([detail('T-0001', 1)]));
    const board = await ok.board(SETTINGS, BASE);
    expect(board.columns[0]!.tickets.map((t) => t.id)).toEqual(['T-0001']);
    const broken = new StoreBoardSource(vi.fn(), () => ({ ...fakeStore([]), list: () => Promise.reject(new Error('boom')) }));
    const empty = await broken.board(SETTINGS, BASE);
    expect(empty.columns.flatMap((c) => c.tickets)).toEqual([]);
    expect(empty.issues[0]).toEqual({ level: 'error', message: 'dricket store: boom' });
    const unset = await new StoreBoardSource(vi.fn()).board({ ...SETTINGS, dkStore: '' }, BASE);
    expect(unset.issues[0]!.message).toContain('tickets.dk.store');
  });
});
