/**
 * The wording helpers of the assistant panel (`tool-format.ts`): pure
 * text functions, tested without a DOM.
 */
import { describe, expect, it } from 'vitest';
import {
  ARGUMENT_SUMMARY_MAX,
  firstLine,
  formatArguments,
  parseTasksResult,
  runningToolLabel,
  summarizeArguments,
  taskFilterLabelParts,
  toolDisplayName,
  vaultScopeTitle,
} from './tool-format.js';

describe('parseTasksResult', () => {
  it('reads one record per JSON line', () => {
    const content = [
      JSON.stringify({ text: 'Write report', path: 'a.md', line: 3 }),
      '',
      JSON.stringify({ text: 'Call Anna', path: 'b.md', line: 7 }),
    ].join('\n');
    const { records, truncated } = parseTasksResult(content);
    expect(records.map((record) => record.text)).toEqual(['Write report', 'Call Anna']);
    expect(truncated).toBe(0);
  });

  it('picks up the truncation note', () => {
    const content = [
      JSON.stringify({ text: 'Write report', path: 'a.md' }),
      JSON.stringify({ truncated: 12 }),
    ].join('\n');
    expect(parseTasksResult(content).truncated).toBe(12);
  });

  it('skips lines that are not task records', () => {
    const content = ['No tasks found.', '[1, 2]', JSON.stringify({ text: 'no path' })].join('\n');
    expect(parseTasksResult(content)).toEqual({ records: [], truncated: 0 });
  });
});

describe('taskFilterLabelParts', () => {
  it('names tag, text and overdue', () => {
    expect(taskFilterLabelParts('{"tag":"#work","text":" report ","overdue":true}')).toEqual([
      '#work',
      '"report"',
      'overdue',
    ]);
  });

  it('prefers the completed-since date over the plain status', () => {
    expect(taskFilterLabelParts('{"status":"done","completedSince":"2026-10-01"}')).toEqual([
      'completed since 2026-10-01',
    ]);
    expect(taskFilterLabelParts('{"status":"done"}')).toEqual(['completed']);
  });

  it('marks included done tasks', () => {
    expect(taskFilterLabelParts('{"includeDone":true}')).toEqual(['done included']);
    expect(taskFilterLabelParts('{"status":"all"}')).toEqual(['done included']);
  });

  it('yields nothing for empty or unparseable arguments', () => {
    expect(taskFilterLabelParts('')).toEqual([]);
    expect(taskFilterLabelParts('not json')).toEqual([]);
    expect(taskFilterLabelParts('[]')).toEqual([]);
  });
});

describe('firstLine', () => {
  it('takes the first non-blank line', () => {
    expect(firstLine('\n  \nfirst\nsecond')).toBe('first');
  });

  it('cuts a long line at 60 characters', () => {
    expect(firstLine('x'.repeat(80))).toBe(`${'x'.repeat(60)}…`);
  });
});

describe('toolDisplayName', () => {
  it('reads an external MCP tool as "server · tool"', () => {
    expect(toolDisplayName('mcp__github__list_issues')).toBe('github · list_issues');
  });

  it('leaves a built-in tool name as it is', () => {
    expect(toolDisplayName('vault_search')).toBe('vault_search');
  });
});

describe('runningToolLabel', () => {
  const tool = { name: 'vault_read', argsJson: '{"path":"a.md"}' };

  it('marks a running call, names a failed one, and leaves a finished one plain', () => {
    expect(runningToolLabel({ ...tool, state: 'running' })).toBe('tool · vault_read(path: a.md) …');
    expect(runningToolLabel({ ...tool, state: 'failed' })).toBe(
      'tool · vault_read(path: a.md) — failed',
    );
    expect(runningToolLabel({ ...tool, state: 'done' })).toBe('tool · vault_read(path: a.md)');
  });

  it('shows arguments that are not JSON as they are', () => {
    expect(runningToolLabel({ name: 'x', argsJson: '{path', state: 'done' })).toBe('tool · x(path)');
  });
});

