import { isLifecycleStageSet } from '../core/lifecycle-stages';
import { tomlList, tomlString, tomlTable } from './store-config-text';

/**
 * A dricket store's stage vocabulary (R-03, req-265): `[stages]` of `dricket.toml`. Read only: Drey never writes it.
 */
export interface StoreStageSet {
  readonly values: readonly string[];
  readonly initial: string | null;
  readonly terminal: readonly string[];
  readonly claim: readonly string[];
  readonly cancelled: string | null;
}

/** The `[stages]` table of a `dricket.toml` text; null when it has none (dk's built-in stages apply). */
export function parseStoreStages(toml: string): StoreStageSet | null {
  const table = tomlTable(toml, 'stages');
  if (table === null) {
    return null;
  }
  const values = tomlList(table, 'values') ?? [];
  if (values.length === 0) {
    return null;
  }
  return {
    values,
    initial: tomlString(table, 'initial'),
    terminal: tomlList(table, 'terminal') ?? [],
    claim: tomlList(table, 'claim') ?? [],
    cancelled: tomlString(table, 'cancelled'),
  };
}

/** True for a store on the lifecycle stages (`active`, `running`, `claim = ["running"]`). */
export function isLifecycleStore(stages: StoreStageSet | null): boolean {
  return stages !== null && isLifecycleStageSet(stages.values, stages.claim);
}
