import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import type { BurnRateCardActionId } from '../../../../shared/burn-rate';
import { McBurnRate } from './burn-rate-model';

/**
 * The Lead's burn-rate card on the phone and the iPad chat (req-181, board
 * 10u's phone chrome, laid out like part 9, the phone quota stop): the peach
 * dot and title, the body, the chips, `Wait` and `Allow today once` side by
 * side. It draws the one `BurnRateCard` model the desktop card draws; the
 * logic is in `McBurnRate`.
 */
@Component({
  selector: 'mc-burn-rate-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './burn-rate-card.html',
  styleUrl: './burn-rate-card.css',
})
export class BurnRateCardView {
  protected readonly model = inject(McBurnRate);

  protected act(id: BurnRateCardActionId): void {
    void this.model.act(id);
  }
}
