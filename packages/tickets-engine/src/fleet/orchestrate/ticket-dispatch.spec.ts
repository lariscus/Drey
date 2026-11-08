import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChainHarness, failedRecord, fakePort, PIPELINE, PLAN_LINE, pipelineWithPlan } from './chain-harness.fake';

/**
 * One planned dispatch (M85, E3, E8, T-0048): the instruction base and its
 * version check, the retry's gate failure, the caps, the scout form — the
 * composed request as the supervisor receives it. The board is a fake
 * dricket store; the composition is the real one.
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

  it('a missing prompt file skips the candidate instead of dispatching blind', async () => {
    await h.remove('tickets/_meta/prompts/plan-default.md');
    h.io.seed('T-0001', 'plan');
    const { orch, fleet } = h.build();
    await orch.configure(h.config());
    await orch.setMaster('run');
    expect(fleet.records).toEqual([]);
  });

  it('says once that the vault prompt is older than the shipped one, and never sends the marker to the model', async () => {
    await h.write('tickets/_meta/prompts/plan-default.md', `<!-- drey-prompt-version: 1 -->${String.fromCharCode(10)}Work the plan step.`);
    h.io.seed('T-0001', 'plan');
    const { orch, fleet, logs } = h.build({
      shippedPrompt: async () => `<!-- drey-prompt-version: 2 -->${String.fromCharCode(10)}Work the plan step, better.`,
    });
    await orch.configure(h.config());
    await orch.setMaster('run');
    const started = fleet.records[0]!;
    expect(started.request.instruction).toContain('Work the plan step.');
    expect(started.request.instruction).not.toContain('drey-prompt-version');
    const notes = logs.filter((line) => line.includes('older than the shipped default'));
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('v1 < v2');
    await orch.setMaster('halted');
    await orch.setMaster('run');
    expect(logs.filter((line) => line.includes('older than the shipped default'))).toHaveLength(1);
  });

  it('a failed-then-requeued ticket dispatches with the gate failure section (T-0048 retry)', async () => {
    h.io.seed('T-0041', 'plan');
    const fleet = fakePort();
    // The ticket's previous run failed its gate and was requeued.
    fleet.records.push(failedRecord('T-0041', '`npm run verify:unit` failed\n\nkeep row 39\nkeep row 40'));
    const { orch } = h.build({ fleet });
    await orch.configure(h.config());
    await orch.setMaster('run');

    const started = fleet.records.find((r) => r.info.state === 'running')!;
    expect(started.request.instruction).toContain('The previous run failed the machine gate — fix this first');
    expect(started.request.instruction).toContain('keep row 40');
    // The instruction keeps the context pack's order: the phase template
    // before the plan, the retry section in the variable parts.
    expect(started.request.instruction.indexOf('Work the plan step.')).toBeLessThan(started.request.instruction.indexOf('The previous run failed the machine gate'));
    // T-0049: the dispatcher asks the supervisor's rules to decide.
    expect(started.request.handover).toBe('auto');
  });

  it('caps from the chain config reach the composed instruction', async () => {
    h.io.seed('T-0042', 'plan');
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
    await h.write('tickets/_meta/pipeline.md', pipelineWithPlan('persona: pia'));
    await h.writePersona('pia', { worker: 'claude-code', model: 'sonnet' });
    h.io.seed('T-0100', 'plan');
    const { orch, fleet } = h.build();
    await orch.configure(h.config());
    await orch.setMaster('run');
    expect(fleet.records[0]!.request.origin).toBe('chain');
  });

  describe('scout dispatch (E8, concept §5.6)', () => {
    const SCOUT_PLAN_LINE = '  - { id: plan, title: Plan, handover: agent scout-default, worker: opencode, model: zai/glm-5.3 }';

    /** The plan column runs scout tickets on the shipped scout template. */
    async function writeScoutMeta(): Promise<void> {
      await h.write('tickets/_meta/pipeline.md', PIPELINE.replace(PLAN_LINE, SCOUT_PLAN_LINE));
      await h.write('tickets/_meta/prompts/scout-default.md', 'You are the scout of the pipeline.');
    }

    it('a scout ticket dispatches an exploration: the column template in the brief, no gate, no move', async () => {
      await writeScoutMeta();
      h.io.seed('T-0004', 'plan', { form: 'scout', acceptance: false });
      const events = { ledger: vi.fn() };
      const { orch, fleet, logs } = h.build({ events });
      await orch.configure(h.config());
      await orch.setMaster('run');

      expect(fleet.records).toHaveLength(1);
      const started = fleet.records[0]!;
      expect(started.request.form).toBe('scout');
      expect(started.request.gate).toBe('none');
      expect(started.request.acceptance).toEqual([]);
      expect(started.request.nextPhase).toBeNull();
      expect(started.request.nextPhaseDir).toBeNull();
      expect(started.request.worktreePath).toBe('W:/drey'); // the read ground
      // The column's scout template rides the brief, the built-in exploration frame around it.
      expect(started.request.instruction).toContain('You are the scout of the pipeline.');
      expect(started.request.instruction).toContain('Scout discipline');
      expect(started.request.instruction).toContain('Read ground: W:/drey (the "drey" checkout)');
      expect(started.request.instruction).not.toContain('Completion discipline');
      expect(logs.some((line) => line.startsWith('dispatched T-0004') && line.includes('scout'))).toBe(true);
      // The ledger line fires like for any dispatch.
      expect(events.ledger).toHaveBeenCalledWith({ kind: 'dispatched', ticket: 'T-0004', persona: null, model: 'zai/glm-5.3' });
    });

    it('a missing scout template skips the dispatch like any missing phase prompt', async () => {
      await writeScoutMeta();
      await h.remove('tickets/_meta/prompts/scout-default.md');
      h.io.seed('T-0004', 'plan', { form: 'scout', acceptance: false });
      const { orch, fleet, logs } = h.build();
      await orch.configure(h.config());
      await orch.setMaster('run');

      expect(fleet.records).toHaveLength(0);
      expect(logs.some((line) => line.includes('dispatch skips T-0004') && line.includes('scout-default'))).toBe(true);
    });

    it('a scout ticket naming no repo explores the tickets vault itself', async () => {
      h.io.seed('T-0005', 'plan', { form: 'scout', acceptance: false, repos: [] });
      const { orch, fleet } = h.build();
      await orch.configure(h.config());
      await orch.setMaster('run');

      expect(fleet.records).toHaveLength(1);
      const started = fleet.records[0]!;
      expect(started.request.worktreePath).toBe(h.vaultDir);
      expect(started.request.instruction).toContain(`Read ground: ${h.vaultDir} (the tickets vault)`);
    });

    it('a scout ticket with an unknown named repo is skipped, never guessed', async () => {
      h.io.seed('T-0006', 'plan', { form: 'scout', acceptance: false, repos: ['ghost'] });
      const { orch, fleet, logs } = h.build();
      await orch.configure(h.config());
      await orch.setMaster('run');

      expect(fleet.records).toHaveLength(0);
      expect(logs.some((line) => line.includes('dispatch skips T-0006') && line.includes('ghost'))).toBe(true);
    });

    it('a persona scout signs the report and rides the dispatch like everywhere', async () => {
      await h.write('tickets/_meta/pipeline.md', pipelineWithPlan('persona: pia'));
      await h.writePersona('pia', { role: 'explorer', worker: 'claude-code', model: 'sonnet', prompt: 'You are Pia — explore thoroughly.' });
      h.io.seed('T-0007', 'plan', { form: 'scout', acceptance: false });
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
