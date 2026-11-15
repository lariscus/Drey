import { describe, expect, it } from 'vitest';
import { normalizeChainStore } from './protocol-chain';

describe('normalizeChainStore', () => {
  it('keeps the store target (req-307: every store is a persona board, there is no lifecycle flag any more)', () => {
    expect(normalizeChainStore({ dkStore: 'E:/s', dkDataDir: 'E:/d', trailers: true })).toEqual({ dkPath: '', dkStore: 'E:/s', dkDataDir: 'E:/d', dkCheckout: '', trailers: true });
    expect(normalizeChainStore({ store: 'E:/s', bin: 'dk' })).toEqual({ dkPath: 'dk', dkStore: 'E:/s', dkDataDir: '', dkCheckout: '', trailers: false });
  });

  it('carries no lifecycle flag even when a body of an older sender sets one, and a body without a store is none', () => {
    expect(normalizeChainStore({ dkStore: 'E:/s', lifecycle: true })).not.toHaveProperty('lifecycle');
    expect(normalizeChainStore({ lifecycle: true })).toBeNull();
    expect(normalizeChainStore(null)).toBeNull();
  });
});
