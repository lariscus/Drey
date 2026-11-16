/**
 * How the assistant panel words what a turn carries: tool calls and
 * results, a `tasks_list` result's rows and filters, the Vault chip's
 * tooltip. Text in, text out -- no DOM, so it is tested directly.
 */
import type { SdkTaskRecord } from '../../../shared/plugin-api/renderer';
import type { AssistantState } from './state.js';

/** The `tasks_list` tool whose persisted result renders as a task block. */
export const TASKS_LIST_TOOL = 'tasks_list';

/** Parses one `tasks_list` tool result: JSON lines of records (+ a truncation note). */
export function parseTasksResult(content: string): {
  records: SdkTaskRecord[];
  truncated: number;
} {
  const records: SdkTaskRecord[] = [];
  let truncated = 0;
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') {
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const record = parsed as Record<string, unknown>;
        if (typeof record['text'] === 'string' && typeof record['path'] === 'string') {
          records.push(parsed as SdkTaskRecord);
        } else if (typeof record['truncated'] === 'number') {
          truncated = record['truncated'];
        }
      }
    } catch {
      // A stray line stays unparsed — the rows carry real data only.
    }
  }
  return { records, truncated };
}

/**
 * The filter chips one `tasks_list` call's arguments describe (57c):
 * `#tag`, quoted text terms, overdue, completed / done-included — rendered in the
 * block head so a filtered view explains itself. Unparseable args
 * (the `{"posthoc":true}` sentinel among them) yield no chips.
 */
export function taskFilterLabelParts(argsJson: string): string[] {
  try {
    const parsed: unknown = JSON.parse(argsJson || '{}');
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return [];
    }
    const args = parsed as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof args['tag'] === 'string' && args['tag'].trim() !== '') {
      parts.push(`#${args['tag'].trim().replace(/^#/, '')}`);
    }
    if (typeof args['text'] === 'string' && args['text'].trim() !== '') {
      parts.push(`"${args['text'].trim()}"`);
    }
    if (args['overdue'] === true) {
      parts.push('overdue');
    }
    const since = args['completedSince'];
    const hasSince = typeof since === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(since);
    if (args['status'] === 'done' || hasSince) {
      parts.push(hasSince ? `completed since ${since as string}` : 'completed');
    } else if (args['includeDone'] === true || args['status'] === 'all') {
      parts.push('done included');
    }
    return parts;
  } catch {
    return [];
  }
}

/** First line of a tool result, for the chip's summary line. */
export function firstLine(text: string): string {
  const line = text.split('\n').find((entry) => entry.trim() !== '') ?? '';
  return line.length > 60 ? `${line.slice(0, 60)}…` : line;
}

/** The Vault chip's tooltip: what the next ask searches (names when known). */
export function vaultScopeTitle(
  state: Pick<AssistantState, 'vaultScope' | 'vaults' | 'customVaultIds'>,
): string {
  const scope = state.vaultScope();
  if (scope === 'vault') {
    return 'Vault context: the most similar sections of the active vault. Click to change.';
  }
  if (scope === 'all') {
    return 'Vault context: the most similar sections across every vault. Click to change.';
  }
  if (scope === 'custom') {
    const byId = new Map(state.vaults().map((vault) => [vault.id, vault.name]));
    const ids = state.customVaultIds();
    const names = ids.map((id) => byId.get(id));
    const listed = names.every((name) => name !== undefined)
      ? (names as string[]).join(', ')
      : `${ids.length} vault${ids.length === 1 ? '' : 's'}`;
    return `Vault context: the most similar sections of ${listed}. Click to change.`;
  }
  return 'Vault context: pick which vaults the assistant searches — the active one, all of them, or a selection.';
}

/** `mcp__<server>__<tool>` reads as "server · tool"; any other name as it is. */
export function toolDisplayName(name: string): string {
  const match = /^mcp__(.+?)__(.+)$/.exec(name);
  return match !== null ? `${match[1]} · ${match[2]}` : name;
}

/** The line of a tool call that is running or has just finished, in the streaming card. */
export function runningToolLabel(tool: {
  name: string;
  argsJson: string;
  state: 'running' | 'done' | 'failed';
}): string {
  const call = `tool · ${toolDisplayName(tool.name)}(${summarizeArguments(tool.argsJson)})`;
  return tool.state === 'running' ? `${call} …` : tool.state === 'failed' ? `${call} — failed` : call;
}

/** The most a call chip's argument summary shows: one short line, never the call's payload. */
export const ARGUMENT_SUMMARY_MAX = 60;

/** One line, whitespace collapsed, cut hard at {@link ARGUMENT_SUMMARY_MAX}. */
function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > ARGUMENT_SUMMARY_MAX ? `${flat.slice(0, ARGUMENT_SUMMARY_MAX - 1)}…` : flat;
}

/**
 * Compact argument summary for a call chip: the call's scalar arguments
 * (`path: a.md, limit: 5`), never a nested value — the `edits` of a
 * `vault_edit` are the payload and live in the expanded chip. A model's
 * arguments reach the chip as the provider's raw JSON string (persisted
 * as written, or still incomplete while a streamed round is in flight),
 * so a string is parsed first; one that does not parse is the raw text.
 * Whatever the shape, the result is one line of at most
 * {@link ARGUMENT_SUMMARY_MAX} characters (D-77).
 */
export function summarizeArguments(args: unknown): string {
  let value: unknown = args;
  if (typeof args === 'string') {
    try {
      value = JSON.parse(args);
    } catch {
      return oneLine(args.replace(/^\{|\}$/g, ''));
    }
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const parts = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => ['string', 'number', 'boolean'].includes(typeof entry))
      .map(([key, entry]) => `${key}: ${String(entry)}`);
    return oneLine(parts.join(', '));
  }
  return typeof value === 'string' ? oneLine(value) : '';
}

/** The full arguments of a call, pretty-printed for the expanded chip. */
export function formatArguments(args: unknown): string {
  if (typeof args === 'string') {
    try {
      return JSON.stringify(JSON.parse(args), null, 2);
    } catch {
      return args;
    }
  }
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}
