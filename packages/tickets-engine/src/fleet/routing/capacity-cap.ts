import type { CapabilityClass, ClassLoad, PoolLoad, SlotLoad } from '../protocol';
import type { TableSlot } from './model-table';
import type { PoolSettingsView } from './pool-settings';
import type { SlotReservations } from './slot-reservations';

/** A slot as the cap reads it. */
export interface CapSlot extends TableSlot {
  readonly label: string;
}

const round = (value: number): number => Math.round(value * 100) / 100;

/**
 * The capacity cap (req-170, R10): the summed cost factors of the active
 * sessions may exceed neither the slot's cap nor the global one, and
 * (req-287) a class runs at most its N sessions at once. A slot's cost cap
 * is set in `service.json` or absent. Only active sessions count — the
 * reservations hold nothing for a queued task.
 */
export class CapacityCap {
  constructor(
    private readonly settings: PoolSettingsView,
    private readonly reservations: SlotReservations,
  ) {}

  capOf(slot: TableSlot): { readonly cap: number | null } {
    return { cap: this.settings.capacity().perSlot[slot.id] ?? null };
  }

  /** req-287: why one more session of this class does not fit now; null when it does (or the class has no cap). */
  classRefusal(name: CapabilityClass | null): string | null {
    const cap = name === null ? null : (this.settings.classes().find((c) => c.name === name)?.sessions ?? null);
    if (name === null || cap === null) {
      return null;
    }
    const busy = this.reservations.sessionsOfClass(name);
    return busy >= cap ? `${name} runs ${busy} of at most ${cap} sessions` : null;
  }

  /** req-287: the sessions per class against its cap. */
  classLoad(): readonly ClassLoad[] {
    return this.settings.classes().map((c) => ({ name: c.name, busy: this.reservations.sessionsOfClass(c.name), cap: c.sessions }));
  }

  /** Why one more session of this weight does not fit now; null when it does. */
  refusal(slot: CapSlot, cost: number): string | null {
    const { cap } = this.capOf(slot);
    const onSlot = this.reservations.costOn(slot.id);
    if (cap !== null && onSlot + cost > cap + 1e-9) {
      return `${slot.label} carries ${round(onSlot)} of ${round(cap)}, ${round(cost)} more does not fit`;
    }
    const global = this.settings.capacity().global;
    const total = this.reservations.totalCost();
    return global !== null && total + cost > global + 1e-9 ? `the global cap carries ${round(total)} of ${round(global)}, ${round(cost)} more does not fit` : null;
  }

  /** True when this weight can never fit, whatever frees: a configuration the owner must change. */
  neverFits(slot: TableSlot, cost: number): boolean {
    const { cap } = this.capOf(slot);
    const global = this.settings.capacity().global;
    return (cap !== null && cost > cap + 1e-9) || (global !== null && cost > global + 1e-9);
  }

  /** The live sum per slot and in all. */
  load(slots: readonly CapSlot[]): PoolLoad {
    const loads: SlotLoad[] = slots.map((slot) => ({ id: slot.id, label: slot.label, used: round(this.reservations.costOn(slot.id)), ...this.capOf(slot) }));
    return { used: round(this.reservations.totalCost()), global: this.settings.capacity().global, slots: loads, classes: this.classLoad() };
  }
}
