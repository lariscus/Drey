import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChainHarness } from './orchestrate/chain-harness.fake';

/** The standard flow with a review column after build (req-183). */
const REVIEW_PIPELINE = [
  '---',
  'phases:',
  '  - { id: inbox, title: Inbox, handover: manual }',
  '  - { id: prioritized, title: Prioritized, handover: manual }',
  '  - { id: build, title: Build, handover: agent build-default, claim: true }',
  '  - { id: review, title: Review, handover: agent review-default }',
  '  - { id: security, title: Security, handover: agent security-default, persona: ralf }',
  '  - { id: commit, title: Commit, handover: manual }',
  '  - { id: done, title: Done, handover: none }',
  '---',
  'Prose.',
  '',
].join('\n');

let h: ChainHarness;

/** req-183: the chain dispatches a review with its own read-only checkout; build keeps the worktree. */
describe('Orchestrator — the review step reads its own checkout (req-183)', () => {
  beforeEach(async () => {
    h = new ChainHarness();
    await h.setUp(REVIEW_PIPELINE);
    await h.write('tickets/_meta/prompts/review-default.md', 'Review it.');
    await h.write('tickets/_meta/prompts/security-default.md', 'Check it.');
  });

  afterEach(async () => {
    await h.tearDown();
  });

  it('a ticket in review is dispatched with <id>-review beside its worktree; a build run carries none', async () => {
    h.io.seed('T-0001', 'review');
    h.io.seed('T-0002', 'build');
    const { orch, fleet } = h.build();
    await orch.configure(h.config());
    await orch.setMaster('run');
    const byTicket = new Map(fleet.records.map((r) => [r.request.ticketId, r.request]));
    expect(byTicket.get('T-0001')?.reviewCheckout).toBe(path.join(h.vaultDir, '_worktrees', 'T-0001-review'));
    expect(byTicket.get('T-0001')?.worktreePath).toBe(path.join(h.vaultDir, '_worktrees', 'T-0001'));
    expect(byTicket.get('T-0001')?.instruction).toContain('Review checkout:');
    expect(byTicket.get('T-0002')?.reviewCheckout).toBeUndefined();
  });

  it('an inserted gate whose persona is a reviewer reviews in a checkout too', async () => {
    await h.writePersona('ralf', { role: 'reviewer' });
    h.io.seed('T-0003', 'security');
    const { orch, fleet } = h.build();
    await orch.configure(h.config());
    await orch.setMaster('run');
    expect(fleet.records.map((r) => r.request.reviewCheckout)).toEqual([path.join(h.vaultDir, '_worktrees', 'T-0003-review')]);
  });
});
