/**
 * The fleet's worker assignment (M84; the owner's ruling): for different
 * tasks, different workers — resolved ticket-first, then the pipeline
 * phase's handover pin, then the work repo's default, then the plugin's
 * configured default, then the fleet's first provider.
 *
 * Worker values name a provider and optionally pin a model:
 * `opencode`, `claude-code`, `kimi`, `claude-code/sonnet`. An unreadable value
 * is a refusal at run start — never a guess (ADR-0076).
 *
 * The module importers use for the run brief as well: the ship brief
 * (`instruction.ts`), the scout brief (`scout-instruction.ts`) and their
 * shared parts (`instruction-parts.ts`) are re-exported from here.
 */
import { isWorkerProvider, type WorkerProviderId } from './protocol';
import { parseHandover } from '../contracts/tickets';

export { composeInstruction, type InstructionInput } from './instruction';
export { composeScoutInstruction, type ScoutInstructionInput } from './scout-instruction';
export { personaLine, type ComposedInstruction, type Truncation } from './instruction-parts';

export type AssignmentSource = 'ticket' | 'column' | 'handover' | 'repo' | 'default';

export interface WorkerChoice {
  readonly provider: WorkerProviderId;
  readonly model: string | null;
  readonly source: AssignmentSource;
}

/** `<provider>` or `<provider>/<model>` — null when unreadable. */
export function parseWorkerValue(value: string): { provider: WorkerProviderId; model: string | null } | null {
  const text = value.trim();
  const slashAt = text.indexOf('/');
  const providerPart = slashAt === -1 ? text : text.slice(0, slashAt);
  const modelPart = slashAt === -1 ? null : text.slice(slashAt + 1);
  if (!isWorkerProvider(providerPart)) {
    return null;
  }
  return { provider: providerPart, model: modelPart !== null && modelPart !== '' ? modelPart : null };
}

export interface AssignmentInput {
  /** The ticket's `worker:` frontmatter pin (raw, may be null). */
  readonly ticketWorker: string | null;
  /** The working column's `worker:` key (M85) — between ticket and handover. */
  readonly columnWorker?: string | null;
  /** The working column's `model:` key (M85) — wins over a model inside a pin. */
  readonly columnModel?: string | null;
  /** The phase's raw handover spec (`agent build-default@opencode`). */
  readonly handover: string | null;
  /** The work repo's `worker:` default from `_meta/repos.md`. */
  readonly repoWorker: string | null;
  /** The plugin's configured default worker. */
  readonly configuredDefault: string | null;
}

export type Assignment =
  | ({ readonly ok: true; readonly promptRef: string | null } & WorkerChoice)
  | { readonly ok: false; readonly error: string };

/** The levels whose unreadable pin is a refusal; a stale repo/config default degrades to the next level. */
const EXPLICIT_SOURCES: ReadonlySet<AssignmentSource> = new Set<AssignmentSource>(['ticket', 'handover', 'column']);

/**
 * Resolves who runs the ticket. Handover modes other than `agent` do
 * not constrain the assignment — the owner can start an on-demand run
 * from any phase (ADR-0075: M84 runs are on-demand); the handover only
 * contributes its `@worker` pin and its prompt ref.
 */
export function resolveAssignment(input: AssignmentInput): Assignment {
  const candidates: ReadonlyArray<{ source: AssignmentSource; value: string | null }> = [
    { source: 'ticket', value: input.ticketWorker },
    { source: 'column', value: input.columnWorker ?? null },
    { source: 'handover', value: input.handover === null ? null : parseHandoverWorkerValue(input.handover) },
    { source: 'repo', value: input.repoWorker },
    { source: 'default', value: input.configuredDefault },
  ];
  const columnModel = columnModelOf(input);
  for (const candidate of candidates) {
    if (candidate.value === null || candidate.value.trim() === '') {
      continue;
    }
    const parsed = parseWorkerValue(candidate.value);
    if (parsed === null) {
      if (EXPLICIT_SOURCES.has(candidate.source)) {
        // An explicit-but-unreadable pin is a refusal, not a fallback.
        return { ok: false, error: `the ${candidate.source}'s worker "${candidate.value}" is unknown — use opencode, claude-code or kimi` };
      }
      continue; // a stale repo/config default degrades to the next level
    }
    return {
      ok: true,
      provider: parsed.provider,
      model: columnModel ?? parsed.model,
      source: candidate.source,
      promptRef: promptRefOf(input.handover),
    };
  }
  return { ok: true, provider: 'opencode', model: columnModel, source: 'default', promptRef: promptRefOf(input.handover) };
}

/** The column's `model:` key trimmed — null when absent or blank. */
function columnModelOf(input: AssignmentInput): string | null {
  const model = input.columnModel?.trim() ?? '';
  return model !== '' ? model : null;
}

function parseHandoverWorkerValue(handover: string): string | null {
  return parseHandover(handover).worker;
}

function promptRefOf(handover: string | null): string | null {
  return handover === null ? null : parseHandover(handover).promptRef;
}
