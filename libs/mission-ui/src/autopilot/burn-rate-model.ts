import { Injectable, computed, inject, signal } from '@angular/core';
import { autopilotRefusalWordsOf } from '../../../../shared/autopilot';
import { burnRateCardOf, burnRateLineOf, type BurnRateCard, type BurnRateCardActionId, type BurnRateFormat } from '../../../../shared/burn-rate';
import { McI18n } from '../i18n/i18n.service';
import { MC_AUTOPILOT, type McAutopilotReply } from './autopilot-state';

/**
 * The burn rate's hold as every Mission Control surface reads it (req-181):
 * the popover's and sheet's line, and the Needs-you card's model. `Wait`
 * dismisses the day's card on this device; `Allow today once` lifts the hold
 * on the desk (`POST /api/chain/hold/lift`). The components stay thin over this.
 */
@Injectable({ providedIn: 'root' })
export class McBurnRate {
  private readonly state = inject(MC_AUTOPILOT, { optional: true });
  private readonly i18n = inject(McI18n);
  private readonly dismissed = signal<string | null>(null);

  /** A refused lift, in words from the catalog (or the desk's); null while none. */
  readonly error = signal<string | null>(null);

  readonly view = computed(() => this.state?.hold?.() ?? null);

  readonly format: BurnRateFormat = {
    t: (key, params) => this.i18n.t(key, params),
    time: (date) => this.i18n.formatTime(date),
  };

  /** `Burn rate reached · resumes at 00:00`; null while nothing holds. */
  readonly line = computed((): string | null => {
    const view = this.view();
    return view === null ? null : burnRateLineOf(view, this.format);
  });

  readonly card = computed((): BurnRateCard | null => {
    const view = this.view();
    const card = view === null ? null : burnRateCardOf(view, this.format);
    return card === null || card.id === this.dismissed() ? null : card;
  });

  /** `Mission Control · 22:40`, the card's meta line; null when the desk did not say when the hold rose. */
  readonly meta = computed((): string | null => {
    const at = this.card()?.at ?? null;
    return at === null ? null : this.i18n.t('card.meta', { time: this.i18n.formatTime(new Date(at)) });
  });

  /** True on a read-only device: the lift is refused there, Wait still dismisses. */
  readonly readOnly = computed(() => this.state?.readOnly() ?? true);

  async act(id: BurnRateCardActionId): Promise<void> {
    this.error.set(null);
    if (id === 'wait') {
      this.dismissed.set(this.card()?.id ?? null);
      return;
    }
    const reply: McAutopilotReply = (await this.state?.liftHold?.()) ?? { ok: false, error: '' };
    if (!reply.ok) {
      const words = autopilotRefusalWordsOf(reply);
      this.error.set(this.i18n.t(words.key, words.params));
    }
  }
}
