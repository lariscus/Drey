import type { PipelinePhase, TicketIssue } from '../contracts/tickets';
import { parseNeeds } from './model-needs';
import { phaseMinClassOf } from './phase-min-class';

/**
 * One phase entry of pipeline.md as the board reads it (split out of
 * `ticket-board.ts` for req-178): the column's pool keys, its run limits,
 * its colour, its class floor and its model needs. Tolerant: a present but
 * invalid optional key degrades visibly (an issue), never a board error.
 */

/** `color:` in pipeline.md — a `#rrggbb` hex value (T-0084). */
const COLOR_HEX = /^#[0-9a-f]{6}$/i;

type PhaseMap = Readonly<Record<string, unknown>>;

const trimmed = (raw: unknown): string | null => (typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null);
const positiveInt = (raw: unknown): number | null => (typeof raw === 'number' && Number.isInteger(raw) && raw > 0 ? raw : null);

/** The column's WIP and its run limits (M85, T-0048). */
function limitsOf(map: PhaseMap): Pick<PipelinePhase, 'wip' | 'maxRed' | 'tokenBudget' | 'maxTurns' | 'maxWorkMin' | 'audit'> {
  const tokenBudgetRaw = map['token-budget'];
  const auditRaw = map['audit'];
  return {
    wip: positiveInt(map['wip']),
    maxRed: positiveInt(map['max-red']),
    tokenBudget: typeof tokenBudgetRaw === 'number' && Number.isFinite(tokenBudgetRaw) && tokenBudgetRaw > 0 ? tokenBudgetRaw : null,
    maxTurns: positiveInt(map['max-turns']),
    maxWorkMin: positiveInt(map['max-work']),
    audit: typeof auditRaw === 'number' && Number.isFinite(auditRaw) && auditRaw > 0 && auditRaw <= 1 ? auditRaw : null,
  };
}

/** A present-but-invalid colour degrades to the palette, visibly — never a board error (asymmetric tolerance, like `push:`). */
function colorOf(map: PhaseMap, id: string, issues: TicketIssue[]): string | null {
  const color = trimmed(map['color']);
  if (color === null) {
    return null;
  }
  if (COLOR_HEX.test(color)) {
    return color;
  }
  issues.push({ level: 'noise', message: `pipeline.md: ${id}'s color must be #rrggbb — ignored` });
  return null;
}

/** req-178: what every run of the phase needs of its model; an unknown token is ignored visibly. */
function needsOf(map: PhaseMap, id: string, issues: TicketIssue[]): Pick<PipelinePhase, 'needs'> {
  const parsed = parseNeeds(map['needs']);
  if (parsed.unknown.length > 0) {
    issues.push({ level: 'noise', message: `pipeline.md: ${id}'s needs ${parsed.unknown.join(', ')} is not image, tools, context-<n> or output-<n> — ignored` });
  }
  return parsed.needs !== null ? { needs: parsed.needs } : {};
}

/** One phase entry (its id already checked). */
export function pipelinePhaseOf(map: PhaseMap, id: string, issues: TicketIssue[]): PipelinePhase {
  if (map['workers'] !== undefined) {
    // req-63: the pools belong to the providers now — the old column key is forgiven visibly.
    issues.push({ level: 'noise', message: `pipeline.md: ${id}'s workers: is no longer read — set the pool size in Settings → Tickets → Workers` });
  }
  const minClass = phaseMinClassOf(map['min-class'], id, issues);
  const color = colorOf(map, id, issues);
  const title = map['title'];
  const handover = map['handover'];
  return {
    id,
    title: typeof title === 'string' && title.trim() !== '' ? title : id,
    claim: map['claim'] === true,
    handover: typeof handover === 'string' && handover.trim() !== '' ? handover : 'manual',
    worker: trimmed(map['worker']),
    model: trimmed(map['model']),
    prompt: trimmed(map['prompt']),
    interactive: trimmed(map['interactive']),
    persona: trimmed(map['persona']),
    ...limitsOf(map),
    ci: trimmed(map['ci']),
    semantic: map['semantic'] === true,
    color,
    ...(minClass !== null ? { minClass } : {}),
    ...needsOf(map, id, issues),
  };
}
