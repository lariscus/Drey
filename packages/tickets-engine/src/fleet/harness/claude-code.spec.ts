import { describe, expect, it } from 'vitest';
import { telemetryFromEvents } from '../telemetry';
import type { SpawnFn } from '../ports/process-spawner';
import { claudeCodeAdapter } from './claude-code';
import { collect, fakeProcess, spawnOf } from './worker-process.fake';

/**
 * The claude-code adapter against a scripted stream-json CLI (no real
 * binary): what the owner's live spike rounds verify against the installed
 * CLI, the specs pin as behavior.
 */

describe('the claude-code adapter', () => {
  it('spawns stream-json with the permission mode and feeds the instruction', async () => {
    const proc = fakeProcess();
    const { events, sessions, start } = collect();
    const handle = claudeCodeAdapter(spawnOf(proc)).spawn(start);
    expect(proc.stdinWrites[0]).toContain('"type":"user"');
    expect(proc.stdinWrites[0]).toContain('Do the ticket.');

    proc.stdout(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'ses_1' }));
    proc.stdout(JSON.stringify({
      type: 'result',
      usage: { input_tokens: 100, cache_read_input_tokens: 50, output_tokens: 30 },
      total_cost_usd: 0.12,
      result: 'done',
    }));
    proc.exit(0);

    await expect(handle.exited).resolves.toBe(0);
    expect(sessions).toEqual(['ses_1']);
    const result = events.find((e) => e.kind === 'result');
    expect(result?.tokensIn).toBe(150);
    expect(result?.cacheReadTokens).toBe(50);
    expect(result?.tokensOut).toBe(30);
    expect(result?.costUsd).toBe(0.12);
  });

  it('writes thinking, replies and tool calls into the transcript', () => {
    const proc = fakeProcess();
    const { events, start } = collect();
    claudeCodeAdapter(spawnOf(proc)).spawn(start);
    proc.stdout(JSON.stringify({
      type: 'assistant',
      message: {
        usage: { input_tokens: 10, cache_read_input_tokens: 5 },
        content: [
          { type: 'thinking', thinking: 'Look at the file first.' },
          { type: 'text', text: 'Reading it now.' },
          { type: 'tool_use', name: 'Read', input: { file_path: 'src/a.ts' } },
        ],
      },
    }));
    expect(events.map((e) => [e.kind, e.text ?? ''])).toEqual([
      ['note', 'thinking › Look at the file first.'],
      ['text', 'Reading it now.'],
      ['note', 'Read src/a.ts'],
      ['usage', ''],
    ]);
    expect(events.at(-1)?.contextTokens).toBe(15);
  });

  it('writes a tool result as an outcome note', () => {
    const proc = fakeProcess();
    const { events, start } = collect();
    claudeCodeAdapter(spawnOf(proc)).spawn(start);
    proc.stdout(JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'line one\nline two' }] } }));
    expect(events.map((e) => e.text)).toEqual(['result › line one']);
  });

  it('steer writes a user message into the held stdin (the injection rung)', async () => {
    const proc = fakeProcess();
    const { start } = collect();
    const handle = claudeCodeAdapter(spawnOf(proc)).spawn(start);
    const rung = await handle.steer('Change course');
    expect(rung).toBe('inject');
    expect(proc.stdinWrites.at(-1)).toContain('Change course');
  });

  it('reports the slash commands the CLI lists at init', () => {
    const proc = fakeProcess();
    const { events, start } = collect();
    claudeCodeAdapter(spawnOf(proc)).spawn(start);
    proc.stdout(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'ses_1', slash_commands: ['compact', '/cost'] }));
    expect(events.find((e) => e.commands !== undefined)?.commands).toEqual(['compact', 'cost']);
  });

  it('a finished turn closes the input unless the owner holds the worker', () => {
    const proc = fakeProcess();
    const { events, start } = collect();
    claudeCodeAdapter(spawnOf(proc)).spawn(start);
    proc.stdout(JSON.stringify({ type: 'result', usage: {}, result: 'done' }));
    expect(proc.stdinWrites.at(-1)).toBe('<<end>>');
    expect(events.at(-1)).toMatchObject({ kind: 'usage', turn: 'idle' });
  });

  it('a result that reports an error is an error event, not a completion', () => {
    const proc = fakeProcess();
    const { events, start } = collect();
    claudeCodeAdapter(spawnOf(proc)).spawn(start);
    proc.stdout(JSON.stringify({ type: 'result', subtype: 'error_max_turns', is_error: true, usage: {}, result: 'Reached max turns' }));
    expect(events.some((e) => e.kind === 'result')).toBe(false);
    expect(events.find((e) => e.kind === 'error')?.text).toContain('error_max_turns');
    expect(proc.stdinWrites.at(-1)).toBe('<<end>>');
  });

  it('a held worker stays open, takes another prompt and ends on release', async () => {
    const proc = fakeProcess();
    const { events, start } = collect();
    const handle = claudeCodeAdapter(spawnOf(proc)).spawn(start);
    handle.setHold?.(true);
    proc.stdout(JSON.stringify({ type: 'result', usage: {}, result: 'done' }));
    expect(proc.stdinWrites).not.toContain('<<end>>');

    expect(await handle.steer('One more thing')).toBe('inject');
    expect(proc.stdinWrites.at(-1)).toContain('One more thing');
    expect(events.at(-1)).toMatchObject({ kind: 'usage', turn: 'busy' });

    proc.stdout(JSON.stringify({ type: 'result', usage: {}, result: 'again' }));
    handle.setHold?.(false);
    expect(proc.stdinWrites.at(-1)).toBe('<<end>>');
    expect(await handle.steer('too late')).toBe('refused');
  });

  it('interrupt sends the control request only while a turn is running', async () => {
    const proc = fakeProcess();
    const { start } = collect();
    const handle = claudeCodeAdapter(spawnOf(proc)).spawn(start);
    handle.setHold?.(true);
    expect(await handle.interrupt?.()).toBe(true);
    const written = JSON.parse(proc.stdinWrites.at(-1)!) as { type: string; request: { subtype: string } };
    expect(written.type).toBe('control_request');
    expect(written.request.subtype).toBe('interrupt');
    proc.stdout(JSON.stringify({ type: 'result', usage: {}, result: 'interrupted' }));
    expect(await handle.interrupt?.()).toBe(false);
  });

  it('a result that asks QUESTION: keeps the input open and waits; the answer lets the next result end it (req-64)', async () => {
    const proc = fakeProcess();
    const { events, start } = collect();
    const handle = claudeCodeAdapter(spawnOf(proc)).spawn(start);
    proc.stdout(JSON.stringify({ type: 'result', usage: { input_tokens: 10, output_tokens: 2 }, result: 'QUESTION: Which one, A or B?' }));
    expect(events.find((e) => e.kind === 'result')).toBeUndefined();
    expect(events.find((e) => e.waiting !== undefined)?.waiting).toEqual({ kind: 'question', text: 'Which one, A or B?' });
    expect(proc.stdinWrites).not.toContain('<<end>>');

    expect(await handle.steer('A')).toBe('inject');
    expect(events.at(-1)).toMatchObject({ turn: 'busy', waiting: null });
    proc.stdout(JSON.stringify({ type: 'result', usage: {}, result: 'Done with A.' }));
    expect(events.find((e) => e.kind === 'result')?.text).toBe('Done with A.');
    expect(proc.stdinWrites.at(-1)).toBe('<<end>>');
  });

  it('a QUESTION: turn in the fixed shape carries it parsed (req-75 W2)', async () => {
    const proc = fakeProcess();
    const { events, start } = collect();
    claudeCodeAdapter(spawnOf(proc)).spawn(start);
    const shaped = [
      'QUESTION: Which database?',
      'Ticket: the store',
      'Where: step 1',
      'Why: undecided',
      'Options:',
      '1. SQLite — no server, fine locally',
      '2. Postgres — one server for all',
      'Recommendation: 1 — local first',
    ].join('\n');
    proc.stdout(JSON.stringify({ type: 'result', usage: {}, result: shaped }));
    const waiting = events.find((e) => e.waiting !== undefined)?.waiting;
    expect(waiting).toMatchObject({
      kind: 'question',
      text: 'Which database?\nTicket: the store\nWhere: step 1\nWhy: undecided\nOptions:\n1. SQLite — no server, fine locally\n2. Postgres — one server for all\nRecommendation: 1 — local first',
      shaped: {
        question: 'Which database?',
        context: 'the store',
        where: 'step 1',
        why: 'undecided',
        options: [
          { n: 1, label: 'SQLite', consequence: 'no server, fine locally' },
          { n: 2, label: 'Postgres', consequence: 'one server for all' },
        ],
        recommended: 1,
        recommendationWhy: 'local first',
      },
    });
  });

  it('a resume run carries --resume with the session ref', () => {
    const seen: string[][] = [];
    const spawnFn: SpawnFn = (_cmd, args) => {
      seen.push([...args]);
      return fakeProcess();
    };
    const { start } = collect({ resumeRef: 'ses_9' });
    claudeCodeAdapter(spawnFn).spawn(start);
    expect(seen[0]).toContain('--resume');
    expect(seen[0]).toContain('ses_9');
  });

  it('compact-first routes /compact natively and waits for its result before the instruction (T-0049)', () => {
    const proc = fakeProcess();
    const { events, start } = collect({ resumeRef: 'ses_9', compactFirst: true });
    const handle = claudeCodeAdapter(spawnOf(proc)).spawn(start);
    expect(proc.stdinWrites[0]).toContain('/compact');
    expect(proc.stdinWrites.join('\n')).not.toContain('Do the ticket.');

    proc.stdout(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'ses_9' }));
    proc.stdout(JSON.stringify({ type: 'result', usage: {}, result: 'compacted' }));
    // The compact's result is not the run's end: the input stays open
    // and the instruction follows as its own turn.
    expect(proc.stdinWrites.at(-1)).toContain('Do the ticket.');
    expect(proc.stdinWrites).not.toContain('<<end>>');
    expect(events.at(-1)).toMatchObject({ kind: 'usage', turn: 'busy' });

    // …and the instruction's result ends the turn as usual.
    proc.stdout(JSON.stringify({ type: 'result', usage: {}, result: 'done' }));
    expect(proc.stdinWrites.at(-1)).toBe('<<end>>');
    proc.exit(0);
  });

  it('a resumed CLI that exits before its init reports the failed resume — a fresh one does not (T-0049)', async () => {
    const proc = fakeProcess();
    const failures: string[] = [];
    const { start } = collect({ resumeRef: 'ses_gone', onResumeFailed: (reason) => failures.push(reason) });
    const handle = claudeCodeAdapter(spawnOf(proc)).spawn(start);
    proc.exit(1);
    await expect(handle.exited).resolves.toBe(1);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('before its session was established');

    const freshProc = fakeProcess();
    const freshFailures: string[] = [];
    const { start: freshStart } = collect({ onResumeFailed: (reason) => freshFailures.push(reason) });
    const freshHandle = claudeCodeAdapter(spawnOf(freshProc)).spawn(freshStart);
    freshProc.exit(1);
    await expect(freshHandle.exited).resolves.toBe(1);
    expect(freshFailures).toHaveLength(0);
  });

  it('emits one turnUsage per assistant call — telemetry sums turns, never the cumulative result', () => {
    const proc = fakeProcess();
    const { events, start } = collect();
    claudeCodeAdapter(spawnOf(proc)).spawn(start);
    proc.stdout(JSON.stringify({
      type: 'assistant',
      message: {
        usage: { input_tokens: 900, cache_read_input_tokens: 20_000, cache_creation_input_tokens: 4_000, output_tokens: 210 },
        content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'src/a.ts' } }],
      },
    }));
    proc.stdout(JSON.stringify({
      type: 'assistant',
      message: {
        usage: { input_tokens: 1_100, cache_read_input_tokens: 30_000, output_tokens: 300 },
        content: [{ type: 'tool_use', name: 'Edit', input: { file_path: 'src/a.ts' } }],
      },
    }));
    // The CLI's result carries the run's CUMULATIVE usage.
    proc.stdout(JSON.stringify({
      type: 'result',
      usage: { input_tokens: 52_000, cache_read_input_tokens: 50_000, output_tokens: 510 },
      result: 'done',
    }));
    const t = telemetryFromEvents(events);
    expect(t.turns).toBe(2);
    expect(t.usage).toEqual({ input: 2_000, cacheRead: 50_000, cacheCreation: 4_000, output: 510 });
    expect(t.lastTurnContext).toBe(31_100); // the LAST turn only — not the 102_000 aggregate
    expect(t.tokensBeforeFirstWrite).toBe(24_900); // the Edit's turn no longer counts
    expect(t.readCalls).toBe(1);
    expect(events.find((e) => e.text === 'Read src/a.ts')?.tool).toBe('Read');
    expect(events.find((e) => e.text === 'Edit src/a.ts')?.tool).toBe('Edit');
  });

  it('an assistant event without a usage block omits turnUsage entirely (no zeros)', () => {
    const proc = fakeProcess();
    const { events, start } = collect();
    claudeCodeAdapter(spawnOf(proc)).spawn(start);
    proc.stdout(JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'No usage here.' }] },
    }));
    expect(events.some((e) => e.kind === 'usage')).toBe(true); // the activity line still lands
    expect(events.filter((e) => e.turnUsage !== undefined)).toHaveLength(0);
  });
});

describe('blockedOf — the refusal marker of a step the worker could not complete', () => {
  it('a result that ends BLOCKED: carries the reason; a QUESTION: still wins (the run waits instead)', async () => {
    const proc = fakeProcess();
    const { events, start } = collect();
    claudeCodeAdapter(spawnOf(proc)).spawn(start);
    proc.stdout(
      JSON.stringify({
        type: 'result',
        usage: { input_tokens: 10, output_tokens: 2 },
        result: 'The step is not complete.\nBLOCKED: merge conflict in specs/changelog.md',
      }),
    );
    expect(events.find((e) => e.kind === 'result')?.blocked).toBe('merge conflict in specs/changelog.md');
    expect(proc.stdinWrites.at(-1)).toBe('<<end>>');

    const proc2 = fakeProcess();
    const { events: events2, start: start2 } = collect();
    claudeCodeAdapter(spawnOf(proc2)).spawn(start2);
    proc2.stdout(JSON.stringify({ type: 'result', usage: {}, result: 'BLOCKED: not now\nQUESTION: Which way?' }));
    expect(events2.find((e) => e.kind === 'result')).toBeUndefined();
    expect(events2.find((e) => e.waiting !== undefined)?.waiting).toMatchObject({ kind: 'question' });
  });
});
