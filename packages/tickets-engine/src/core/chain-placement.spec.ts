import { describe, expect, it } from 'vitest';
import type { ChainEntry } from '../contracts/chain';
import type { PipelinePhase } from '../contracts/tickets';
import { crewLookupOf } from './chain-holder';
import { parseChainItems } from './chain-list';
import { chainColumnOf, chainFinished, cursorForColumn, placementColumnsOf } from './chain-placement';
import { pipelinePhaseOf } from './pipeline-phase';

function chain(line: string): ChainEntry[] {
  const parsed = parseChainItems(line.split(';'));
  if (!parsed.ok) {
    throw new Error(`bad chain ${line}`);
  }
  return [...parsed.entries];
}

const phase = (id: string, keys: Record<string, unknown> = {}): PipelinePhase => pipelinePhaseOf(keys, id, []);

/** The owner's live pipeline (concept §0): one agent column with the build persona, Ready to try as the checkpoint. */
const OWNER: PipelinePhase[] = [
  phase('inbox', { persona: 'you' }),
  phase('shaping', { persona: 'you' }),
  phase('prioritized', { persona: 'you' }),
  phase('building', { handover: 'agent build-default', persona: 'build-default', claim: true }),
  phase('ready', { persona: 'you' }),
  phase('done'),
];
const COLUMNS = placementColumnsOf(OWNER);
const CREW = crewLookupOf(new Map([['pia', 'mission'], ['paul', 'agent'], ['ben', 'agent'], ['ralf', 'agent'], ['tessa', 'agent'], ['you', 'human']] as const));
const STANDARD = chain('paul:shape; paul; ben; ralf; tessa; you');
const at = (n: number, awaiting?: string) => chainColumnOf({ stage: 'active', chain: STANDARD, at: n, awaiting }, CREW, COLUMNS);

describe('the placement columns of a pipeline', () => {
  it('reads the terminal, the owner checkpoint, the shape queue and the agent columns', () => {
    expect(COLUMNS).toEqual({ terminal: 'done', owner: 'ready', shape: 'shaping', agents: [{ id: 'building', persona: 'build-default' }] });
  });

  it('has nothing for a pipeline of lifecycle columns only', () => {
    expect(placementColumnsOf([phase('inbox'), phase('prioritized'), phase('done')])).toEqual({ terminal: 'done', owner: null, shape: null, agents: [] });
  });
});

describe('the column of a chain ticket (the interim display, owner 2026-11-12)', () => {
  it('puts the shape entry in Shaping, agents in the agent column, You in Ready to try', () => {
    expect([1, 2, 3, 4, 5, 6].map((n) => at(n))).toEqual(['shaping', 'building', 'building', 'building', 'building', 'ready']);
  });

  it('puts a question and a missing persona at You', () => {
    expect(at(3, 'you')).toBe('ready');
    expect(chainColumnOf({ stage: 'active', chain: chain('ben; bob'), at: 2, awaiting: undefined }, CREW, COLUMNS)).toBe('ready');
  });

  it('prefers the agent column that names the persona', () => {
    const named = placementColumnsOf([phase('inbox'), phase('build', { handover: 'agent', persona: 'ben' }), phase('review', { handover: 'agent', persona: 'ralf' }), phase('ready'), phase('done')]);
    expect(chainColumnOf({ stage: 'active', chain: STANDARD, at: 4, awaiting: undefined }, CREW, named)).toBe('review');
    expect(chainColumnOf({ stage: 'active', chain: STANDARD, at: 5, awaiting: undefined }, CREW, named)).toBe('build');
  });

  it('shows a finished chain in the terminal column', () => {
    expect(chainFinished(STANDARD, 7)).toBe(true);
    expect(chainFinished(STANDARD, 6)).toBe(false);
    expect(at(7)).toBe('done');
  });

  it('has no column when the pipeline has none for the holder', () => {
    const edges = placementColumnsOf([phase('inbox'), phase('prioritized'), phase('done')]);
    expect(chainColumnOf({ stage: 'active', chain: STANDARD, at: 3, awaiting: undefined }, CREW, edges)).toBeNull();
  });
});

describe("an owner's column move as a cursor move", () => {
  it('hands on to the first position standing in the target column at or after the cursor', () => {
    expect(cursorForColumn({ chain: STANDARD, at: 1, target: 'building' }, CREW, COLUMNS)).toBe(2);
    expect(cursorForColumn({ chain: STANDARD, at: 3, target: 'ready' }, CREW, COLUMNS)).toBe(6);
  });

  it('goes back when no later position stands there', () => {
    expect(cursorForColumn({ chain: STANDARD, at: 6, target: 'building' }, CREW, COLUMNS)).toBe(5);
    expect(cursorForColumn({ chain: STANDARD, at: 4, target: 'shaping' }, CREW, COLUMNS)).toBe(1);
  });

  it('answers null for a column no position stands in', () => {
    expect(cursorForColumn({ chain: chain('ben; ralf'), at: 1, target: 'ready' }, CREW, COLUMNS)).toBeNull();
  });
});
