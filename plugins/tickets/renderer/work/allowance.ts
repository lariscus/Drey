// i18n: catalog
/**
 * A Running row's cost against the ticket's allowance (req-186, boards 7a
 * and 7e): grey while it is low, orange from 70 % of the allowance, red
 * when it is used up (`boards/notes.md`: "orange from 70 % of the
 * allowance, red when used up"). The allowance is the ticket's own
 * `allowance:` key, else the default of Settings → Models.
 */
import type { I18n } from '../../../../shared/i18n/types';

export type AllowanceLevel = 'near' | 'over';

export interface AllowanceState {
  readonly level: AllowanceLevel;
  /** Whole percent of the allowance spent. */
  readonly share: number;
}

/** From this share of the allowance the cost turns orange. */
export const NEAR_ALLOWANCE = 0.7;

export function allowanceStateOf(cost: number | null, allowance: number | null): AllowanceState | null {
  if (cost === null || allowance === null || !(allowance > 0)) {
    return null;
  }
  const ratio = cost / allowance;
  if (ratio < NEAR_ALLOWANCE) {
    return null;
  }
  return { level: ratio >= 1 ? 'over' : 'near', share: Math.floor(ratio * 100) };
}

/** `82 % of the $2.50 allowance for this ticket`. */
export function allowanceTitle(state: AllowanceState, allowance: number, i18n: I18n): string {
  return i18n.t('tickets.work.cost_of_allowance', { share: state.share, allowance: i18n.formatCurrency(allowance) });
}
