import { describe, expect, it } from 'vitest';
import type { TicketCard } from '../../contracts/tickets';
import { composeRunRequest } from './request';
import { base, card, phase, REPO, TICKET } from './request-spec-support';

/** composeRunRequest for a persona dispatch (E3) and a scout run (E8); the fixtures are shared with request.spec.ts. */

describe('persona dispatch (E3, ADR-0088)', () => {
  const PIA = { id: 'pia', worker: 'claude-code', model: 'sonnet', prompt: 'You are Pia.', memory: '' };

  it('a persona beats the assignment ring for provider and model', () => {
    const result = composeRunRequest(
      base({
        workingPhase: phase('plan'),
        persona: PIA,
      }),
    );
    if (!result.ok) {
      throw new Error(result.error);
    }
    expect(result.request.provider).toBe('claude-code');
    expect(result.request.model).toBe('sonnet');
    expect(result.persona).toBe('pia');
    expect(result.request.recordWorker).toBeUndefined(); // a persona is configuration, never a ticket worker pin
    expect(result.request.instruction).toContain('You are Pia.');
  });

  it('a persona with a harness the fleet cannot run leaves the ring in charge', () => {
    const result = composeRunRequest(
      base({
        workingPhase: phase('plan'),
        persona: { ...PIA, worker: 'api' },
      }),
    );
    if (!result.ok) {
      throw new Error(result.error);
    }
    expect(result.request.provider).toBe('opencode'); // the ring's default stands
    expect(result.request.model).toBeNull();
    expect(result.persona).toBe('pia'); // the persona still dispatched — prompt, memory, stamp
  });

  it('a persona without a prompt carries no instruction base (req-307: the persona prompt is the only one) and still dispatches', () => {
    const result = composeRunRequest(base({ persona: { ...PIA, prompt: null } }));
    if (!result.ok) {
      throw new Error(result.error);
    }
    expect(result.request.instruction).not.toContain('You are Pia.');
    expect(result.request.instruction).toContain('Completion discipline');
    expect(result.persona).toBe('pia');
  });

  it('an unreadable ring pin is not a refusal when a usable persona decided', () => {
    const pinned = card({ meta: { ...card().meta, worker: 'not-a-worker' } });
    const result = composeRunRequest(base({ card: pinned, persona: PIA }));
    if (!result.ok) {
      throw new Error(result.error);
    }
    expect(result.request.provider).toBe('claude-code');
  });

  it('the memory slice rides the variable tail: capped by lines and tokens, absent when empty', () => {
    const lines = [...Array(25).keys()].map((i) => `- lesson ${i + 1}`);
    const result = composeRunRequest(base({ persona: { ...PIA, memory: `# Memory\n\n${lines.join('\n')}\n` } }));
    if (!result.ok) {
      throw new Error(result.error);
    }
    const instruction = result.request.instruction;
    expect(instruction).toContain('## Memory');
    expect(instruction).toContain('- lesson 25'); // newest
    expect(instruction).toContain('- lesson 6'); // oldest of the last 20
    expect(instruction).not.toContain('- lesson 5'); // the line cap drops it
    // persona-less bytes stay identical — no memory, no section
    const bare = composeRunRequest(base({}));
    if (!bare.ok) {
      throw new Error(bare.error);
    }
    expect(bare.request.instruction).not.toContain('## Memory');
    const again = composeRunRequest(base({}));
    if (!again.ok) {
      throw new Error(again.error);
    }
    expect(again.request.instruction).toBe(bare.request.instruction);
  });

  it('the memory slice rides the resume continuation; memory is not stable-digest material', () => {
    const memory = '# Memory\n\n- one lesson\n';
    const withMemory = composeRunRequest(base({ persona: { ...PIA, prompt: null, memory } }));
    if (!withMemory.ok) {
      throw new Error(withMemory.error);
    }
    expect(withMemory.request.continuationInstruction).toContain('## Memory');
    expect(withMemory.request.continuationInstruction).toContain('one lesson');
    // Two briefs differing ONLY in memory share the digest — the slice is
    // a variable part, like the diff stat; a changed prompt is a new brief.
    const otherMemory = composeRunRequest(base({ persona: { ...PIA, prompt: null, memory: '# Memory\n\n- other lesson\n' } }));
    if (!otherMemory.ok) {
      throw new Error(otherMemory.error);
    }
    expect(otherMemory.request.briefDigest).toBe(withMemory.request.briefDigest);
    const withPrompt = composeRunRequest(base({ persona: { ...PIA, memory } }));
    if (!withPrompt.ok) {
      throw new Error(withPrompt.error);
    }
    expect(withPrompt.request.briefDigest).not.toBe(withMemory.request.briefDigest);
  });
});

