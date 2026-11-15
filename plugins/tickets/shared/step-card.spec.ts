import { describe, expect, it } from 'vitest';
import { stepCardOf, type StepCardInput } from './step-card';

const PIPELINE = [
  { id: 'inbox', title: 'Inbox' },
  { id: 'prioritized', title: 'Prioritized' },
  { id: 'done', title: 'Done' },
];

const base: StepCardInput = {
  pipeline: PIPELINE,
  phaseId: 'prioritized',
  atCheckpoint: true,
  hasReport: true,
  launchable: true,
};

describe('stepCardOf', () => {
  it('a checkpoint the owner waits at is a gate card with the next column in its move', () => {
    expect(stepCardOf(base)).toEqual({
      kind: 'gate',
      acceptLabel: 'Move to Done',
      canLaunch: true,
      canSendBack: true,
    });
  });

  it('offers Launch only when a worktree and a command exist', () => {
    expect(stepCardOf({ ...base, launchable: false }).canLaunch).toBe(false);
  });

  it('the terminal column is a final card with Archive alone — even when the worktree is gone', () => {
    expect(stepCardOf({ ...base, phaseId: 'done', atCheckpoint: false, launchable: false })).toEqual({
      kind: 'final',
      acceptLabel: 'Archive',
      canLaunch: false,
      canSendBack: false,
    });
  });

  it('a Done ticket without any report shows no card', () => {
    expect(stepCardOf({ ...base, phaseId: 'done', atCheckpoint: false, hasReport: false }).kind).toBe('none');
  });

  it('a ticket an agent works (no checkpoint) shows no card, report or not', () => {
    expect(stepCardOf({ ...base, phaseId: 'prioritized', atCheckpoint: false }).kind).toBe('none');
  });

  it('an unknown phase shows no card', () => {
    expect(stepCardOf({ ...base, phaseId: 'ghost' }).kind).toBe('none');
  });
});
