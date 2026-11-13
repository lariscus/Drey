/** Which vaults a Tasks-mode query reads (`task-scope.ts`), project scope included (SDK 1.59). */
import { describe, expect, it } from 'vitest';
import type { WorkspaceScopeOption } from '../../../shared/plugin-api/renderer';
import { taskScopeVaults } from './task-scope.js';

const VAULTS = [
  { id: 'v1', name: 'Drey notes' },
  { id: 'v2', name: 'Work notes' },
  { id: 'v3', name: 'Private' },
];
const DREY: WorkspaceScopeOption = {
  id: 'drey',
  label: 'Drey',
  color: '#8ecbef',
  sources: {
    vaults: [
      { name: 'Drey notes', readOnly: false },
      { name: 'Private', readOnly: true },
    ],
    folders: [],
  },
};

const sorted = (ids: ReadonlySet<string> | null): string[] | null => (ids === null ? null : [...ids].sort());

describe('taskScopeVaults', () => {
  it('keeps the active vault, or every vault', () => {
    expect(sorted(taskScopeVaults('vault', 'v2', DREY, VAULTS))).toEqual(['v2']);
    expect(sorted(taskScopeVaults('vault', null, DREY, VAULTS))).toEqual([]);
    expect(taskScopeVaults('all', 'v2', DREY, VAULTS)).toBeNull();
  });

  it('restricts the project scope to the vaults the choice names', () => {
    expect(sorted(taskScopeVaults('project', 'v2', DREY, VAULTS))).toEqual(['v1', 'v3']);
  });

  it('reads a project scope without a narrowing choice as the vault scope', () => {
    expect(sorted(taskScopeVaults('project', 'v2', null, VAULTS))).toEqual(['v2']);
    expect(
      sorted(taskScopeVaults('project', 'v2', { ...DREY, sources: null }, VAULTS)),
    ).toEqual(['v2']);
  });
});
