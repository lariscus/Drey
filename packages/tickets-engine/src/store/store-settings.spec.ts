import { describe, expect, it } from 'vitest';

import type { TicketRecord } from '../ports/ticket-store';
import { groupByStage, readStoreSettings, UNCONFIGURED_STORE } from './store-settings';

const rec = (id: string, stage: string): TicketRecord => ({
  id, stage, title: id, owner: null, priority: null, kind: null, epoch: null, rev: null, labels: [], dependsOn: [], parent: null,
  claimedAt: null, leaseUntil: null, size: null, branch: null, repos: [], extensions: {},
});

describe('store settings', () => {
  it('reads the keys, trimmed', async () => {
    const values: Record<string, string> = { 'dk.path': ' C:\\x\\dk.exe ', 'dk.store': 'E:\\scratch' };
    const settings = await readStoreSettings(<T>(key: string) => Promise.resolve(values[key] as T | undefined));
    expect(settings).toEqual({ dkPath: 'C:\\x\\dk.exe', dkStore: 'E:\\scratch', dkDataDir: '', dkCheckout: '', dkSyncSeconds: 30 });
  });

  it('is the unconfigured store with nothing set', async () => {
    expect(await readStoreSettings(() => Promise.resolve(undefined))).toEqual(UNCONFIGURED_STORE);
  });
});

describe('groupByStage', () => {
  it('orders known stages as a ticket travels, the rest alphabetically, tickets by id', () => {
    const cols = groupByStage([rec('T-0003', 'zeta'), rec('T-0002', 'review'), rec('T-0001', 'open'), rec('T-0004', 'alpha'), rec('T-0000', 'open')]);
    expect(cols.map((c) => c.stage)).toEqual(['open', 'review', 'alpha', 'zeta']);
    expect(cols[0]!.tickets.map((t) => t.id)).toEqual(['T-0000', 'T-0001']);
  });
});
