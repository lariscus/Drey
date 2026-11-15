import { networkFieldOf, personaRunAllowedOf, type Persona } from '../core/persona';
import { noHarnessReason, personaHarnessOf } from './persona-harness';
import type { CapabilityClass, ModelRow, RunRequest, WorkerProviderId } from './protocol';
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
  /** The model table's rows (req-288: the harness follows from the model); null = no table. */
  readonly rows?: readonly ModelRow[] | null;
  /** The git executable. */
  readonly git?: string;
}

export type OneOnOneRequestResult = { readonly ok: true; readonly request: RunRequest } | { readonly ok: false; readonly error: string };

/**
 * The 1:1's start request (req-168, ADR-0093, R1/R12): the persona's pinned
 * model, else the first model of its class (req-288, {@link personaHarnessOf}),
 * asked of the pool like any session — that model's class as the class request, the persona's budget
 * on its ledger, no ticket allowance — with no ticket, no worktree, no
 * gate and no move, started in the tickets repository, read-only. A persona
 * no harness follows for (no pin, no model of its class) has no 1:1 session.
 */
export class OneOnOneRequestBuilder {
  build(input: OneOnOneInput): OneOnOneRequestResult {
    const { persona } = input;
    const harness = personaHarnessOf(persona, input.rows ?? null);
    if (harness === null) {
      return { ok: false, error: `${noHarnessReason(persona)} — its 1:1 cannot start` };
    }
    return { ok: true, request: this.requestOf(input, harness, harness.class) };
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
      ...networkFieldOf(personaRunAllowedOf(persona)),
      model: harness.model,
      instruction: input.instruction,
      acceptance: [],
      gate: 'none',
      git: input.git ?? 'git',
      origin: input.origin,
      column: null,
      ...(poolClass !== null ? { poolClass } : {}),
      poolWhy: `1:1 with ${persona.id}: ${harness.model ?? `${harness.provider}'s default`}`,
      ledger: { allowance: null, personaBudget: persona.budget, spendAboveAllowance: false, noTicket: true },
      session: { kind: '1:1', persona: persona.id, workingDirectory: ticketsVaultPath, chatFile: input.chatFile },
    };
  }
}