describe('scout runs (E8, concept §5.6)', () => {
  const SCOUT = { ...card().meta, form: 'scout' as const };
  const NO_CRITERIA = TICKET.replace('- [ ] `npm run verify:unit` — exits 0\n', '');

  function scoutCard(over: Partial<TicketCard> = {}): TicketCard {
    const { meta, ...rest } = over;
    return card({ ...rest, meta: { ...SCOUT, ...(meta ?? {}) } });
  }

  it('a scout ticket composes an exploration: no gate, no move, the repo as the read ground', () => {
    const result = composeRunRequest(
      base({
        card: scoutCard(),
        ticketText: NO_CRITERIA,
        workingPhase: phase('active'),
        cursor: { at: 1, length: 2 },
        dispatchedBy: 'active',
      }),
    );
    if (!result.ok) {
      throw new Error(result.error);
    }
    expect(result.request.form).toBe('scout');
    expect(result.request.gate).toBe('none');
    expect(result.request.acceptance).toEqual([]);
    expect(result.request.cursor).toBeUndefined(); // the ticket stays where it sits: no cursor rides a scout
    expect(result.request.worktreePath).toBe('W:/drey'); // the read ground, no worktree path
    expect(result.request.repoPath).toBe('W:/drey');
    expect(result.request.baseRef).toBeNull();
    expect(result.request.column).toBe('active');
    expect(result.request.instruction).toContain('Scout discipline');
    expect(result.request.instruction).toContain('Read ground: W:/drey (the "drey" checkout)');
    expect(result.request.instruction).not.toContain('Completion discipline');
    // A ship ticket stays the default everywhere: no form, the normal gate.
    const ship = composeRunRequest(base({}));
    if (!ship.ok) {
      throw new Error(ship.error);
    }
    expect(ship.request.form).toBeUndefined();
    expect(ship.request.gate).toBe('commands');
  });

  it('no repo is no refusal for a scout — the tickets vault is the read ground', () => {
    const result = composeRunRequest(
      base({
        card: scoutCard({ meta: { ...SCOUT, repo: null, repos: [] } }),
        repo: null,
        ticketText: NO_CRITERIA,
      }),
    );
    if (!result.ok) {
      throw new Error(result.error);
    }
    expect(result.request.worktreePath).toBe('V:/tickets');
    expect(result.request.instruction).toContain('Read ground: V:/tickets (the tickets vault)');
    // …while a ship ticket without a repo keeps refusing.
    expect(composeRunRequest(base({ repo: null })).ok).toBe(false);
  });

  it('a named repo without a checkout still refuses — for a scout too', () => {
    const result = composeRunRequest(base({ card: scoutCard(), repo: { ...REPO, path: null }, ticketText: NO_CRITERIA }));
    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toContain('no local path');
  });

  it('a persona scout signs the report and rides provider, model, prompt and memory', () => {
    const PIA = { id: 'pia', worker: 'claude-code', model: 'sonnet', prompt: 'You are Pia.', memory: '# Memory\n\n- lesson\n' };
    const result = composeRunRequest(base({ card: scoutCard(), ticketText: NO_CRITERIA, persona: PIA }));
    if (!result.ok) {
      throw new Error(result.error);
    }
    expect(result.request.provider).toBe('claude-code');
    expect(result.request.model).toBe('sonnet');
    expect(result.persona).toBe('pia');
    expect(result.request.instruction).toContain('by pia.');
    expect(result.request.instruction).toContain('You are Pia.');
    expect(result.request.instruction).toContain('## Memory');
  });

  it('extra repos become read-only grounds in the brief — no prepared worktrees on the wire', () => {
    const EXTRA = {
      name: 'lariscus',
      url: 'https://example.invalid/lariscus.git',
      branch: 'main',
      path: 'E:/code/lariscus',
      policy: null,
      worker: null,
      worktrees: null,
      launch: null,
      instructions: null,
    };
    const result = composeRunRequest(
      base({ card: scoutCard({ meta: { ...SCOUT, repos: ['drey', 'lariscus'] } }), ticketText: NO_CRITERIA, extraRepos: [EXTRA] }),
    );
    if (!result.ok) {
      throw new Error(result.error);
    }
    expect(result.request.extraRepos).toBeUndefined();
    expect(result.request.instruction).toContain('- lariscus: E:/code/lariscus (read-only)');
    const refused = composeRunRequest(base({ card: scoutCard(), ticketText: NO_CRITERIA, extraRepos: [{ ...EXTRA, path: null }] }));
    expect(refused.ok).toBe(false);
  });
});

