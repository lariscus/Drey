import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChainHarness } from './chain-harness.fake';

/**
 * The persona at dispatch (E3, ADR-0088, req-307): the chain's entry at the
 * cursor names who works a ticket (no ticket pin, no engine default); the
 * loaded persona brings its harness, model, prompt, memory and skills; one
 * that did not load, or has no prompt.md, starts nothing and says so once.
 * Through the real composition over a fake dricket store.
 */

let h: ChainHarness;

describe('BoardPersonas at dispatch (E3, ADR-0088)', () => {
  beforeEach(async () => {
    h = new ChainHarness();
    await h.setUp();
  });

  afterEach(async () => {
    await h.tearDown();
  });

  it('a resolved persona beats the assignment ring: harness, model, prompt, memory', async () => {
    await h.writePersona('pia', {
      worker: 'claude-code',
      model: 'sonnet',
      prompt: 'You are Pia — build with care.',
      memory: '# Memory\n\n- 2026-10-30 · T-0099 · handed-over · 900 tokens\n',
    });
    h.seedRun('T-0100', { persona: 'pia' });
    const { orch, fleet, logs } = h.build();
    await orch.configure(h.config());
    await orch.setMaster('run');

    expect(fleet.records).toHaveLength(1);
    const started = fleet.records[0]!;
    // the assignment ring would have said opencode — the persona wins
    expect(started.request.provider).toBe('claude-code');
    expect(started.request.model).toBe('sonnet');
    expect(started.request.instruction).toContain('You are Pia — build with care.');
    expect(started.request.instruction).not.toContain('Build it.');
    // the persona's curated memory is the instruction's ## Memory slice
    expect(started.request.instruction).toContain('## Memory');
    expect(started.request.instruction).toContain('T-0099');
    // the resolved id rides the start options — RunInfo.persona stamps from it
    expect(fleet.start.mock.calls[0]![1]).toEqual({ persona: 'pia' });
    expect(logs.some((line) => line.startsWith('dispatched T-0100') && line.includes('persona pia'))).toBe(true);
  });

  it("a persona's skills reach the dispatched run's brief; one with no text is said once (D-46)", async () => {
    await h.writePersona('pia', { worker: 'claude-code', model: 'sonnet', skills: ['own', 'shared', 'gone'] });
    await h.write('tickets/_meta/personas/pia/skills/own.md', 'Own skill text.\n');
    await h.write('tickets/_meta/skills/shared.md', 'Shared skill text.\n');
    h.seedRun('T-0100', { persona: 'pia' });
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

  it('req-257: the ticket pin is retired — the chain entry works the ticket', async () => {
    await h.writePersona('pia', { worker: 'opencode', model: 'gpt-5' });
    await h.writePersona('tessa', { worker: 'claude-code', model: 'haiku' });
    h.seedRun('T-0101', { persona: 'pia', extensions: { persona: 'tessa' } });
    const { orch, fleet } = h.build();
    await orch.configure(h.config());
    await orch.setMaster('run');

    const started = fleet.records[0]!;
    expect(started.request.provider).toBe('opencode'); // pia's harness (the chain's entry) — tessa's pin is read by nothing
    expect(fleet.start.mock.calls[0]![1]).toEqual({ persona: 'pia' });
  });

  it('req-257: the engine default persona is retired — a ticket whose chain names no persona starts nothing', async () => {
    await h.writePersona('pia', { worker: 'claude-code', model: 'sonnet' }); // no chain names it
    h.io.seed('T-0102', 'active'); // no chain at all
    const { orch, fleet } = h.build();
    await orch.configure(h.config({ defaultPersona: 'pia' }));
    await orch.setMaster('run');

    expect(fleet.records).toEqual([]);
  });

  it('a persona that is not in the crew starts nothing — said once, naming it', async () => {
    h.seedRun('T-0103', { persona: 'pia' }); // no tickets/_meta/personas/pia at all
    const { orch, fleet, logs } = h.build();
    await orch.configure(h.config());
    await orch.setMaster('run');
    await orch.setMaster('halted');
    await orch.setMaster('run'); // second pass — the note stays silent

    expect(fleet.records).toEqual([]);
    expect(logs.filter((line) => line.includes('T-0103 stands at You: no persona for position 1 ("pia" is not in the crew)'))).toHaveLength(1);
  });

  it('a persona without a prompt.md starts nothing — its prompt is the only instruction base, said once', async () => {
    await h.writePersona('pia', { worker: 'claude-code', model: 'sonnet', prompt: null }); // no prompt.md
    h.seedRun('T-0104', { persona: 'pia' });
    const { orch, fleet, logs } = h.build();
    await orch.configure(h.config());
    await orch.setMaster('run');
    await orch.setMaster('halted');
    await orch.setMaster('run'); // second pass — the note stays silent

    expect(fleet.records).toEqual([]);
    expect(logs.filter((line) => line.includes('persona "pia" has no prompt (tickets/_meta/personas/pia/prompt.md)'))).toHaveLength(1);
  });

  it('the coaching thread does NOT ride the instruction: nothing is adopted unreviewed (D-61, R2/R14)', async () => {
    await h.writePersona('pia', { worker: 'claude-code', model: 'sonnet', prompt: 'You are Pia.', memory: '# Memory\n\n- lesson\n' });
    const threadLines = Array.from({ length: 6 }, (_, i) => `- '2026-11-03T0${i + 1}:00:00.000Z' owner — teach ${i + 1}`);
    await h.write('tickets/_meta/personas/pia/thread.md', `---\ntitle: "pia"\ncreated: '2026-11-03T09:00:00.000Z'\n---\n\n${threadLines.join('\n')}\n`);
    h.seedRun('T-0112', { persona: 'pia' });
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
