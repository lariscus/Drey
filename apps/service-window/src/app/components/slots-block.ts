import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { McI18n } from '@mission-ui/i18n/i18n.service';
import { McI18nPipe } from '@mission-ui/i18n/i18n.pipe';
import { ServiceStore } from '../api/service-store';
import { governorRows } from '../present/governor-rows';
import { slotRows } from '../present/slot-rows';

/** The Slots block (per account: seats, quota bar, reliability chip) and the Governor block of board 8a. */
@Component({
  selector: 'sw-slots-block',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [McI18nPipe],
  templateUrl: './slots-block.html',
  styleUrl: './slots-block.css',
})
export class SlotsBlock {
  private readonly store = inject(ServiceStore);
  private readonly i18n = inject(McI18n);

  readonly slots = computed(() => slotRows(this.i18n, this.store.snapshot()?.slots ?? null));
  readonly governor = computed(() => {
    const snapshot = this.store.snapshot();
    return snapshot === null || snapshot === undefined ? [] : governorRows(this.i18n, snapshot.load, snapshot.governor);
  });
}
