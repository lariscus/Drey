/**
 * One slot added to, changed in or removed from `service.json`'s parsed
 * root (D-69, req-287, Settings → Models): every other entry stays as the
 * owner wrote it — its login folder and limits included, which the slot
 * views do not carry. Removing an implied slot names its provider in
 * `impliedOff`; adding a slot for such a provider takes it off that list
 * again. A slot a model row names stays — unless the owner confirmed the
 * removal of those rows with it (req-287: *Remove Claude B? 1 model uses
 * only this account.*). A change of an implied slot writes it out.
 */
import { impliedOffOf, impliedSlot, parseServiceSlots, slotOf } from './slot-config';

type Root = Readonly<Record<string, unknown>>;
export type SlotEdit = { readonly ok: true; readonly root: Record<string, unknown> } | { readonly ok: false; readonly error: string };

const entriesOf = (root: Root): readonly unknown[] => (Array.isArray(root['slots']) ? (root['slots'] as unknown[]) : []);
const idOf = (entry: unknown): unknown => (entry !== null && typeof entry === 'object' ? (entry as Record<string, unknown>)['id'] : undefined);

/** req-290: the retired `profile` key is read and silently ignored, and dropped again on every write. */
export function withoutRetiredSlotKeys(entry: unknown): unknown {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    return entry;
  }
  const { profile: _dropped, ...rest } = entry as Record<string, unknown>;
  return rest;
}

/** The root with `entry` appended to its slots; refused when the entry would not parse or its id is taken. */
export function slotAdded(root: Root, entry: unknown): SlotEdit {
  const taken = new Set(parseServiceSlots(root).slots.filter((slot) => !slot.implied).map((slot) => slot.id));
  const slot = slotOf(entry, taken);
  if (typeof slot === 'string') {
    return { ok: false, error: slot };
  }
  const off = impliedOffOf(root).filter((provider) => provider !== slot.provider);
  return { ok: true, root: { ...withOff(root, off), slots: [...entriesOf(root), withoutRetiredSlotKeys(entry)] } };
}

const rowsOf = (root: Root): readonly unknown[] => (Array.isArray(root['models']) ? (root['models'] as unknown[]) : []);
const namesSlot = (row: unknown, id: string): boolean => row !== null && typeof row === 'object' && (row as Record<string, unknown>)['slot'] === id;

/**
 * The root without the slot `id`: a configured entry leaves the list, an
 * implied slot's provider joins `impliedOff`. Refused while a model row
 * names it, unless `withModels` (req-287): then those rows leave with it.
 */
export function slotRemoved(root: Root, id: string, withModels = false): SlotEdit {
  const named = rowsOf(root).filter((row) => namesSlot(row, id));
  if (named.length > 0 && !withModels) {
    const models = named.map((row) => String((row as Record<string, unknown>)['model'])).join(', ');
    return { ok: false, error: `slot "${id}" runs ${models} in the model table: move or remove those rows first` };
  }
  const base = named.length > 0 ? { ...root, models: rowsOf(root).filter((row) => !namesSlot(row, id)) } : root;
  const entries = entriesOf(base);
  if (entries.some((entry) => idOf(entry) === id)) {
    return { ok: true, root: { ...base, slots: entries.filter((entry) => idOf(entry) !== id) } };
  }
  const implied = parseServiceSlots(base).slots.find((slot) => slot.implied && slot.id === id);
  if (implied === undefined) {
    return { ok: false, error: `unknown slot "${id}"` };
  }
  return { ok: true, root: withOff(base, [...impliedOffOf(base), implied.provider]) };
}

/** The keys of a slot the page edits in place (req-287): its label, its cost, its sessions. */
const EDITABLE = ['label', 'billing', 'sessions'] as const;

/**
 * The root with the slot `id` changed (req-287, the account row edited in
 * place): only `label`, `billing` and `sessions` — a `null` removes the key.
 * An implied slot is written out as an entry with the change. Refused when
 * the changed entry would not parse.
 */
export function slotUpdated(root: Root, id: string, patch: Readonly<Record<string, unknown>>): SlotEdit {
  const entries = entriesOf(root);
  const at = entries.findIndex((entry) => idOf(entry) === id);
  const implied = at < 0 ? parseServiceSlots(root).slots.find((slot) => slot.implied && slot.id === id) : undefined;
  if (at < 0 && implied === undefined) {
    return { ok: false, error: `unknown slot "${id}"` };
  }
  const current = at >= 0 ? (entries[at] as Record<string, unknown>) : impliedEntryOf(implied!.provider, id);
  const next: Record<string, unknown> = { ...current };
  for (const key of EDITABLE) {
    if (patch[key] === null) {
      delete next[key];
    } else if (patch[key] !== undefined) {
      next[key] = patch[key];
    }
  }
  const parsed = slotOf(next, new Set());
  if (typeof parsed === 'string') {
    return { ok: false, error: parsed };
  }
  const slots = at >= 0 ? entries.map((entry, i) => (i === at ? withoutRetiredSlotKeys(next) : entry)) : [...entries, next];
  return { ok: true, root: { ...root, slots } };
}

function impliedEntryOf(provider: Parameters<typeof impliedSlot>[0], id: string): Record<string, unknown> {
  const slot = impliedSlot(provider);
  return { id, label: slot.label, provider, quota: slot.quota };
}

function withOff(root: Root, off: readonly string[]): Record<string, unknown> {
  const { impliedOff: _dropped, ...rest } = root;
  return off.length === 0 ? rest : { ...rest, impliedOff: off };
}
