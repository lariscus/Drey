import { splitPoolEntry, type Persona } from '../core/persona';
import { parseWorkerValue } from './assignment';
import type { CapabilityClass, RunRequest, WorkerProviderId } from './protocol';
import { ONE_ON_ONE_TICKET } from './protocol-session';

/** What one 1:1's start is composed from. */
export interface OneOnOneInput {
  readonly persona: Persona;
  /** Absolute path of the tickets repository: the 1:1's working directory (R12). */
  readonly ticketsVaultPath: string;
  /** Vault-relative chat session file of the conversation (R3). */
  readonly chatFile: string;
  /** The composed 1:1 brief ({@link composeOneOnOneBrief}). */
  readonly instruction: string;
  /** Who asks: `drey:1:1`, `device <name> (<id>)`. */
  readonly origin: string;
  /** The model table's class of a model on a provider; null when the table holds no row for it. */
  readonly classOf?: (provider: WorkerProviderId, model: string | null) => CapabilityClass | null;
  /** The git executable. */
  readonly git?: string;
}

export type OneOnOneRequestResult = { readonly ok: true; readonly request: RunRequest } | { readonly ok: false; readonly error: string };

/** The persona's harness and the model it runs a 1:1 on: its default when that is the harness's, else its pool's first entry of it. */
function harnessOf(persona: Persona): { provider: WorkerProviderId; model: string | null } | null {
  const worker = parseWorkerValue(persona.worker);
  if (worker === null) {
    return null;
  }
  const entries = [persona.models.default, ...persona.models.pool].filter((entry) => entry.trim() !== '').map(splitPoolEntry);
  const own = entries.find((entry) => entry.provider === null || entry.provider === worker.provider);
  return { provider: worker.provider, model: worker.model ?? own?.model ?? null };
}

/**
 * The 1:1's start request (req-168, ADR-0093, R1/R12): the persona's own
 * harness and model, asked of the pool like any session — the model
 * table's class of that model as the class request, the persona's budget
 * on its ledger, no ticket allowance — with no ticket, no worktree, no
 * gate and no move, started in the tickets repository, read-only. A
 * persona whose worker the fleet cannot run (`worker: api`) has no 1:1
 * session: it talks over the chat bridge instead.
 */
export class OneOnOneRequestBuilder {
  build(input: OneOnOneInput): OneOnOneRequestResult {
    const { persona } = input;
    const harness = harnessOf(persona);
    if (harness === null) {
      return { ok: false, error: `${persona.id} runs on "${persona.worker}", which the runner cannot start — its 1:1 goes over the chat bridge` };
    }
    const poolClass = input.classOf?.(harness.provider, harness.model) ?? null;
    return { ok: true, request: this.requestOf(input, harness, poolClass) };
  }

  private requestOf(input: OneOnOneInput, harness: { provider: WorkerProviderId; model: string | null }, poolClass: CapabilityClass | null): RunRequest {
    const { persona, ticketsVaultPath } = input;
    return {
      ticketId: ONE_ON_ONE_TICKET,
      ticketsVaultPath,
      ticketRelPath: '',
      phase: '',
      repoPath: ticketsVaultPath,
      worktreePath: ticketsVaultPath,
      branch: '',
      baseRef: null,
      provider: harness.provider,
      permissionMode: 'read-only',
      model: harness.model,
      instruction: input.instruction,
      acceptance: [],
      gate: 'none',
      git: input.git ?? 'git',
      nextPhase: null,
      nextPhaseDir: null,
      pushRemote: null,
      claimIdentity: null,
      origin: input.origin,
      column: null,
      profile: 'private',
      ...(poolClass !== null ? { poolClass } : {}),
      poolWhy: `1:1 with ${persona.id}: ${harness.model ?? `${harness.provider}'s default`}`,
      ledger: { allowance: null, personaBudget: persona.budget, spendAboveAllowance: false, noTicket: true },
      session: { kind: '1:1', persona: persona.id, workingDirectory: ticketsVaultPath, chatFile: input.chatFile },
    };
  }
}
