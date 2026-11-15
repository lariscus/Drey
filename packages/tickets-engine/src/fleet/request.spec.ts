import { describe, expect, it } from 'vitest';
import { composeRunRequest } from './request';
import type { RunRequest } from './protocol';
import { base, card, phase, REPO, TICKET } from './request-spec-support';

/**
 * The one RunRequest builder both call sites share (M85): the board
 * service (an owner run) and the orchestrator (a dispatched run).
 */

describe('composeRunRequest — the owner\'s columns (D-29)', () => {
  const inbox = phase('inbox', { title: 'Inbox', handover: 'manual', persona: 'you' });

  it('refuses a run from a manual column: the fleet takes nothing from it, whoever asks', () => {
    for (const asked of [{}, { workerChoice: 'opencode' }, { handover: 'fresh' as const }, { dispatchedBy: 'inbox' }]) {
      const result = composeRunRequest(base({ workingPhase: inbox, ...asked }));
      expect(result.ok).toBe(false);
      expect(result.ok ? '' : result.error).toBe("T-0001 sits in Inbox, the owner's column: the fleet takes nothing from it. Start its chain to run it.");
    }
  });

  it('refuses the other edge columns (Prioritized, Done) the same way', () => {
    for (const edge of ['prioritized', 'done']) {
      const result = composeRunRequest(base({ workingPhase: phase(edge, { title: edge, handover: 'none' }) }));
      expect(result.ok).toBe(false);
      expect(result.ok ? '' : result.error).toContain("the owner's column: the fleet takes nothing from it. Start its chain to run it.");
    }
  });

  it('the owner\'s own dialog and Accept\'s commit step stay: neither takes a ticket for the fleet', () => {
    expect(composeRunRequest(base({ workingPhase: inbox, interactive: 'plan' })).ok).toBe(true);
    expect(composeRunRequest(base({ workingPhase: phase('done', { handover: 'manual' }), commitStep: true })).ok).toBe(true);
  });

  it('a working column still runs, whatever its handover says (req-307: the holder dispatches)', () => {
    expect(composeRunRequest(base({ workingPhase: phase('building', { handover: 'agent build-default' }) })).ok).toBe(true);
    expect(composeRunRequest(base({ workingPhase: phase('active', { handover: 'manual' }) })).ok).toBe(true);
  });
});

describe('composeRunRequest — a store ticket has no file (D-30)', () => {
  const dk = { bin: 'dk', store: 'S:/board', dataDir: '', checkout: '', parkStage: null, trailers: false };

  it('the brief names the working copy, never the virtual path that exists on no disk', () => {
    const result = composeRunRequest(base({ dk }));
    if (!result.ok) {
      throw new Error(result.error);
    }
    expect(result.request.instruction).toMatch(/The ticket file: \S*_workcopy[\\/]T-0001\.ticket\.md\. Use this path directly/);
    expect(result.request.instruction).toContain('The ticket file named above: the spec fixture');
    expect(result.request.instruction).not.toMatch(/prioritized[\\/]T-0001\.md/);
    expect(result.request.ticketRelPath).toBe('tickets/prioritized/T-0001.md'); // the card's virtual path stays its identity
  });

  it('a file board keeps the real path', () => {
    const result = composeRunRequest(base());
    expect(result.ok && result.request.instruction).toMatch(/The ticket file: \S*prioritized[\\/]T-0001\.md\. Use this path directly/);
  });
});

describe('composeRunRequest — a refusal says what the gate counts (D-31)', () => {
  const withCriteria = (lines: string): string => TICKET.replace('- [ ] `npm run verify:unit` — exits 0', lines);

  it('prose criteria are reported as prose, never as none', () => {
    const result = composeRunRequest(base({ ticketText: withCriteria('- [ ] the image shows\n- [ ] it is blue') }));
    expect(result.ok ? '' : result.error).toBe(
      'T-0001 has no runnable acceptance criteria: the machine gate runs only "- [ ] `command`" lines under "### Acceptance criteria" and found none; the 2 criteria there are prose.',
    );
  });

  it('one prose criterion, in the singular', () => {
    const result = composeRunRequest(base({ ticketText: withCriteria('- [ ] the image shows') }));
    expect(result.ok ? '' : result.error).toContain('found none; the 1 criterion there is prose.');
  });

  it('an empty section and a missing one each say what was found', () => {
    const empty = composeRunRequest(base({ ticketText: withCriteria('') }));
    expect(empty.ok ? '' : empty.error).toContain('found none; the section is empty.');
    const missing = composeRunRequest(base({ ticketText: TICKET.replace('### Acceptance criteria', '### Notes') }));
    expect(missing.ok ? '' : missing.error).toContain('found none; the ticket has no such section.');
  });
});

