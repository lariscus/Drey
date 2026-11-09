/** The log panel's rows: level and component filters, the time column. */
import type { LogLevel, LogLine } from '../../../../../shared/service-window/contract';
import { clock } from './format';

export type LevelFilter = 'all' | 'warn' | 'error';
export type ComponentFilter = 'all' | 'service' | 'engine' | 'runner' | 'gateway';

export const LOG_LIMIT = 2000;

export interface LogRowVm {
  readonly time: string;
  readonly message: string;
  readonly level: LogLevel;
  readonly key: number;
}

function passesLevel(level: LogLevel, filter: LevelFilter): boolean {
  if (filter === 'all') {
    return true;
  }
  return filter === 'error' ? level === 'error' : level === 'warn' || level === 'error';
}

export function logRows(
  lines: readonly LogLine[],
  level: LevelFilter,
  component: ComponentFilter,
): readonly LogRowVm[] {
  const rows: LogRowVm[] = [];
  lines.forEach((line, key) => {
    if (passesLevel(line.level, level) && (component === 'all' || line.component === component)) {
      rows.push({ time: clock(line.at, true), message: line.message, level: line.level, key });
    }
  });
  return rows;
}

/** Appends and keeps the last {@link LOG_LIMIT}. */
export function appendLog(lines: readonly LogLine[], more: readonly LogLine[]): readonly LogLine[] {
  const all = [...lines, ...more];
  return all.length > LOG_LIMIT ? all.slice(all.length - LOG_LIMIT) : all;
}
