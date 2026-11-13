import { describe, expect, it } from 'vitest';
import { crewLookupOf } from '../core/chain-holder';
import { placementColumnsOf } from '../core/chain-placement';
import { pipelinePhaseOf } from '../core/pipeline-phase';
import type { TicketDetail } from '../ports/ticket-store';
import { withChainAndCursor, withCursorForMove } from './chain-move';
import { documentField } from './document-fields';
import type { HolderPlacement } from './store-board';

const PLACEMENT: HolderPlacement = {
  columns: placementColumnsOf([
    pipelinePhaseOf({}, 'inbox', []),
    pipelinePhaseOf({}, 'shaping', []),
    pipelinePhaseOf({}, 'prioritized', []),
    pipelinePhaseOf({ handover: 'agent', claim: true }, 'building', []),
    pipelinePhaseOf({}, 'ready', []),
    pipelinePhaseOf({}, 'done', []),
  ]),
  lookup: crewLookupOf(undefined),
};

const LEGACY = '---\nid: T-1\ntitle: x\nchain:\n  - paul:shape\n  - paul\n  - ben\n  - you\nat: 1\n---\nbody\n';

function record(stage: string, at: string | undefined): TicketDetail {
  return { id: 'T-1', stage, extensions: { 'x-chain': 'paul:shape;paul;ben;you', ...(at !== undefined ? { 'x-at': at } : {}) } } as unknown as TicketDetail;
}

describe("an owner's move of a chain ticket on a lifecycle store", () => {
  it('moves the cursor to the position that stands in the target column', () => {
    expect(documentField(withCursorForMove(LEGACY, record('active', '1'), 'building', PLACEMENT), 'at')).toBe('2');
    expect(documentField(withCursorForMove(LEGACY, record('prioritized', undefined), 'ready', PLACEMENT), 'at')).toBe('4');
  });

  it('keeps the cursor for a lifecycle column, a column no position stands in, or a chainless ticket', () => {
    expect(withCursorForMove(LEGACY, record('active', '3'), 'prioritized', PLACEMENT)).toBe(LEGACY);
    expect(withCursorForMove(LEGACY, record('active', '3'), 'done', PLACEMENT)).toBe(LEGACY);
    expect(withCursorForMove(LEGACY, { id: 'T-1', stage: 'active', extensions: {} } as unknown as TicketDetail, 'building', PLACEMENT)).toBe(LEGACY);
  });
});

describe('the chain and cursor of a persona board move (req-270)', () => {
  it('replaces the whole chain and the cursor and keeps every other key and the body', () => {
    const out = withChainAndCursor(LEGACY, ['paul:shape', 'paul', 'bob', 'you'], 3);
    expect(out).toBe('---\nid: T-1\ntitle: x\nchain: [paul:shape, paul, bob, you]\nat: 3\n---\nbody\n');
  });

  it('adds the keys a chainless ticket lacks', () => {
    expect(withChainAndCursor('---\nid: T-1\n---\nbody\n', ['ben'], 1)).toBe('---\nid: T-1\nchain: [ben]\nat: 1\n---\nbody\n');
  });
});
