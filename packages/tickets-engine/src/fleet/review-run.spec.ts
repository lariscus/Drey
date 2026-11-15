import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { composeRunRequest } from './request';
import { base, card, phase } from './request-spec-support';
import { isReviewRun } from './review-run';

/** req-183: which runs read the branch in a read-only checkout of their own, and how the request and the brief say so. */
describe('isReviewRun — the standard review phase, or a reviewer persona on any gate', () => {
  it('the standard review phase is a review', () => {
    expect(isReviewRun({ phaseId: 'review', scout: false, interactive: false })).toBe(true);
  });

  it('an inserted gate is a review when its persona is a reviewer', () => {
    expect(isReviewRun({ phaseId: 'security', personaRole: 'reviewer', scout: false, interactive: false })).toBe(true);
    expect(isReviewRun({ phaseId: 'security', personaRole: 'builder', scout: false, interactive: false })).toBe(false);
  });

  it('build, a scout run and an owner dialog never are', () => {
    expect(isReviewRun({ phaseId: 'build', personaRole: null, scout: false, interactive: false })).toBe(false);
    expect(isReviewRun({ phaseId: 'review', scout: true, interactive: false })).toBe(false);
    expect(isReviewRun({ phaseId: 'review', scout: false, interactive: true })).toBe(false);
  });
});

describe('composeRunRequest — a review run carries its checkout (req-183)', () => {
  const review = phase('review');
  const reviewCard = card({ phase: 'review', path: 'tickets/review/T-0001.md' });

  it('the review phase gets <id>-review beside the worktree, and the brief names it read-only', () => {
    const result = composeRunRequest(base({ card: reviewCard, workingPhase: review }));
    if (!result.ok) {
      throw new Error(result.error);
    }
    const expected = path.join('V:/tickets', '_worktrees', 'T-0001-review');
    expect(result.request.reviewCheckout).toBe(expected);
    expect(result.request.permissionMode).toBe('read-only'); // the session's own guard, whatever the board says
    expect(result.request.worktreePath).toBe(path.join('V:/tickets', '_worktrees', 'T-0001')); // the gate's ground stays the worktree
    expect(result.request.instruction).toContain(`Review checkout: ${expected}`);
    expect(result.request.instruction).toContain('It is read-only');
    expect(result.request.instruction).not.toContain('Work checkout:');
    expect(result.request.instruction).toContain('in the worktree at the commit you reviewed');
    expect(result.request.instruction).toContain('Signals: the spec fixture');
    expect(result.request.instruction).toContain('Read-only: the spec fixture');
    expect(result.request.instruction).not.toContain('Changing files:');
    expect(result.request.instruction).not.toContain('Handover: the spec fixture');
    expect(result.request.instruction).not.toContain('you may edit');
  });

  it('a reviewer persona on an inserted gate gets one too', () => {
    const persona = { id: 'ralf', role: 'reviewer', worker: 'claude-code', model: 'opus', prompt: null, memory: '' };
    const result = composeRunRequest(base({ workingPhase: phase('security'), persona }));
    expect(result.ok && result.request.reviewCheckout).toBe(path.join('V:/tickets', '_worktrees', 'T-0001-review'));
  });

  it('a build run carries none, and its brief is unchanged', () => {
    const result = composeRunRequest(base({ workingPhase: phase('build') }));
    expect(result.ok && result.request.reviewCheckout).toBeUndefined();
    expect(result.ok && result.request.permissionMode).toBe('accept-edits');
    expect(result.ok && result.request.instruction).toContain('Work checkout:');
  });
});

