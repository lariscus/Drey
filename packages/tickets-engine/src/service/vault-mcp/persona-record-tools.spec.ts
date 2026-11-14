import { describe, expect, it } from 'vitest';
import type { RunJournalWrite, RunMemoryWrite, RunRecordReply } from '../../contracts/persona-run-records';
import type { PersonaRecordsPort } from './persona-record-tools';
import { harness } from './vault-calls-harness.fake';

/** req-226: memory_write / journal_write on the workers' vault MCP — the run's own persona, once each, audited on its stream. */

class PortFake implements PersonaRecordsPort {
  readonly memory: RunMemoryWrite[] = [];
  readonly journal: RunJournalWrite[] = [];
  reply: RunRecordReply | Error = { ok: true, line: '- the line' };

  memoryWrite(write: RunMemoryWrite): Promise<RunRecordReply> {
    this.memory.push(write);
    return this.answer();
  }

  journalWrite(write: RunJournalWrite): Promise<RunRecordReply> {
    this.journal.push(write);
    return this.answer();
  }

  private answer(): Promise<RunRecordReply> {
    return this.reply instanceof Error ? Promise.reject(this.reply) : Promise.resolve(this.reply);
  }
}

const RECORDS = { harness: 'claude-code', model: 'sonnet' };

describe('the persona record tools of the vault MCP (req-226)', () => {
  it("are listed for a ticket run's persona only — not without the grant, not without a persona", async () => {
    const port = new PortFake();
    const names = async (h: ReturnType<typeof harness>): Promise<string[]> => (await h.calls.list(h.session)).map((tool) => tool.name);
    expect(await names(harness({ port, records: RECORDS }))).toEqual(expect.arrayContaining(['memory_write', 'journal_write', 'vault_read']));
    expect(await names(harness({ port }))).not.toContain('memory_write');
    expect(await names(harness({ port, records: RECORDS, persona: null }))).not.toContain('journal_write');
  });

  it("write the token's own persona with its ticket, harness and model — the lesson capped to the closing round's line", async () => {
    const port = new PortFake();
    const h = harness({ port, records: RECORDS });
    const result = await h.call('memory_write', { lesson: `run the verify script\n${'x'.repeat(400)}`, persona: 'ralf' });
    expect(result).toEqual({ text: 'Saved to your memory:\n- the line', isError: false });
    expect(port.memory).toHaveLength(1);
    expect(port.memory[0]).toMatchObject({ persona: 'ben', ticket: 'T-9', harness: 'claude-code', model: 'sonnet' });
    expect(port.memory[0]!.lesson.length).toBeLessThanOrEqual(200);
    expect(port.memory[0]!.lesson.startsWith('run the verify script x')).toBe(true);
    expect(await h.call('journal_write', { note: 'guessed the test command' })).toMatchObject({ isError: false });
    expect(port.journal[0]).toMatchObject({ persona: 'ben', note: 'guessed the test command' });
  });

  it('once per run: the second call is refused and audited as a refusal on the run stream', async () => {
    const port = new PortFake();
    const h = harness({ port, records: RECORDS });
    await h.call('memory_write', { lesson: 'one' });
    expect(await h.call('memory_write', { lesson: 'two' })).toEqual({ text: 'Error: this run already used memory_write — once per run', isError: true });
    expect(port.memory).toHaveLength(1);
    const audits = h.events.filter((e) => e.detail === 'audit');
    expect(audits.map((e) => [e.tool, e.audit?.verdict, e.audit?.path])).toEqual([
      ['mcp__drey__memory_write', 'allowed', 'tickets/_meta/personas/ben/memory.md'],
      ['mcp__drey__memory_write', 'refused', 'tickets/_meta/personas/ben/memory.md'],
    ]);
  });

  it('a failed write gives the turn back; an empty text writes nothing; an engine that is down is an Error, not a throw', async () => {
    const port = new PortFake();
    const h = harness({ port, records: RECORDS });
    port.reply = { ok: false, error: 'your memory already holds this lesson — nothing was written' };
    expect(await h.call('memory_write', { lesson: 'same' })).toEqual({ text: 'Error: your memory already holds this lesson — nothing was written', isError: true });
    port.reply = new Error('the engine is not up');
    expect((await h.call('memory_write', { lesson: 'again' })).text).toBe('Error: the record could not be written (the engine is not up)');
    port.reply = { ok: true, line: '- ok' };
    expect(await h.call('memory_write', { lesson: 'finally' })).toMatchObject({ isError: false });
    expect(await h.call('journal_write', { note: '   ' })).toEqual({ text: 'Error: journal_write needs a non-empty "note" — one line', isError: true });
    expect(port.journal).toHaveLength(0);
  });

  it('a session without the grant cannot call them even by name', async () => {
    const h = harness({ port: new PortFake() });
    expect(await h.call('memory_write', { lesson: 'x' })).toEqual({ text: 'Error: memory_write is not available to this call', isError: true });
  });
});
