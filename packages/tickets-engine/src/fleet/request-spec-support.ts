import { phaseWithoutPoolKeys, type PipelinePhase, type TicketCard } from '../contracts/tickets';
import type { composeRunRequest } from './request';

/** The fixtures of composeRunRequest's specs (request.spec.ts, request-personas.spec.ts): a phase, a card, the ticket text, the repo, the request's base input. */

export function phase(id: string, over: Partial<PipelinePhase> = {}): PipelinePhase {
  return phaseWithoutPoolKeys({ id, title: id, wip: null, claim: false, handover: 'manual', ...over });
}

export function card(over: Partial<TicketCard> = {}): TicketCard {
  return {
    id: 'T-0001',
    path: 'tickets/prioritized/T-0001.md',
    phase: 'prioritized',
    meta: {
      id: 'T-0001',
      title: 'Add the thing',
      repo: 'drey',
      repos: ['drey'],
      worker: null,
      persona: null,
      track: null,
      priority: 'normal',
      rank: 5000,
      branch: null,
      claimedBy: null,
      claimedAt: null,
      run: null,
      references: [],
      blockedBy: [],
      parkedReason: null,
      parkedAt: null,
      interactive: false,
      entered: {},
    },
    worker: 'opencode',
    blocked: [],
    blocks: [],
    issues: [],
    ...over,
  };
}

export const TICKET = [
  '---',
  'id: T-0001',
  'title: "Add the thing"',
  'repo: drey',
  'priority: normal',
  'rank: 5000',
  'branch: t/T-0001',
  "entered-prioritized: '2026-10-18T10:00:00Z'",
  '---',
  '',
  '## Description',
  '',
  'It should work.',
  '',
  '## Plan',
  '',
  'Step one.',
  '',
  '### Acceptance criteria',
  '',
  '- [ ] `npm run verify:unit` — exits 0',
  '',
  '## Log',
  '',
].join('\n');

export const REPO = { name: 'drey', url: 'https://example.test/drey.git', branch: 'main', policy: null, path: 'W:/drey', worker: null, worktrees: null, launch: null, instructions: null };

export function base(over: Partial<Parameters<typeof composeRunRequest>[0]> = {}): Parameters<typeof composeRunRequest>[0] {
  return {
    origin: 'spec',
    card: card(),
    ticketText: TICKET,
    vaultPath: 'V:/tickets',
    workingPhase: null,
    nextPhaseId: 'plan',
    nextPhaseDir: null,
    pushRemote: null,
    nextPhaseClaims: false,
    repo: REPO,
    promptText: null,
    defaultWorker: 'opencode',
    permissionMode: 'accept-edits',
    gitPath: '',
    workerChoice: null,
    repoInstructions: null,
    diffStat: null,
    gateFailure: null,
    ...over,
  };
}