describe('composeRunRequest — a persona\'s skills ride along (D-46)', () => {
  const persona = { id: 'build-default', worker: 'opencode', model: 'm', prompt: 'You build.', memory: '' };
  const skills = [
    { name: 'angular-tests', text: 'Run the suite with --include.' },
    { name: 'commits', text: 'One change per commit.' },
  ];

  it('in the brief, in the stable part before the plan', () => {
    const result = composeRunRequest(base({ persona: { ...persona, skills } }));
    if (!result.ok) {
      throw new Error(result.error);
    }
    const text = result.request.instruction;
    expect(text).toContain('## Skills');
    expect(text).toContain('### angular-tests\n\nRun the suite with --include.');
    expect(text).toContain('### commits\n\nOne change per commit.');
    expect(text.indexOf('You build.')).toBeLessThan(text.indexOf('## Skills'));
    expect(text.indexOf('## Skills')).toBeLessThan(text.indexOf('## Plan'));
    expect(result.request.continuationInstruction).not.toContain('## Skills'); // a resumed session holds them
  });

  it('a changed skill changes the digest, so a resumed session gets the full brief', () => {
    const one = composeRunRequest(base({ persona: { ...persona, skills } }));
    const other = composeRunRequest(base({ persona: { ...persona, skills: [{ name: 'commits', text: 'Squash.' }] } }));
    expect(one.ok && other.ok && one.request.briefDigest !== other.request.briefDigest).toBe(true);
  });

  it('a persona without skills leaves the brief as it was', () => {
    const none = composeRunRequest(base({ persona }));
    const empty = composeRunRequest(base({ persona: { ...persona, skills: [] } }));
    expect(none.ok && none.request.instruction).not.toContain('## Skills');
    expect(none.ok && empty.ok && none.request.instruction === empty.request.instruction).toBe(true);
  });

  it('a scout run carries them too', () => {
    const result = composeRunRequest(base({ card: card({ meta: { ...card().meta, form: 'scout' } }), persona: { ...persona, skills } }));
    expect(result.ok && result.request.instruction).toContain('### commits');
  });
});

