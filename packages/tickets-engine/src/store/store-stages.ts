import { isLifecycleStageSet } from '../core/lifecycle-stages';
import { tomlList, tomlString, tomlTable } from './store-config-text';

/**
 * A dricket store's stage vocabulary (R-03, req-265): `[stages]` of `dricket.toml`. Read only here;
 * the one writer is the stage migration (on the owner's confirmation, Q-05's exception).
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

const list = (values: readonly string[]): string => `[${values.map((v) => `"${v}"`).join(', ')}]`;

/** The `[stages]` table as TOML text (no trailing newline). */
export function renderStageTable(stages: StoreStageSet): string {
  return [
    '[stages]',
    `values = ${list(stages.values)}`,
    ...(stages.initial === null ? [] : [`initial = "${stages.initial}"`]),
    `terminal = ${list(stages.terminal)}`,
    `claim = ${list(stages.claim)}`,
    ...(stages.cancelled === null ? [] : [`cancelled = "${stages.cancelled}"`]),
  ].join('\n');
}

/**
 * `toml` with its `[stages]` table replaced by `stages` (appended when it has none). Every other line —
 * comments, other tables, their order — stays byte for byte; the line ending of the file is kept.
 */
export function withStageTable(toml: string, stages: StoreStageSet): string {
  const eol = toml.includes('\r\n') ? '\r\n' : '\n';
  const lines = toml.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === '[stages]');
  const table = renderStageTable(stages).split('\n');
  if (start === -1) {
    const body = lines.join(eol).replace(/\s+$/, '');
    return `${body}${eol}${eol}${table.join(eol)}${eol}`;
  }
  const rest = lines.slice(start + 1);
  const next = rest.findIndex((line) => /^\s*\[[^\]"]*\]\s*$/.test(line));
  const tail = next === -1 ? [] : ['', ...rest.slice(next)];
  const out = [...lines.slice(0, start), ...table, ...tail].join(eol).replace(/\s+$/, '');
  return `${out}${eol}`;
}
