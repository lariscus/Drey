import { Injectable, computed, inject, signal } from '@angular/core';
import {
  trancheCardOf,
  trancheChipsOf,
  trancheProgressOf,
  type TrancheCard,
  type TrancheCardActionId,
  type TrancheFormat,
} from '../../../../shared/tranche';
import { McI18n } from '../i18n/i18n.service';
import { MC_AUTOPILOT, MC_AUTOPILOT_ADJUST, type McAutopilotReply } from './autopilot-state';

/** `$0.41`, and `$15` for a whole amount — the same money the desktop card writes. */
export function moneyOf(usd: number): string {
  return Number.isInteger(usd) ? `$${usd}` : `$${usd.toFixed(2)}`;
}

/** The popover's On readout of a tranche (board 10t). */
export interface TrancheReadout {
  readonly runs: string;
  readonly left: string | null;
  /** 0–100, the limit nearest its end. */
  readonly percent: number;
}

/**
 * The tranche as every Mission Control surface reads it (req-179): the
 * popover's chips and bar, the sheet's header and Release button, and the
 * checkpoint card's model. Release is the existing Autopilot write
 * `{state: 'on'}` — the runner opens the next tranche, or continues after an
 * early stop. The components stay thin over this.
 */
@Injectable({ providedIn: 'root' })
export class McTranche {
  private readonly state = inject(MC_AUTOPILOT, { optional: true });
  private readonly adjustHost = inject(MC_AUTOPILOT_ADJUST);
  private readonly i18n = inject(McI18n);

  /** An early stop's "Open report" toggles the metric grid. */
  readonly reportOpen = signal(false);

  readonly view = computed(() => this.state?.tranche() ?? null);
  /** True while a checkpoint waits for the owner's release. */
  readonly waiting = computed(() => this.view()?.checkpoint === 'waiting');

  readonly format: TrancheFormat = {
    t: (key, params) => this.i18n.t(key, params),
    money: moneyOf,
    personaName: (id) => id.charAt(0).toUpperCase() + id.slice(1),
  };

  readonly card = computed((): TrancheCard | null => {
    const view = this.view();
    return view === null ? null : trancheCardOf(view, this.format, this.reportOpen());
  });

  /** `Mission Control · 14:02`, the card's meta line. */
  readonly meta = computed((): string | null => {
    const card = this.card();
    return card === null ? null : this.i18n.t('checkpoint.meta', { time: this.i18n.formatTime(new Date(card.at)) });
  });

  readout(now: Date): TrancheReadout | null {
    const view = this.view();
    if (view === null) {
      return null;
    }
    const chips = trancheChipsOf(view, now, this.format.t);
    return { ...chips, percent: Math.round(trancheProgressOf(view, now) * 100) };
  }

  /** Release / Release anyway: Autopilot On. */
  async release(): Promise<McAutopilotReply> {
    const reply = (await this.state?.set({ state: 'on' })) ?? { ok: false as const, error: '' };
    if (reply.ok) {
      this.reportOpen.set(false);
    }
    return reply;
  }

  /** Adjust…: Settings, where the Autopilot lives. */
  adjust(): void {
    this.adjustHost.open?.();
  }

  /** The card's buttons by id. */
  async act(id: TrancheCardActionId): Promise<void> {
    if (id === 'adjust') {
      this.adjust();
    } else if (id === 'open_report') {
      this.reportOpen.update((open) => !open);
    } else {
      await this.release();
    }
  }
}