describe('composeRunRequest', () => {
  it('builds a dispatched run: the pull stays in its phase, the pool is the working column', () => {
    const result = composeRunRequest(
      base({
        workingPhase: phase('plan', { handover: 'agent plan-default', worker: 'opencode', model: 'zai/glm-5.3' }),
        dispatchedBy: 'plan',
      }),
    );
    if (!result.ok) {
      throw new Error(result.error);
    }
    expect(result.request.phase).toBe('prioritized'); // where the file sits
    expect(result.request.column).toBe('plan'); // the pool whose slot it takes
    expect(result.request.provider).toBe('opencode');
    expect(result.request.model).toBe('zai/glm-5.3');
    expect(result.request.recordWorker).toBeUndefined(); // the orchestrator never re-pins
    expect(result.request.instruction).toContain('Completion discipline');
    expect(result.request.instruction).toContain('It should work.');
  });

  it('a run with a cursor carries it (a green end hands on by it); a run without one carries none', () => {
    const cursor = { at: 1, length: 3 };
    const chained = composeRunRequest(base({ workingPhase: phase('active', { handover: 'manual' }), cursor }));
    const alone = composeRunRequest(base({ workingPhase: phase('active', { handover: 'manual' }) }));
    expect(chained.ok && chained.request.cursor).toEqual(cursor);
    expect(alone.ok && alone.request.cursor).toBeUndefined();
  });

  it('an owner run records the dialog choice and carries no column', () => {
    const result = composeRunRequest(
      base({ workingPhase: phase('build', { handover: 'agent build-default' }), workerChoice: 'claude-code/sonnet' }),
    );
    if (!result.ok) {
      throw new Error(result.error);
    }
    expect(result.request.provider).toBe('claude-code');
    expect(result.request.model).toBe('sonnet');
    expect(result.request.recordWorker).toBe('claude-code/sonnet');
    expect(result.request.column).toBeUndefined();
  });

  it('threads the handover ask through — explicit from the dialog, auto from the dispatcher (T-0049)', () => {
    const explicit = composeRunRequest(base({ handover: 'resume-compact' }));
    expect(explicit.ok && explicit.request.handover).toBe('resume-compact');
    const auto = composeRunRequest(base({ dispatchedBy: 'build', handover: 'auto' }));
    expect(auto.ok && auto.request.handover).toBe('auto');
    // Absent — every older caller — stays absent: the supervisor reads fresh.
    const absent = composeRunRequest(base({}));
    expect(absent.ok && absent.request.handover).toBeUndefined();
  });

  it('an interactive dialog composes without acceptance criteria, carries the mode, and moves nothing (req-65)', () => {
    const noCriteria = TICKET.replace('- [ ] `npm run verify:unit` — exits 0\n', '');
    const result = composeRunRequest(
      base({
        ticketText: noCriteria,
        workingPhase: phase('plan', { handover: 'agent plan-default', interactive: 'plan-interactive-default' }),
        cursor: { at: 1, length: 3 },
        interactive: 'plan',
      }),
    );
    if (!result.ok) {
      throw new Error(result.error);
    }
    expect(result.request.interactive).toBe('plan');
    expect(result.request.cursor).toBeUndefined(); // the owner moves the ticket: no cursor rides a dialog
    expect(result.request.instruction).toContain('Dialog discipline');
    expect(result.request.instruction).not.toContain('Completion discipline');
    expect(result.request.instruction).toContain('QUESTION:'); // the asking protocol rides the dialog too

    // A dispatched (non-interactive) compose keeps every default.
    const normal = composeRunRequest(base({}));
    if (!normal.ok) {
      throw new Error(normal.error);
    }
    expect(normal.request.interactive).toBeUndefined();
    expect(normal.request.instruction).toContain('Completion discipline');
  });

  it('the assignment ring: ticket pin over column over handover pin over repo over default', () => {
    const pinned = card({ meta: { ...card().meta, worker: 'claude-code' } });
    const ticketWins = composeRunRequest(
      base({
        card: pinned,
        workingPhase: phase('plan', { handover: 'agent plan-default', worker: 'opencode' }),
      }),
    );
    expect(ticketWins.ok && ticketWins.request.provider).toBe('claude-code');

    const columnWins = composeRunRequest(
      base({ workingPhase: phase('plan', { handover: 'agent plan-default@claude-code', worker: 'opencode' }) }),
    );
    expect(columnWins.ok && columnWins.request.provider).toBe('opencode');

    const handoverWins = composeRunRequest(
      base({ workingPhase: phase('plan', { handover: 'agent plan-default@claude-code' }) }),
    );
    expect(handoverWins.ok && handoverWins.request.provider).toBe('claude-code');
  });

  it('refuses the honest reasons: no repo, no checkout, no gate', () => {
    const noRepo = composeRunRequest(base({ repo: null }));
    expect(noRepo.ok).toBe(false);
    const noPath = composeRunRequest(base({ repo: { ...REPO, path: null } }));
    expect(noPath.ok).toBe(false);
    const noGate = composeRunRequest(
      base({ ticketText: TICKET.replace('- [ ] `npm run verify:unit` — exits 0', 'prose only') }),
    );
    expect(noGate.ok).toBe(false);
  });

  it('threads the context pack into the instruction and reports its truncations', () => {
    const failure = [...Array(80).keys()].map((i) => `row ${i + 1}: assertion ${i + 1} failed`).join('\n');
    const result = composeRunRequest(
      base({
        repoInstructions: '# Repo rules',
        diffStat: ' src/a.ts | 2 +-',
        gateFailure: `\`npm run verify:unit\` failed\n\n${failure}`,
        caps: { gateFailureLines: 40, gateFailureBytes: 4096, diffStatLines: 50, diffStatBytes: 4096 },
      }),
    );
    if (!result.ok) {
      throw new Error(result.error);
    }
    expect(result.request.instruction).toContain('# Repo rules');
    expect(result.request.instruction).toContain('src/a.ts | 2 +-');
    expect(result.request.instruction).toContain('row 80: assertion 80 failed');
    expect(result.truncations).toEqual([{ section: 'gateFailure', originalSize: Buffer.byteLength(`\`npm run verify:unit\` failed\n\n${failure}`, 'utf8') }]);
  });

  it('carries a resume continuation without the stable brief, and a digest only the stable parts move (req-80)', () => {
    const compose = (over: Parameters<typeof base>[0]): RunRequest => {
      const result = composeRunRequest(base({ repoInstructions: '# Repo rules', ...over }));
      if (!result.ok) {
        throw new Error(result.error);
      }
      return result.request;
    };
    const first = compose({ diffStat: ' src/a.ts | 2 +-', gateFailure: 'gate red: x failed' });
    expect(first.continuationInstruction).toContain('src/a.ts | 2 +-');
    expect(first.continuationInstruction).toContain('gate red: x failed');
    expect(first.continuationInstruction).not.toContain('# Repo rules');
    expect(first.continuationInstruction!.length).toBeLessThan(first.instruction.length);

    const retry = compose({ diffStat: ' src/b.ts | 9 +++', gateFailure: 'other failure' });
    expect(retry.briefDigest).toBe(first.briefDigest);
    const newRules = compose({ repoInstructions: '# Other rules' });
    expect(newRules.briefDigest).not.toBe(first.briefDigest);
  });
});

