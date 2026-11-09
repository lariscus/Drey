import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import type { TrancheCardActionId } from '../../../../shared/tranche';
import { McTranche } from './tranche-model';

/**
 * The Lead's checkpoint card on the phone and the iPad chat (req-179, board
 * 10u part 7): a waiting checkpoint's report, or an early stop's red tickets.
 * It draws the one `TrancheCard` model the desktop card draws; the logic is
 * in `McTranche`.
 */
@Component({
  selector: 'mc-tranche-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './tranche-card.html',
  styleUrl: './tranche-card.css',
})
export class TrancheCardView {
  protected readonly model = inject(McTranche);

  protected act(id: TrancheCardActionId): void {
    void this.model.act(id);
  }
}
