/**
 * The flow editor's pure half (req-266): edits on the persona list, the
 * locked positions, reset to the standard flow, and the guard.
 */
import { describe, expect, it } from 'vitest';
import type { ChainEntry } from '../contracts/chain';
import { parseChainItems } from './chain-list';
import { validateChain } from './chain-validate';
import { applyFlowOp, type FlowContext, type FlowOp } from './flow-edit';

const PERSONAS = ['paul', 'ben', 'ralf', 'tessa', 'you'];

function list(line: string): ChainEntry[] {
  const parsed = parseChainItems(line.split(';'));
  if (!parsed.ok) {
    throw new Error(`unreadable: ${parsed.bad}`);
  }
  return [...parsed.entries];
}

const STANDARD = list('paul:shape; paul; ben; ralf; tessa; you');

function context(saved: string, locked: number): FlowContext {
  return { personas: PERSONAS, saved: list(saved), locked, standard: STANDARD };
}

function run(chain: string, edit: FlowOp, locked = 0): string[] {
  const result = applyFlowOp(list(chain), edit, context(chain, locked));
  if (!result.ok) {
    throw new Error(result.error);
  }
  return [...result.chain];
}

function refusal(chain: string, edit: FlowOp, locked = 0): string {
  const result = applyFlowOp(list(chain), edit, context(chain, locked));
  if (result.ok) {
    throw new Error('expected a refusal');
  }
  return result.error;
}

describe('validateChain', () => {
  it('accepts known personas and refuses unknown ones, an empty chain and an edit of a locked position', () => {
    expect(validateChain(STANDARD, context('paul; ben', 0))).toBeNull();
    expect(validateChain(list('paul; bob'), context('paul', 0))).toMatch(/position 2: persona "bob" does not exist/);
    expect(validateChain([], context('paul', 0))).toMatch(/at least one persona/);
    expect(validateChain(list('paul; ralf; you'), context('paul; ben; you', 2))).toMatch(/position 2 \(ben\) is the current step/);
    expect(validateChain(list('paul; ben; tessa'), context('paul; ben; you', 2))).toBeNull();
  });

  it('req-269: accepts Mission Control\'s persona as an entry, and a mode only on an agent\'s entry', () => {
    const withPia = (saved: string, locked: number): FlowContext => ({ ...context(saved, locked), personas: [...PERSONAS, 'pia'], modeless: ['pia'] });
    expect(validateChain(list('pia; you'), withPia('paul', 0))).toBeNull();
    expect(validateChain(list('paul:shape; pia(notify); ben; you'), withPia('paul', 0))).toBeNull();
    expect(validateChain(list('pia:shape; you'), withPia('paul', 0))).toMatch(/position 1: only an agent persona's entry takes a mode — pia:shape/);
    expect(validateChain(list('paul; you:shape'), withPia('paul', 0))).toMatch(/position 2: only an agent persona's entry takes a mode/);
    expect(validateChain(list('paul; you:shape'), context('paul', 0))).toMatch(/only an agent persona's entry takes a mode/);
    expect(validateChain(list('you:shape; ben'), withPia('you:shape; paul', 1))).toBeNull();
  });

  it('lets the current entry change its notify rule, never a past one', () => {
    expect(validateChain(list('paul; ben(notify); you'), context('paul; ben; you', 2))).toBeNull();
    expect(validateChain(list('paul(notify); ben; you'), context('paul; ben; you', 2))).toMatch(/position 1 \(paul\) is done/);
  });
});

describe('applyFlowOp', () => {
  it('adds, removes and moves personas', () => {
    expect(run('paul; ben; you', { op: 'insert', persona: 'ralf', after: 1 })).toEqual(['paul', 'ben', 'ralf', 'you']);
    expect(run('paul; ben; you', { op: 'insert', persona: 'tessa', after: -1 })).toEqual(['tessa', 'paul', 'ben', 'you']);
    expect(run('paul; ben; ralf; you', { op: 'remove', step: 2 })).toEqual(['paul', 'ben', 'you']);
    expect(run('paul; ben; ralf; you', { op: 'move', step: 2, dir: -1 })).toEqual(['paul', 'ralf', 'ben', 'you']);
  });

  it('allows the same persona twice', () => {
    expect(run('paul; ben; you', { op: 'insert', persona: 'paul', after: 1 })).toEqual(['paul', 'ben', 'paul', 'you']);
  });

  it('changes who takes a position and the notify rule', () => {
    expect(run('paul; ben; you', { op: 'persona', step: 1, persona: 'ralf' })).toEqual(['paul', 'ralf', 'you']);
    expect(run('paul:shape; ben', { op: 'persona', step: 0, persona: 'ralf' })).toEqual(['ralf:shape', 'ben']);
    expect(run('paul; ben; you', { op: 'notify', step: 1, on: true })).toEqual(['paul', 'ben(notify)', 'you']);
  });

  it('resets to the standard flow behind the locked positions', () => {
    expect(run('ben; you', { op: 'reset' })).toEqual(['paul:shape', 'paul', 'ben', 'ralf', 'tessa', 'you']);
    expect(run('paul:shape; ralf; you', { op: 'reset' }, 2)).toEqual(['paul:shape', 'ralf', 'ben', 'ralf', 'tessa', 'you']);
  });

  it('locks past positions and the current one', () => {
    expect(refusal('paul; ben; you', { op: 'remove', step: 1 }, 2)).toMatch(/position 2 is the current step/);
    expect(refusal('paul; ben; you', { op: 'persona', step: 0, persona: 'ralf' }, 2)).toMatch(/position 1 is done/);
    expect(refusal('paul; ben; you', { op: 'insert', persona: 'ralf', after: 0 }, 2)).toMatch(/position 2 is the current step/);
    expect(refusal('paul; ben; ralf; you', { op: 'move', step: 2, dir: -1 }, 2)).toMatch(/cannot move ahead of position 2/);
    expect(run('paul; ben; you', { op: 'notify', step: 1, on: true }, 2)).toEqual(['paul', 'ben(notify)', 'you']);
    expect(run('paul; ben; you', { op: 'insert', persona: 'ralf', after: 1 }, 2)).toEqual(['paul', 'ben', 'ralf', 'you']);
  });

  it('refuses an unknown persona, a missing position and an empty result', () => {
    expect(refusal('paul; you', { op: 'insert', persona: 'bob', after: 0 })).toMatch(/persona "bob" does not exist/);
    expect(refusal('paul; you', { op: 'remove', step: 5 })).toMatch(/no such position/);
    expect(refusal('paul', { op: 'remove', step: 0 })).toMatch(/at least one persona/);
    expect(refusal('paul; you', { op: 'move', step: 1, dir: 1 })).toMatch(/last position/);
  });
});
