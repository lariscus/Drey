import { describe, expect, it } from 'vitest';
import type { ChainEntry } from '../contracts/chain';
import type { TicketCard } from '../contracts/tickets';
import { crewLookupOf } from '../core/chain-holder';
import { parseChainItems } from '../core/chain-list';
import { placementColumnsOf } from '../core/chain-placement';
import { pipelinePhaseOf } from '../core/pipeline-phase';
import type { HolderPlacement } from '../store/store-board';
import { ownerAcceptOf, ownerSendBackOf } from './chain-owner-moves';

function chain(line: string): ChainEntry[] {
  const parsed = parseChainItems(line.split(';'));
  if (!parsed.ok) {
    throw new Error(`bad chain ${line}`);
  }
  return [...parsed.entries];
}

const PLACEMENT: HolderPlacement = {
  columns: placementColumnsOf([
    pipelinePhaseOf({}, 'inbox', []),
    pipelinePhaseOf({}, 'shaping', []),
    pipelinePhaseOf({}, 'prioritized', []),
    pipelinePhaseOf({ handover: 'agent', claim: true }, 'building', []),
    pipelinePhaseOf({}, 'ready', []),
    pipelinePhaseOf({}, 'done', []),
  ]),
  lookup: crewLookupOf(new Map([['paul', 'agent'], ['ben', 'agent'], ['ralf', 'agent'], ['tessa', 'agent'], ['pia', 'mission'], ['you', 'human']] as const)),
};

function card(phase: string, line: string, at: number, repo: string | null = 'drey'): TicketCard {
  return { id: 'T-1', phase, meta: { chain: chain(line), at, repo, form: 'ship' } } as unknown as TicketCard;
}

const STANDARD = 'paul:shape; paul; ben; ralf; tessa; you';

describe("the owner's Accept on a chain ticket", () => {
  it('moves the cursor on at a middle position', () => {
    expect(ownerAcceptOf(card('ready', 'ben; you; ralf; you', 2), PLACEMENT)).toEqual({ kind: 'cursor', at: 3, line: 'accepted at position 2 of 4 — position 3 next' });
  });

  it("is the sign-off at the chain's last You entry of a repository ticket: the commit", () => {
    expect(ownerAcceptOf(card('ready', STANDARD, 6), PLACEMENT)).toEqual({ kind: 'commit' });
  });

  it('ends the chain without a commit when it does not end at You, or the ticket has no repository', () => {
    expect(ownerAcceptOf(card('building', 'paul; ben', 2), PLACEMENT).kind).toBe('done');
    expect(ownerAcceptOf(card('ready', STANDARD, 6, null), PLACEMENT).kind).toBe('done');
  });

  it('leaves a ticket in a lifecycle column to the column moves of old', () => {
    expect(ownerAcceptOf(card('prioritized', STANDARD, 1), PLACEMENT)).toEqual({ kind: 'none' });
    expect(ownerAcceptOf(card('done', STANDARD, 7), PLACEMENT)).toEqual({ kind: 'none' });
  });
});

describe("the owner's Send back on a chain ticket", () => {
  it('goes to the nearest earlier agent position, never using the one send-back', () => {
    expect(ownerSendBackOf(card('ready', STANDARD, 6), PLACEMENT)).toEqual({ kind: 'cursor', at: 5, persona: 'tessa' });
  });

  it('is refused without an earlier agent position', () => {
    expect(ownerSendBackOf(card('ready', 'pia; you', 2), PLACEMENT)).toEqual({ kind: 'refused', error: 'there is no agent position before position 2 to send T-1 back to' });
  });
});

describe("the owner's Send back to a picked position (req-270)", () => {
  it('goes to any earlier position the owner picked', () => {
    expect(ownerSendBackOf(card('ready', STANDARD, 6), PLACEMENT, 2)).toEqual({ kind: 'cursor', at: 2, persona: 'paul' });
    expect(ownerSendBackOf(card('ready', STANDARD, 6), PLACEMENT, 1)).toEqual({ kind: 'cursor', at: 1, persona: 'paul' });
  });

  it('refuses the cursor itself, a later position or none', () => {
    expect(ownerSendBackOf(card('ready', STANDARD, 4), PLACEMENT, 4).kind).toBe('refused');
    expect(ownerSendBackOf(card('ready', STANDARD, 4), PLACEMENT, 5).kind).toBe('refused');
    expect(ownerSendBackOf(card('ready', STANDARD, 4), PLACEMENT, 0).kind).toBe('refused');
  });
});
