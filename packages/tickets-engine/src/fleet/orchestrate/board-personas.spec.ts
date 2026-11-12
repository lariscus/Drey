import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChainHarness, pipelineWithPlan } from './chain-harness.fake';

/**
 * The persona ladder at dispatch (E3, ADR-0088): ticket pin > phase persona
 * > the engine default; a loaded persona beats the assignment ring with its
 * harness, model, prompt, memory and skills; a missing one degrades to the
 * ring. Through the real composition over a fake dricket store.
 */

let h: ChainHarness;

/** The plan column carries the phase persona `pia`. */
async function writePersonaPipeline(): Promise<void> {
  await h.write('tickets/_meta/pipeline.md', pipelineWithPlan('persona: pia'));
}

describe('BoardPersonas at dispatch (E3, ADR-0088)', () => {
  beforeEach(async () => {
    h = new ChainHarness();
    await h.setUp();
  });

  afterEach(async () => {
    await h.tearDown();
  });

  it('a resolved persona beats the assignment ring: harness, model, prompt, memory', async () => {
    await writePersonaPipeline();
    await h.writePersona('pia', {
      worker: 'claude-code',
      model: 'sonnet',
      prompt: 'You are Pia — plan with care.',
      memory: '# Memory\n\n- 2026-10-30 · T-0099 · handed-over · 900 tokens\n',
    });
    h.io.seed('T-0100', 'plan');
    const { orch, fleet, logs } = h.build();
    await orch.configure(h.config());
    await orch.setMaster('run');

    expect(fleet.records).toHaveLength(1);
    const started = fleet.records[0]!;
    // the legacy ring would have said opencode/zai-glm — the persona wins
    expect(started.request.provider).toBe('claude-code');
    expect(started.request.model).toBe('sonnet');
    expect(started.request.instruction).toContain('You are Pia — plan with care.');
    expect(started.request.instruction).not.toContain('Work the plan step.');
    // the persona's curated memory is the instruction's ## Memory slice
    expect(started.request.instruction).toContain('## Memory');
    expect(started.request.instruction).toContain('T-0099');
    // the resolved id rides the start options — RunInfo.persona stamps from it
    expect(fleet.start.mock.calls[0]![1]).toEqual({ persona: 'pia' });
    expect(logs.some((line) => line.startsWith('dispatched T-0100') && line.includes('persona pia'))).toBe(true);
  });

  it("a persona's skills reach the dispatched run's brief; one with no text is said once (D-46)", async () => {
    await writePersonaPipeline();
    await h.writePersona('pia', { worker: 'claude-code', model: 'sonnet', skills: ['own', 'shared', 'gone'] });
    await h.write('tickets/_meta/personas/pia/skills/own.md', 'Own skill text.\n');
    await h.write('tickets/_meta/skills/shared.md', 'Shared skill text.\n');
    h.io.seed('T-0100', 'plan');
    const { orch, fleet, logs } = h.build();
    await orch.configure(h.config());
    await orch.setMaster('run');

    const instruction = fleet.records[0]!.request.instruction;
    expect(instruction).toContain('## Skills');
    expect(instruction).toContain('### own');
    expect(instruction).toContain('Own skill text.');
    expect(instruction).toContain('Shared skill text.');
    expect(instruction).not.toContain('### gone');
    expect(logs.filter((line) => line.includes('no text for skill gone'))).toHaveLength(1);
  });

  it('req-257: the ticket pin is retired — the phase persona works the column', async () => {
    await writePersonaPipeline();
    await h.writePersona('pia', { worker: 'opencode', model: 'gpt-5' });
    await h.writePersona('tessa', { worker: 'claude-code', model: 'haiku' });
    h.io.seed('T-0101', 'plan', { persona: 'tessa' });
    const { orch, fleet } = h.build();
    await orch.configure(h.config());
    await orch.setMaster('run');

    const started = fleet.records[0]!;
    expect(started.request.provider).toBe('opencode'); // pia's harness — tessa's pin is read by nothing
    expect(fleet.start.mock.calls[0]![1]).toEqual({ persona: 'pia' });
  });

  it('req-257: the engine default persona is retired — nothing names one, the ring runs', async () => {
    await h.writePersona('pia', { worker: 'claude-code', model: 'sonnet' }); // no persona anywhere in the pipeline
    h.io.seed('T-0102', 'plan');
    const { orch, fleet } = h.build();
    await orch.configure(h.config({ defaultPersona: 'pia' }));
    await orch.setMaster('run');

    expect(fleet.start.mock.calls[0]![1]).toEqual({ persona: null });
  });

  it('a missing persona file falls back to the ring — byte for byte', async () => {
    await writePersonaPipeline(); // no tickets/_meta/personas/pia at all
    h.io.seed('T-0103', 'plan');
    const { orch, fleet, logs } = h.build();
    await orch.configure(h.config());
    await orch.setMaster('run');

    const started = fleet.records[0]!;
    expect(started.request.provider).toBe('opencode'); // the ring's column pin
    expect(started.request.model).toBe('zai/glm-5.3');
    expect(started.request.instruction).toContain('Work the plan step.');
    expect(fleet.start.mock.calls[0]![1]).toEqual({ persona: null });
    expect(logs.filter((line) => line.includes('"pia" is missing or invalid'))).toHaveLength(1);
  });

  it('a persona without a prompt.md keeps the phase template — and still beats the ring', async () => {
    await writePersonaPipeline();
    await h.writePersona('pia', { worker: 'claude-code', model: 'sonnet' }); // no prompt.md
    h.io.seed('T-0104', 'plan');
    const { orch, fleet, logs } = h.build();
    await orch.configure(h.config());
    await orch.setMaster('run');

    const started = fleet.records[0]!;
    expect(started.request.provider).toBe('claude-code');
    expect(started.request.instruction).toContain('Work the plan step.');
    expect(started.request.instruction).not.toContain('## Memory');
    expect(fleet.start.mock.calls[0]![1]).toEqual({ persona: 'pia' });
    expect(logs.filter((line) => line.includes('has no prompt.md'))).toHaveLength(1);
  });

  it('the coaching thread does NOT ride the instruction: nothing is adopted unreviewed (D-61, R2/R14)', async () => {
    await writePersonaPipeline();
    await h.writePersona('pia', { worker: 'claude-code', model: 'sonnet', prompt: 'You are Pia.', memory: '# Memory\n\n- lesson\n' });
    const threadLines = Array.from({ length: 6 }, (_, i) => `- '2026-11-03T0${i + 1}:00:00.000Z' owner — teach ${i + 1}`);
    await h.write('tickets/_meta/personas/pia/thread.md', `---\ntitle: "pia"\ncreated: '2026-11-03T09:00:00.000Z'\n---\n\n${threadLines.join('\n')}\n`);
    h.io.seed('T-0112', 'plan');
    const { orch, fleet } = h.build();
    await orch.configure(h.config());
    await orch.setMaster('run');

    const started = fleet.records[0]!;
    // the thread is the 1:1 tab's note to the persona; until req-168/169 bring the
    // accepted path, no line of it reaches a run — the memory still does
    expect(started.request.instruction).not.toContain('## Coaching');
    expect(started.request.instruction).not.toContain('teach ');
    expect(started.request.continuationInstruction).not.toContain('## Coaching');
    expect(started.request.instruction).toContain('## Memory');
  });
});
