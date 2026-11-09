import type { RunInfo } from '../../protocol';
import type { RunFact } from './tranche-record';

/** A run's change in lines; null when it could not be read. */
export interface ChangeLines {
  readonly added: number;
  readonly removed: number;
}

/** Reads what a run changed in its worktree (the composition root passes git). */
export interface ChangeSizeReader {
  linesOf(run: Pick<RunInfo, 'worktreePath' | 'startedAt'>): Promise<ChangeLines | null>;
}

/** A settled run as the tranche keeps it. */
export class RunFacts {
  constructor(private readonly change: ChangeSizeReader) {}

  async of(info: RunInfo, at: string): Promise<RunFact> {
    const lines = info.form === 'scout' ? null : await this.change.linesOf(info);
    return {
      runId: info.id,
      ticket: info.ticketId,
      phase: info.phase ?? info.column ?? null,
      persona: info.persona ?? null,
      gate: info.gateResult ?? null,
      costUsd: info.costUsd,
      added: lines?.added ?? null,
      removed: lines?.removed ?? null,
      at,
    };
  }
}
