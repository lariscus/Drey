import { splitPoolEntry, type Persona } from '../core/persona';
import { parseWorkerValue } from './assignment';
import type { EffectiveCrew, SessionOverrides } from './config/layered-config-resolver';
import { LayeredConfigResolver } from './config/layered-config-resolver';
import type { CapabilityClass, RunRequest, WorkerProviderId } from './protocol';
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
  /** The model table's class of a model on a provider; null when the table holds no row for it. */
  readonly classOf?: (provider: WorkerProviderId, model: string | null) => CapabilityClass | null;
  readonly git?: string;
}

export type FreeSessionRequestResult = { readonly ok: true; readonly request: RunRequest } | { readonly ok: false; readonly error: string };

/** The persona's harness and the model it would run on: its default when that is the harness's, else its pool's first entry of it. */
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
    const harness = harnessOf(persona);
    if (harness === null) {
      return { ok: false, error: `${persona.id} runs on "${persona.worker}", which the runner cannot start — a free session needs a harness` };
    }
    const session = this.resolver.session(input.crew, harness.model, input.overrides);
    const poolClass = session.poolClass ?? input.classOf?.(harness.provider, session.model) ?? null;
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
    };
  }
}
