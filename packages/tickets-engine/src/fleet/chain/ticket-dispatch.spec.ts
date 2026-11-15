import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChainHarness, failedRecord, fakePort } from './chain-harness.fake';

/**
 * One planned dispatch (M85, E3, E8, T-0048, req-307): the persona's prompt
 * as the instruction base, the retry's gate failure, the caps, the scout
 * form — the composed request as the supervisor receives it. The board is a
 * fake dricket store; the composition is the real one.
 */

let h: ChainHarness;

describe('TicketDispatch', () => {
  beforeEach(async () => {
    h = new ChainHarness();
    await h.setUp();
  });

  afterEach(async () => {
    await h.tearDown();
  });

  it('a persona without a prompt file skips the candidate instead of dispatching blind', async () => {
    await h.remove('tickets/_meta/personas/ben/prompt.md');
    h.seedRun('T-0001');
    const { orch, fleet, logs } = h.build();
    await orch.configure(h.config());
    await orch.setMaster('run');
    expect(fleet.records).toEqual([]);
    expect(logs.some((line) => line.includes('dispatch skips T-0001') && line.includes('prompt.md'))).toBe(true);
  });

  it('a failed-then-requeued ticket dispatches with the gate failure section (T-0048 retry)', async () => {
    h.seedRun('T-0041');
    const fleet = fakePort();
    // The ticket's previous run failed its gate and was requeued.
    fleet.records.push(failedRecord('T-0041', '`npm run verify:unit` failed\n\nkeep row 39\nkeep row 40'));
    const { orch } = h.build({ fleet });
    await orch.configure(h.config());
    await orch.setMaster('run');

    const started = fleet.records.find((r) => r.info.state === 'running')!;
    expect(started.request.instruction).toContain('The previous run failed the machine gate — fix this first');
    expect(started.request.instruction).toContain('keep row 40');
    // The instruction keeps the context pack's order: the persona's prompt
    // before the plan, the retry section in the variable parts.
    expect(started.request.instruction.indexOf('Build it.')).toBeLessThan(started.request.instruction.indexOf('The previous run failed the machine gate'));
    // T-0049: the dispatcher asks the supervisor's rules to decide.
    expect(started.request.handover).toBe('auto');
  });

  it('caps from the chain config reach the composed instruction', async () => {
    h.seedRun('T-0042');
    const fleet = fakePort();
    const failure = [...Array(10).keys()].map((i) => `drop row ${i + 1}`).join('\n');
    fleet.records.push(failedRecord('T-0042', `\`npm test\` failed\n\n${failure}\nkeep row 10`));
    const { orch, logs } = h.build({ fleet });
    await orch.configure(h.config({ caps: { gateFailureLines: 1, gateFailureBytes: 4_096, diffStatLines: 50, diffStatBytes: 4_096 } }));
    await orch.setMaster('run');

    const started = fleet.records.find((r) => r.info.state === 'running')!;
    expect(started.request.instruction).toContain('keep row 10');
    expect(started.request.instruction).not.toContain('drop row 9');
    expect(logs.some((line) => line.includes('T-0042 gateFailure truncated: true, originalSize'))).toBe(true);
  });

  it('a dispatched run says who started it: the chain (D-41)', async () => {
    await h.writePersona('pia', { worker: 'claude-code', model: 'sonnet' });
    h.seedRun('T-0100', { persona: 'pia' });
    const { orch, fleet } = h.build();
    await orch.configure(h.config());
    await orch.setMaster('run');
    expect(fleet.records[0]!.request.origin).toBe('chain');
  });

  describe('scout dispatch (E8, concept §5.6)', () => {
    it("a scout ticket dispatches an exploration: the persona's prompt in the brief, no gate", async () => {
      await h.writePersona('ben', { prompt: 'You are the scout of the pipeline.' });
      h.seedRun('T-0004', { form: 'scout', acceptance: false });
      const events = { ledger: vi.fn() };
      const { orch, fleet, logs } = h.build({ events });
      await orch.configure(h.config());
      await orch.setMaster('run');

      expect(fleet.records).toHaveLength(1);
      const started = fleet.records[0]!;
      expect(started.request.form).toBe('scout');
      expect(started.request.gate).toBe('none');
      expect(started.request.acceptance).toEqual([]);
      expect(started.request.worktreePath).toBe('W:/drey'); // the read ground
      // The persona's prompt rides the brief, the built-in exploration frame around it.
      expect(started.request.instruction).toContain('You are the scout of the pipeline.');
      expect(started.request.instruction).toContain('Scout discipline');
      expect(started.request.instruction).toContain('Read ground: W:/drey (the "drey" checkout)');
      expect(started.request.instruction).not.toContain('Completion discipline');
      expect(logs.some((line) => line.startsWith('dispatched T-0004') && line.includes('scout'))).toBe(true);
      // The ledger line fires like for any dispatch.
      expect(events.ledger).toHaveBeenCalledWith({ kind: 'dispatched', ticket: 'T-0004', persona: 'ben', model: 'opus' });
    });

    it('a scout ticket whose persona has no prompt.md skips the dispatch like any other', async () => {
      await h.remove('tickets/_meta/personas/ben/prompt.md');
      h.seedRun('T-0004', { form: 'scout', acceptance: false });
      const { orch, fleet, logs } = h.build();
      await orch.configure(h.config());
      await orch.setMaster('run');

      expect(fleet.records).toHaveLength(0);
      expect(logs.some((line) => line.includes('dispatch skips T-0004') && line.includes('prompt.md'))).toBe(true);
    });

    it('a scout ticket naming no repo explores the tickets vault itself', async () => {
      h.seedRun('T-0005', { form: 'scout', acceptance: false, repos: [] });
      const { orch, fleet } = h.build();
      await orch.configure(h.config());
      await orch.setMaster('run');

      expect(fleet.records).toHaveLength(1);
      const started = fleet.records[0]!;
      expect(started.request.worktreePath).toBe(h.vaultDir);
      expect(started.request.instruction).toContain(`Read ground: ${h.vaultDir} (the tickets vault)`);
    });

    it('a scout ticket with an unknown named repo is skipped, never guessed', async () => {
      h.seedRun('T-0006', { form: 'scout', acceptance: false, repos: ['ghost'] });
      const { orch, fleet, logs } = h.build();
      await orch.configure(h.config());
      await orch.setMaster('run');

      expect(fleet.records).toHaveLength(0);
      expect(logs.some((line) => line.includes('dispatch skips T-0006') && line.includes('ghost'))).toBe(true);
    });

    it('a persona scout signs the report and rides the dispatch like everywhere', async () => {
      await h.writePersona('pia', { role: 'explorer', worker: 'claude-code', model: 'sonnet', prompt: 'You are Pia — explore thoroughly.' });
      h.seedRun('T-0007', { persona: 'pia', form: 'scout', acceptance: false });
      const { orch, fleet } = h.build();
      await orch.configure(h.config());
      await orch.setMaster('run');

      const started = fleet.records[0]!;
      expect(started.request.provider).toBe('claude-code'); // the persona's harness
      expect(started.request.form).toBe('scout');
      expect(started.request.instruction).toContain('You are Pia — explore thoroughly.');
      expect(started.request.instruction).toContain('by pia.');
      expect(fleet.start.mock.calls[0]![1]).toEqual({ persona: 'pia' });
    });
  });
});
