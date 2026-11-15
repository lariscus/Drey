/**
 * The pure text of a run's dricket claim (E14-5, ADR-0090): the owner id,
 * the commit trailers and their instruction block.
 * `run-lease.ts` re-exports them.
 */
import { hostname } from 'node:os';

/** `agent-<run id>@<host>` in dk's owner grammar (`[a-z0-9._@-]`, requirements Q-02): stable per run, so an adopted run re-claims idempotently. */
export function runOwnerId(runId: string, host: string = hostname()): string {
  const clean = (text: string): string => text.toLowerCase().replaceAll(/[^a-z0-9._-]/g, '-');
  return `agent-${clean(runId)}@${clean(host)}`;
}

/** The commit trailers of protocol.md ("Code repositories"): what `dk validate --trailers` checks. */
export function dricketTrailers(input: {
  readonly dricketId: string;
  readonly epoch: number;
  readonly actor: string;
  readonly op: string;
}): readonly string[] {
  return [
    `Dricket-Ticket: ${input.dricketId}`,
    `Dricket-Epoch: ${input.epoch}`,
    `Dricket-Op: ${input.op}`,
    `Dricket-Actor: ${input.actor}`,
  ];
}

/** The instruction block that makes a worker's commits carry the trailers. */
export function trailerInstruction(trailers: readonly string[]): string {
  return [
    '## Commit trailers',
    '',
    'The ticket store checks every commit of this branch for these trailers. Put them in the',
    'trailer block (the last paragraph) of every commit message you write, unchanged:',
    '',
    ...trailers.map((line) => `    ${line}`),
  ].join('\n');
}