describe('summarizeArguments', () => {
  it('reads a JSON string as its key: value pairs', () => {
    expect(summarizeArguments('{"query":"x"}')).toBe('query: x');
    expect(summarizeArguments('{}')).toBe('');
  });

  it('lists an object as key: value pairs, cut at 60 characters', () => {
    expect(summarizeArguments({ query: 'x', limit: 5 })).toBe('query: x, limit: 5');
    expect(summarizeArguments({ query: 'y'.repeat(80) })).toHaveLength(ARGUMENT_SUMMARY_MAX);
  });

  // D-77: the model's arguments are the provider's raw JSON string; the
  // chip head used to print all of it (a vault_edit's whole edits).
  const LONG_EDIT = {
    path: 'tickets/t/0000/t-1/ticket.md',
    edits: [
      { old_text: 'To be filled in the plan phase.', new_text: '1. **Research:** ' + 'long paragraph. '.repeat(40) },
      { old_text: 'x', new_text: 'y\nz' },
    ],
  };

  it('keeps a long vault_edit call to its target on one line, as a string or an object', () => {
    for (const args of [JSON.stringify(LONG_EDIT), LONG_EDIT]) {
      expect(summarizeArguments(args)).toBe('path: tickets/t/0000/t-1/ticket.md');
    }
    expect(runningToolLabel({ name: 'vault_edit', argsJson: JSON.stringify(LONG_EDIT), state: 'done' })).toBe(
      'tool · vault_edit(path: tickets/t/0000/t-1/ticket.md)',
    );
  });

  it('cuts arguments that do not parse (a streamed round still in flight) hard and on one line', () => {
    const partial = `{"path":"tickets/t/0000/t-1/ticket.md","edits":[{"old_text":"a\\nb","new_text":"${'w '.repeat(200)}`;
    const head = summarizeArguments(partial);
    expect(head.length).toBeLessThanOrEqual(ARGUMENT_SUMMARY_MAX);
    expect(head).not.toContain('\n');
    expect(head.startsWith('"path":"tickets/t/0000')).toBe(true);
  });

  it('leaves the full arguments to the expanded chip', () => {
    expect(formatArguments(JSON.stringify(LONG_EDIT))).toContain('long paragraph.');
  });

  it('is empty for anything else', () => {
    expect(summarizeArguments(null)).toBe('');
    expect(summarizeArguments(7)).toBe('');
  });
});

describe('formatArguments', () => {
  it('pretty-prints a JSON string', () => {
    expect(formatArguments('{"a":1}')).toBe('{\n  "a": 1\n}');
  });

  it('keeps a string that is not JSON', () => {
    expect(formatArguments('plain')).toBe('plain');
  });

  it('pretty-prints an object', () => {
    expect(formatArguments({ a: 1 })).toBe('{\n  "a": 1\n}');
  });
});

describe('vaultScopeTitle', () => {
  const vaults = [
    { id: 'v1', name: 'Notes', active: true },
    { id: 'v2', name: 'Docs', active: false },
  ];
  const state = (scope: 'off' | 'vault' | 'all' | 'custom', ids: string[] = []) => ({
    vaultScope: () => scope,
    vaults: () => vaults,
    customVaultIds: () => ids,
  });

  it('describes the fixed scopes', () => {
    expect(vaultScopeTitle(state('off'))).toContain('pick which vaults');
    expect(vaultScopeTitle(state('vault'))).toContain('the active vault');
    expect(vaultScopeTitle(state('all'))).toContain('across every vault');
  });

  it('names a custom selection', () => {
    expect(vaultScopeTitle(state('custom', ['v2', 'v1']))).toContain('sections of Docs, Notes.');
  });

  it('counts a custom selection with an unknown vault', () => {
    expect(vaultScopeTitle(state('custom', ['v2', 'gone']))).toContain('sections of 2 vaults.');
  });
});