describe('multi-repo runs (req-72)', () => {
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

  it('carries one worktree per extra repo and names them in the brief', () => {
    const result = composeRunRequest(base({ extraRepos: [EXTRA] }));
    if (!result.ok) {
      throw new Error(result.error);
    }
    expect(result.request.extraRepos).toHaveLength(1);
    expect(result.request.extraRepos![0]).toMatchObject({ name: 'lariscus', repoPath: 'E:/code/lariscus', baseRef: 'main' });
    expect(result.request.extraRepos![0]!.worktreePath).toContain('T-0001');
    expect(result.request.instruction).toContain('Further repositories this ticket names');
    expect(result.request.instruction).toContain('lariscus');
  });

  it('skips the primary when it appears twice and omits the field on single-repo tickets', () => {
    const twice = composeRunRequest(base({ extraRepos: [REPO] }));
    if (!twice.ok) {
      throw new Error(twice.error);
    }
    expect(twice.request.extraRepos).toBeUndefined();
    expect(composeRunRequest(base()).ok).toBe(true);
  });

  it('refuses an extra repo without a checkout', () => {
    const result = composeRunRequest(base({ extraRepos: [{ ...EXTRA, path: null }] }));
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('lariscus') });
  });
});

describe('composeRunRequest — the ticket\'s project (req-282)', () => {
  const building = phase('building', { handover: 'agent build-default' });

  it('the purpose reaches the instruction and changes the brief digest; an Unassigned ticket composes as before', () => {
    const plain = composeRunRequest(base({ workingPhase: building }));
    const withProject = composeRunRequest(base({ workingPhase: building, project: { name: 'Drey', purpose: 'The note app.' } }));
    const unassigned = composeRunRequest(base({ workingPhase: building, project: null }));
    if (!plain.ok || !withProject.ok || !unassigned.ok) {
      throw new Error('expected three composed requests');
    }
    expect(withProject.request.instruction).toContain('## Project\n\nThis ticket belongs to the project "Drey".\n\nThe note app.');
    expect(withProject.request.briefDigest).not.toBe(plain.request.briefDigest);
    expect(unassigned.request).toEqual(plain.request);
  });

  it("req-283: the project's id rides the request as projectId (the worker's vault reach), outside the brief", () => {
    const named = composeRunRequest(base({ workingPhase: building, project: { id: 'drey', name: 'Drey', purpose: 'The note app.' } }));
    const anonymous = composeRunRequest(base({ workingPhase: building, project: { name: 'Drey', purpose: 'The note app.' } }));
    if (!named.ok || !anonymous.ok) {
      throw new Error('expected two composed requests');
    }
    expect(named.request.projectId).toBe('drey');
    expect(named.request.briefDigest).toBe(anonymous.request.briefDigest);
    expect(anonymous.request.projectId).toBeUndefined();
  });
});
