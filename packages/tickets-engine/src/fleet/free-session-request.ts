import type { Persona } from '../core/persona';
import { noHarnessReason, personaHarnessOf } from './persona-harness';
import type { EffectiveCrew, SessionOverrides } from './config/layered-config-resolver';
import { LayeredConfigResolver } from './config/layered-config-resolver';
import type { CapabilityClass, ModelRow, RunRequest, WorkerProviderId } from './protocol';
import { FREE_SESSION_TICKET } from './protocol-session';

/** What one free session's start is composed from. */
export interface FreeSessionInput {
  readonly persona: Persona;
  /** Absolute path of the tickets repository (the request names its vault like every start). */
  readonly ticketsVaultPath: string;
  /** Absolute: the directory the owner named, already checked (`session/session-directory-rule.ts`). */
  readonly directory: string;
  /** The composed free session brief ({@link composeFreeSessionBrief}). */
  readonly instruction: string;
  /** Who asks: `drey:crew`, `service-window`, `chat (Pia's card)`. */
  readonly origin: string;
  /** The vault layer, resolved. */
  readonly crew: Pick<EffectiveCrew, 'permissionMode'>;
  /** The session layer: what the owner set on this session. */
  readonly overrides: SessionOverrides;
  /** The model table's rows (req-288: the harness follows from the model); null = no table. */
  readonly rows?: readonly ModelRow[] | null;
  readonly git?: string;
  /** req-283: the project the session works in (`SessionProjectRule`); null/absent = none, no vault. */
  readonly projectId?: string | null;
}

export type FreeSessionRequestResult = { readonly ok: true; readonly request: RunRequest } | { readonly ok: false; readonly error: string };

/**
 * The free session's start request (req-173, R12): the persona's harness,
 * the model and class the layers resolve (the session record's pin and
 * class over the persona's model; the model table's class when the owner
 * asked for none), the permission mode of the session record over the
 * vault's — the read-only rule of a 1:1 does not apply — asked of the pool
 * like any session with the persona's budget and no ticket allowance, in
 * the directory the owner named. No ticket, no worktree, no gate, no move.
 */
export class FreeSessionRequestBuilder {
  private readonly resolver = new LayeredConfigResolver();

  build(input: FreeSessionInput): FreeSessionRequestResult {
    const { persona } = input;
    const harness = personaHarnessOf(persona, input.rows ?? null);
    if (harness === null) {
      return { ok: false, error: `${noHarnessReason(persona)} — a free session needs a harness` };
    }
    const session = this.resolver.session(input.crew, harness.model, input.overrides);
    const asked = session.model === harness.model ? harness.class : ((input.rows ?? []).find((row) => row.provider === harness.provider && row.model === session.model)?.class ?? null);
    const poolClass = session.poolClass ?? asked;
    return { ok: true, request: this.requestOf(input, harness.provider, session, poolClass) };
  }

  private requestOf(input: FreeSessionInput, provider: WorkerProviderId, session: ReturnType<LayeredConfigResolver['session']>, poolClass: CapabilityClass | null): RunRequest {
    const { persona, directory } = input;
    return {
      ticketId: FREE_SESSION_TICKET,
      ticketsVaultPath: input.ticketsVaultPath,
      ticketRelPath: '',
      phase: '',
      repoPath: directory,
      worktreePath: directory,
      branch: '',
      baseRef: null,
      provider,
      permissionMode: session.permissionMode,
      model: session.model,
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
      ...(poolClass !== null ? { poolClass } : {}),
      poolWhy: `free session of ${persona.id}: ${session.model ?? `${provider}'s default`}`,
      ledger: { allowance: null, personaBudget: persona.budget, spendAboveAllowance: false, noTicket: true },
      session: { kind: 'free', persona: persona.id, workingDirectory: directory },
      ...(input.projectId !== undefined && input.projectId !== null ? { projectId: input.projectId } : {}),
    };
  }
}
