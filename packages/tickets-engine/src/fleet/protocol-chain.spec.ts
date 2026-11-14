import { describe, expect, it } from 'vitest';
import { normalizeChainStore } from './protocol-chain';

describe('normalizeChainStore', () => {
  it('keeps the store target and the lifecycle flag of a persona board (the runner plans by holder only with it)', () => {
    expect(normalizeChainStore({ dkStore: 'E:/s', dkDataDir: 'E:/d', trailers: true, lifecycle: true })).toEqual({ dkPath: '', dkStore: 'E:/s', dkDataDir: 'E:/d', dkCheckout: '', trailers: true, lifecycle: true });
    expect(normalizeChainStore({ store: 'E:/s', bin: 'dk' })).toEqual({ dkPath: 'dk', dkStore: 'E:/s', dkDataDir: '', dkCheckout: '', trailers: false });
  });

  it('reads a lifecycle value that is not true as a phase-stage store, and a body without a store as none', () => {
    expect(normalizeChainStore({ dkStore: 'E:/s', lifecycle: 'yes' })).not.toHaveProperty('lifecycle');
    expect(normalizeChainStore({ lifecycle: true })).toBeNull();
    expect(normalizeChainStore(null)).toBeNull();
  });
});
