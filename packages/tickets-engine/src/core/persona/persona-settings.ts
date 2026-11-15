import type { ClassName } from '../../contracts/capability-class';
import type { ModelNeeds } from '../../contracts/ticket-pool-meta';
import { needsText, parseNeeds } from '../config/model-needs';

/**
 * The run settings of a persona record (req-258, the persona board concept
 * §5 and §9): what sat on the board's columns moves to `persona.md` —
 * the model needs (the class floor folded into `class:` with req-288), the run ceilings, the hand-over gate —
 * plus the persona's own pool (`parallel:`, `min:`), its leaving actions and
 * whether its runs are instructed read-only. Every key is optional; an
 * absent one keeps today's behaviour (the column's value, or the role's
 * default where noted). See `specs/ticket-schema.md` for the format.
 */

/** `gate:` — what decides the persona's hand-over: the ticket's acceptance commands, or only the structural check. */
export type PersonaGate = 'commands' | 'structural';

export const PERSONA_GATES: readonly PersonaGate[] = ['commands', 'structural'];

/** `leaving:` — machine work done when a ticket leaves the persona: `sync-main` at a run's green end, `commit` after the owner's sign-off (req-267). */
export type PersonaLeavingAction = 'sync-main' | 'commit';

export const PERSONA_LEAVING_ACTIONS: readonly PersonaLeavingAction[] = ['sync-main', 'commit'];

/** A capability class of the model table (req-170; a name of the owner's list since req-287). */
export type PersonaClass = ClassName;

export interface PersonaSettings {
  /** `needs:` — what its runs need of the model (the req-178 grammar); null = the column's. */
  readonly needs: ModelNeeds | null;
  /** `max-turns:` — the run ceiling in turns; null = the column's. */
  readonly maxTurns: number | null;
  /** `max-work:` — the run ceiling in minutes of work; null = the column's. */
  readonly maxWorkMin: number | null;
  /** `gate:`; null = the role's default ({@link personaGate}). */
  readonly gate: PersonaGate | null;
  /** `parallel:` — the persona's maximum of parallel runs; null = no cap (req-257 enforces it). */
  readonly parallel: number | null;
  /** `min:` — runs it may start even when the big pool is full; default 0 (req-257 enforces it). */
  readonly min: number;
  /** `leaving:` — in order. */
  readonly leaving: readonly PersonaLeavingAction[];
  /**
   * `readonly:` — the run's brief carries the read-only rules instead of the
   * writing rules (instructed, not enforced: the harness session keeps its
   * permissions); null = the role's default ({@link personaReadOnly}).
   */
  readonly readOnly: boolean | null;
}

export const EMPTY_PERSONA_SETTINGS: PersonaSettings = {
  needs: null,
  maxTurns: null,
  maxWorkMin: null,
  gate: null,
  parallel: null,
  min: 0,
  leaving: [],
  readOnly: null,
};

/** The roles whose runs read only when the record says nothing (the tester since req-280, the reviewer since req-183). */
const READ_ONLY_ROLES: readonly string[] = ['reviewer', 'tester'];

/** The record's `readonly:`, else the role's default. */
export function personaReadOnly(persona: { readonly role: string; readonly settings: PersonaSettings }): boolean {
  return persona.settings.readOnly ?? READ_ONLY_ROLES.includes(persona.role);
}

/** The record's `gate:`, else the role's default: a planner writes the criteria, so its gate is structural. */
export function personaGate(persona: { readonly role: string; readonly settings: PersonaSettings }): PersonaGate {
  return persona.settings.gate ?? (persona.role === 'planner' ? 'structural' : 'commands');
}

function positiveInt(raw: unknown): number | null {
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw.trim()) : raw;
  return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : null;
}

function oneOf<T extends string>(raw: unknown, values: readonly T[]): T | null {
  const text = typeof raw === 'string' ? raw.trim() : '';
  return (values as readonly string[]).includes(text) ? (text as T) : null;
}

function leavingOf(raw: unknown): readonly PersonaLeavingAction[] {
  const items = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [];
  const known = items.map((item) => oneOf(item, PERSONA_LEAVING_ACTIONS)).filter((item): item is PersonaLeavingAction => item !== null);
  return [...new Set(known)];
}

function minOf(raw: unknown): number {
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw.trim()) : raw;
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : 0;
}

/** Tolerant like the rest of the record: a value of the wrong shape reads as absent. */
export function personaSettingsOf(get: (key: string) => unknown): PersonaSettings {
  const readOnly = get('readonly');
  return {
    needs: parseNeeds(get('needs')).needs,
    maxTurns: positiveInt(get('max-turns')),
    maxWorkMin: positiveInt(get('max-work')),
    gate: oneOf(get('gate'), PERSONA_GATES),
    parallel: positiveInt(get('parallel')),
    min: minOf(get('min')),
    leaving: leavingOf(get('leaving')),
    readOnly: typeof readOnly === 'boolean' ? readOnly : null,
  };
}

/** The settings' lines, written only for what is set — a record without them stays byte-identical. */
export function personaSettingsLines(settings: PersonaSettings): string[] {
  const needs = needsText(settings.needs);
  return [
    ...(needs !== '' ? [`needs: [${needs}]`] : []),
    ...(settings.maxTurns !== null ? [`max-turns: ${settings.maxTurns}`] : []),
    ...(settings.maxWorkMin !== null ? [`max-work: ${settings.maxWorkMin}`] : []),
    ...(settings.gate !== null ? [`gate: ${settings.gate}`] : []),
    ...(settings.parallel !== null ? [`parallel: ${settings.parallel}`] : []),
    ...(settings.min > 0 ? [`min: ${settings.min}`] : []),
    ...(settings.leaving.length > 0 ? [`leaving: [${settings.leaving.join(', ')}]`] : []),
    ...(settings.readOnly !== null ? [`readonly: ${settings.readOnly}`] : []),
  ];
}

/** What a run of the persona takes from its record (the role's defaults resolved). */
export interface PersonaRunSettings {
  readonly readOnly: boolean;
  readonly gate: PersonaGate;
  readonly maxTurns: number | null;
  readonly maxWorkMin: number | null;
  /** `leaving:` — the machine actions done when a ticket leaves the persona (req-267). */
  readonly leaving: readonly PersonaLeavingAction[];
}

export function personaRunSettingsOf(persona: { readonly role: string; readonly settings: PersonaSettings }): PersonaRunSettings {
  const { maxTurns, maxWorkMin, leaving } = persona.settings;
  return { readOnly: personaReadOnly(persona), gate: personaGate(persona), maxTurns, maxWorkMin, leaving };
}
