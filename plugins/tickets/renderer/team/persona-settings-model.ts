// i18n: catalog
/**
 * The Work block's run settings as the Persona page edits them (req-258,
 * board 7k v2): the class floor, instructed read-only, the persona's pool
 * (max and min) and the leaving actions. DOM-free: the draft, the patch of
 * what differs, and the choices the block offers. The record's other run
 * settings (needs, ceilings, gate) have no field on the board and are edited
 * in the file.
 */
import type { PersonaSettingsPatch } from '../../../../packages/tickets-engine/src/contracts/persona-settings-patch';
import { DEFAULT_CLASS_NAMES } from '../../../../packages/tickets-engine/src/contracts/capability-class';
import type { ModelsReply } from '../../../../packages/tickets-engine/src/fleet/protocol';
import { PERSONA_LEAVING_ACTIONS, type PersonaClass, type PersonaLeavingAction } from '../../../../packages/tickets-engine/src/core/persona-settings';
import type { PersonaView } from '../../shared/remote-protocol';

export interface SettingsDraft {
  /** '' = not set: the step's floor applies. */
  readonly minClass: '' | PersonaClass;
  /** What the switch shows: the record's `readonly:`, else the role's default. */
  readonly readOnly: boolean;
  /** Whether the record holds `readonly:` — a Save writes it once the page showed it. */
  readonly readOnlyStored: boolean;
  /** As typed; '' = no cap. */
  readonly parallel: string;
  /** As typed; '' reads as 0. */
  readonly min: string;
  readonly leaving: readonly PersonaLeavingAction[];
}

/** The class floor's choices: not set, then the owner's class names (strongest first) from the model table, else the shipped list; a stored name the list lacks stays selectable. */
export function classFloorChoices(table: ModelsReply | null, current: '' | PersonaClass): readonly ('' | PersonaClass)[] {
  const names = table === null ? DEFAULT_CLASS_NAMES : table.classes.map((entry) => entry.name);
  return ['', ...names, ...(current !== '' && !names.includes(current) ? [current] : [])];
}

export function settingsDraftOf(view: PersonaView): SettingsDraft {
  const settings = view.settings;
  return {
    minClass: settings?.minClass ?? '',
    readOnly: view.readOnly === true,
    // An older engine sends no settings: nothing is written it did not show.
    readOnlyStored: settings === undefined || settings.readOnly !== null,
    parallel: settings?.parallel === null || settings?.parallel === undefined ? '' : String(settings.parallel),
    min: settings === undefined || settings.min === 0 ? '0' : String(settings.min),
    leaving: settings?.leaving ?? [],
  };
}

/** A typed count: null for '', the number when it is a whole number at least `least`, undefined otherwise (nothing is sent). */
export function countOf(text: string, least: number): number | null | undefined {
  const trimmed = text.trim();
  if (trimmed === '') {
    return null;
  }
  const n = Number(trimmed);
  return Number.isInteger(n) && n >= least ? n : undefined;
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * Only what differs from the record. `anySaved`: the Save writes other keys
 * too — then read-only goes as well while the record does not hold it yet, so
 * the file says what the switch showed (the role's default made explicit).
 */
export function settingsPatchOf(base: SettingsDraft, draft: SettingsDraft, anySaved = false): PersonaSettingsPatch | null {
  const patch: { -readonly [K in keyof PersonaSettingsPatch]: PersonaSettingsPatch[K] } = {};
  if (draft.minClass !== base.minClass) {
    patch.minClass = draft.minClass === '' ? null : draft.minClass;
  }
  if (draft.readOnly !== base.readOnly) {
    patch.readOnly = draft.readOnly;
  }
  const parallel = countOf(draft.parallel, 1);
  if (parallel !== undefined && parallel !== countOf(base.parallel, 1)) {
    patch.parallel = parallel;
  }
  const min = countOf(draft.min, 0);
  if (min !== undefined && (min ?? 0) !== (countOf(base.min, 0) ?? 0)) {
    patch.min = min ?? 0;
  }
  if (!sameList(draft.leaving, base.leaving)) {
    patch.leaving = draft.leaving;
  }
  if ((anySaved || Object.keys(patch).length > 0) && !base.readOnlyStored) {
    patch.readOnly = draft.readOnly;
  }
  return Object.keys(patch).length === 0 ? null : patch;
}

/** The leaving actions not yet on the persona, in the engine's order. */
export function addableActionsOf(leaving: readonly PersonaLeavingAction[]): readonly PersonaLeavingAction[] {
  return PERSONA_LEAVING_ACTIONS.filter((action) => !leaving.includes(action));
}

/** The base after a Save: the record now holds the key, the counts as the record writes them. */
export function savedSettingsOf(draft: SettingsDraft): SettingsDraft {
  const min = countOf(draft.min, 0) ?? 0;
  return { ...draft, readOnlyStored: true, parallel: draft.parallel.trim(), min: String(min) };
}
