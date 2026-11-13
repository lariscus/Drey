/**
 * One slot added to or removed from `service.json`'s parsed root (D-69,
 * Settings → Models): every other entry stays as the owner wrote it — its
 * login folder and limits included, which the slot views do not carry.
 * Removing an implied slot names its provider in `impliedOff`; adding a
 * slot for such a provider takes it off that list again. A slot a model
 * row names stays: its rows would drop out of the table unseen.
 */
import { impliedOffOf, parseServiceSlots, slotOf } from './slot-config';

type Root = Readonly<Record<string, unknown>>;
export type SlotEdit = { readonly ok: true; readonly root: Record<string, unknown> } | { readonly ok: false; readonly error: string };

const entriesOf = (root: Root): readonly unknown[] => (Array.isArray(root['slots']) ? (root['slots'] as unknown[]) : []);
const idOf = (entry: unknown): unknown => (entry !== null && typeof entry === 'object' ? (entry as Record<string, unknown>)['id'] : undefined);

/** The root with `entry` appended to its slots; refused when the entry would not parse or its id is taken. */
export function slotAdded(root: Root, entry: unknown): SlotEdit {
  const taken = new Set(parseServiceSlots(root).slots.filter((slot) => !slot.implied).map((slot) => slot.id));
  const slot = slotOf(entry, taken);
  if (typeof slot === 'string') {
    return { ok: false, error: slot };
  }
  const off = impliedOffOf(root).filter((provider) => provider !== slot.provider);
  return { ok: true, root: { ...withOff(root, off), slots: [...entriesOf(root), entry] } };
}

/** The root without the slot `id`: a configured entry leaves the list, an implied slot's provider joins `impliedOff`. Refused while a model row names it. */
export function slotRemoved(root: Root, id: string): SlotEdit {
  const named = (Array.isArray(root['models']) ? (root['models'] as unknown[]) : []).filter((row) => row !== null && typeof row === 'object' && (row as Record<string, unknown>)['slot'] === id);
  if (named.length > 0) {
    const models = named.map((row) => String((row as Record<string, unknown>)['model'])).join(', ');
    return { ok: false, error: `slot "${id}" runs ${models} in the model table: move or remove those rows first` };
  }
  const entries = entriesOf(root);
  if (entries.some((entry) => idOf(entry) === id)) {
    return { ok: true, root: { ...root, slots: entries.filter((entry) => idOf(entry) !== id) } };
  }
  const implied = parseServiceSlots(root).slots.find((slot) => slot.implied && slot.id === id);
  if (implied === undefined) {
    return { ok: false, error: `unknown slot "${id}"` };
  }
  return { ok: true, root: withOff(root, [...impliedOffOf(root), implied.provider]) };
}

function withOff(root: Root, off: readonly string[]): Record<string, unknown> {
  const { impliedOff: _dropped, ...rest } = root;
  return off.length === 0 ? rest : { ...rest, impliedOff: off };
}
