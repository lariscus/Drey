/** A run's normalized stream as the Stream, Tool calls and Raw JSON views draw it (board 8b). */
import type { I18n } from '../../../../../shared/i18n';
import type { SessionRun, StreamEvent } from '../../../../../shared/service-window/contract';
import { clock, compact } from './format';

export type StreamKind = 'system' | 'user' | 'assistant' | 'tool' | 'error' | 'usage' | 'result';

export interface StreamRowVm {
  readonly key: number;
  readonly time: string;
  readonly kind: string;
  readonly text: string;
  readonly tone: 'normal' | 'error';
}

export interface McpStats {
  readonly calls: number;
  readonly refused: number;
  readonly servers: readonly string[];
}

const USER_PREFIX = 'you › ';

export function isToolFailure(event: StreamEvent): boolean {
  // i18n-ignore: the harness's own error marker, not UI text
  return event.detail === 'failed' || (event.text ?? '').includes('Error:');
}

function usageTurns(events: readonly StreamEvent[], run: SessionRun | null): Map<number, number> {
  const indexes = events.flatMap((event, index) => (event.kind === 'usage' && event.turnUsage ? [index] : []));
  const last = run?.turns ?? indexes.length;
  const turns = new Map<number, number>();
  indexes.forEach((eventIndex, order) => turns.set(eventIndex, last - (indexes.length - 1 - order)));
  return turns;
}

function usageText(i18n: I18n, event: StreamEvent, turn: number): string {
  const usage = event.turnUsage ?? {};
  const cached = usage.cacheRead ?? 0;
  const params = {
    turn,
    input: compact(i18n, usage.input ?? 0),
    cached: compact(i18n, cached),
    output: compact(i18n, usage.output ?? 0),
  };
  return i18n.t(cached > 0 ? 'service_window.stream.usage' : 'service_window.stream.usage_plain', params);
}

function rowOf(
  i18n: I18n,
  event: StreamEvent,
  key: number,
  turns: ReadonlyMap<number, number>,
): StreamRowVm | null {
  const base = { key, time: clock(event.ts, true) };
  const text = event.text ?? '';
  const make = (kind: StreamKind, body: string, tone: 'normal' | 'error' = 'normal'): StreamRowVm => ({
    ...base,
    kind: i18n.t(`service_window.kind.${kind}`),
    text: body,
    tone,
  });
  switch (event.kind) {
    case 'note':
      return text.startsWith(USER_PREFIX) ? make('user', text.slice(USER_PREFIX.length)) : make('system', text);
    case 'text':
      return make('assistant', text);
    case 'text-delta':
      return event.detail === 'end' ? make('assistant', text) : null;
    case 'tool':
      return event.detail === 'running' ? null : make('tool', text, isToolFailure(event) ? 'error' : 'normal');
    case 'error':
      return make('error', text, 'error');
    case 'usage':
      return event.turnUsage ? make('usage', usageText(i18n, event, turns.get(key) ?? 1)) : null;
    case 'result':
      return make('result', text);
  }
}

export function streamRows(
  i18n: I18n,
  events: readonly StreamEvent[],
  run: SessionRun | null,
): readonly StreamRowVm[] {
  const turns = usageTurns(events, run);
  const rows: StreamRowVm[] = [];
  events.forEach((event, key) => {
    const row = rowOf(i18n, event, key, turns);
    if (row !== null) {
      rows.push(row);
    }
  });
  return rows;
}

export function toolRows(
  i18n: I18n,
  events: readonly StreamEvent[],
  run: SessionRun | null,
): readonly StreamRowVm[] {
  const toolKind = i18n.t('service_window.kind.tool');
  return streamRows(i18n, events, run).filter((row) => row.kind === toolKind);
}

export function rawRows(events: readonly StreamEvent[]): readonly string[] {
  return events.map((event) => JSON.stringify(event));
}

/** Calls of `mcp__<server>__<tool>`; a refusal is a failed call or an `Error:` text. */
export function mcpStats(events: readonly StreamEvent[]): McpStats {
  const servers: string[] = [];
  let calls = 0;
  let refused = 0;
  for (const event of events) {
    if (event.kind !== 'tool' || event.detail === 'running' || !(event.tool ?? '').startsWith('mcp__')) {
      continue;
    }
    calls += 1;
    refused += isToolFailure(event) ? 1 : 0;
    const server = (event.tool ?? '').split('__')[1] ?? '';
    if (server !== '' && !servers.includes(server)) {
      servers.push(server);
    }
  }
  return { calls, refused, servers };
}
