import { phaseWithoutPoolKeys, type PipelinePhase, type TicketCard } from '../contracts/tickets';
import type { composeRunRequest } from './request';
import type { DisciplineTexts } from './discipline-texts';

/** The fixtures of composeRunRequest's specs (request.spec.ts, request-personas.spec.ts): a phase, a card, the ticket text, the repo, the request's base input. */

/**
 * The discipline fixture (req-279): short stand-ins, not the shipped files —
 * this support file compiles with the production program (no top-level
 * await), and the specs assert which discipline rides which brief by the
 * opening phrase, never its bytes. The real texts are pinned by
 * `discipline-texts.spec.ts` and ride `assignment.spec.ts`.
 */
export const DISCIPLINES: DisciplineTexts = {
  completion: 'Completion discipline: the spec fixture of the completion text. BLOCKED: <reason in one line>.',
  handover: 'Handover: the spec fixture of the handover text.',
  interactive: 'Dialog discipline: the spec fixture of the dialog text.',
  asking: 'Asking the owner: the spec fixture of the asking text. QUESTION: <the question>.',
  scout: 'Scout discipline: the spec fixture of the scout text. BLOCKED: <reason in one line>.',
  signals: 'Signals: the spec fixture of the signals text. BLOCKED: <reason in one line>.',
  working: 'How to work: the spec fixture of the working text.',
  writing: 'Changing files: the spec fixture of the writing text.',
  readOnly: 'Read-only: the spec fixture of the read-only text.',
  ticketFile: 'The ticket file named above: the spec fixture of the ticket-file text.',
  language: 'Language: the spec fixture of the language text.',
  precedence: 'Precedence: the spec fixture of the precedence text.',
  fragments: { planFormat: 'The plan format: the spec fixture.', chainGrammar: 'The chain grammar: the spec fixture.' },
};


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
    disciplines: DISCIPLINES,
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
