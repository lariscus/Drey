import { describe, expect, it } from 'vitest';
import { composeRunRequest } from './request';
import { base, phase, TICKET } from './request-spec-support';

/** req-258: what a run takes from the persona's record — the gate, the ceilings, instructed read-only, the shape dialog's wrapper. */

const NO_CRITERIA = TICKET.replace('- [ ] `npm run verify:unit` — exits 0', 'Nothing runnable yet.');
const RUN = { readOnly: false, gate: 'commands', maxTurns: null, maxWorkMin: null, leaving: [] } as const;
const PAUL = { id: 'paul', role: 'planner', worker: 'claude-code', model: 'sonnet', prompt: '## Who Paul is\n\nPaul plans.', memory: '', run: { ...RUN, gate: 'structural' as const } };

function ok(result: ReturnType<typeof composeRunRequest>): Extract<ReturnType<typeof composeRunRequest>, { ok: true }>['request'] {
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.request;
}

describe('the persona gate (gate:)', () => {
  it('a structural gate judges what the run wrote, never the build commands, and names none in the brief', () => {
    const request = ok(composeRunRequest(base({ workingPhase: phase('build'), persona: PAUL })));
    expect(request.gate).toBe('structural');
    expect(request.acceptance).toEqual([]);
    expect(request.instruction).not.toContain('npm run verify:unit`\n');
    expect(request.instruction).not.toContain('The machine gate runs exactly these');
  });

  it('a structural gate lifts the refusal of a ticket without runnable criteria outside the first column', () => {
    const request = ok(composeRunRequest(base({ ticketText: NO_CRITERIA, workingPhase: phase('build'), persona: PAUL })));
    expect(request.gate).toBe('structural');
  });

  it('the commands gate keeps today: the criteria gate the hand-over, none is a refusal', () => {
    const ben = { ...PAUL, id: 'ben', role: 'builder', run: RUN };
    expect(ok(composeRunRequest(base({ persona: ben }))).gate).toBe('commands');
    expect(composeRunRequest(base({ ticketText: NO_CRITERIA, persona: ben })).ok).toBe(false);
  });
});

describe('the persona ceilings (max-turns:, max-work:)', () => {
  it("the persona's ceilings ride key by key", () => {
    const request = ok(composeRunRequest(base({ workingPhase: phase('build'), persona: { ...PAUL, run: { ...RUN, maxTurns: 12 } } })));
    expect(request.limits).toEqual({ maxTurns: 12 });
  });

  it('a record without ceilings carries none, and none at all carries none', () => {
    const column = phase('build');
    expect(ok(composeRunRequest(base({ workingPhase: column, persona: { ...PAUL, run: RUN } }))).limits).toBeUndefined();
    expect(ok(composeRunRequest(base({ persona: { ...PAUL, run: RUN } }))).limits).toBeUndefined();
  });
});

describe('instructed read-only (readonly:)', () => {
  it('the brief carries the read-only rules; the session and the worktree stay as they are', () => {
    const tessa = { ...PAUL, id: 'tessa', role: 'tester', run: { ...RUN, readOnly: true } };
    const request = ok(composeRunRequest(base({ workingPhase: phase('qa'), persona: tessa })));
    expect(request.instruction).toContain('Read-only: the spec fixture');
    expect(request.instruction).not.toContain('Changing files: the spec fixture');
    expect(request.permissionMode).toBe('accept-edits');
    expect(request.reviewCheckout).toBeUndefined();
  });

  it('a writing persona keeps the writing rules', () => {
    const request = ok(composeRunRequest(base({ persona: { ...PAUL, run: RUN } })));
    expect(request.instruction).toContain('Changing files: the spec fixture');
    expect(request.instruction).not.toContain('Read-only: the spec fixture');
  });
});

describe('the interactive mode wrapper', () => {
  const SHAPE = 'Interview first, propose second, write last.';

  it("a dialog run gets the dialog protocol after the persona's own", () => {
    const request = ok(composeRunRequest(base({ promptText: SHAPE, interactive: 'plan', persona: PAUL })));
    const who = request.instruction.indexOf('Paul plans.');
    const dialog = request.instruction.indexOf('Interview first, propose second, write last.');
    expect(who).toBeGreaterThanOrEqual(0);
    expect(dialog).toBeGreaterThan(who);
  });

  it('an ordinary run keeps the persona prompt alone (the persona IS the instruction; the dialog text joins only a dialog)', () => {
    const request = ok(composeRunRequest(base({ promptText: SHAPE, persona: PAUL })));
    expect(request.instruction).toContain('Paul plans.');
    expect(request.instruction).not.toContain(SHAPE);
  });
});

describe('the leaving actions (leaving:, req-267)', () => {
  const BEN = { id: 'ben', role: 'builder', worker: 'claude-code', model: 'sonnet', prompt: '## Who Ben is\n\nBen builds.', memory: '', run: { ...RUN, leaving: ['sync-main'] as const } };

  it("a builder whose record lists sync-main carries it on the run's request", () => {
    const request = ok(composeRunRequest(base({ workingPhase: phase('build'), persona: BEN })));
    expect(request.leaving).toEqual(['sync-main']);
    expect(request.baseRef).toBe('main');
  });

  it('a persona without leaving actions carries none, and the commit never rides a run', () => {
    const plain = ok(composeRunRequest(base({ workingPhase: phase('build'), persona: { ...BEN, run: RUN } })));
    expect(plain.leaving).toBeUndefined();
    const committing = ok(composeRunRequest(base({ workingPhase: phase('build'), persona: { ...BEN, run: { ...RUN, leaving: ['commit'] as const } } })));
    expect(committing.leaving).toBeUndefined();
  });

  it('an interactive dialog never syncs main', () => {
    const request = ok(composeRunRequest(base({ promptText: 'x', interactive: 'plan', persona: BEN })));
    expect(request.leaving).toBeUndefined();
  });
});


