import { describe, expect, it } from 'vitest';
import { scopeNarrows, scopeVaultIds, type ScopeSources } from './workspace-scope';

const VAULTS = [
  { id: 'v1', name: 'Drey notes' },
  { id: 'v2', name: 'Work notes' },
  { id: 'v3', name: 'Private' },
];

function option(
  sources: { readonly vaults: readonly { readonly name: string }[]; readonly folders: readonly string[] } | null,
): ScopeSources {
  return { sources };
}

describe('scopeVaultIds', () => {
  it('is null without a choice or for a choice that does not narrow', () => {
    expect(scopeVaultIds(null, VAULTS)).toBeNull();
    expect(scopeVaultIds(option(null), VAULTS)).toBeNull();
    expect(scopeNarrows(null)).toBe(false);
    expect(scopeNarrows(option(null))).toBe(false);
  });

  it('resolves the named vaults to this device’s ids and drops unknown names', () => {
    const ids = scopeVaultIds(
      option({
        vaults: [{ name: 'Drey notes' }, { name: 'Work notes' }, { name: 'Elsewhere' }],
        folders: ['E:/specs'],
      }),
      VAULTS,
    );
    expect([...(ids ?? [])].sort()).toEqual(['v1', 'v2']);
    expect(scopeNarrows(option({ vaults: [], folders: [] }))).toBe(true);
  });
});
