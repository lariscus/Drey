import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { McI18n } from '@mission-ui/i18n/i18n.service';
import type { ComponentAction, ComponentId } from '../../../../../shared/service-window/contract';
import { ServiceStore } from '../api/service-store';
import { componentRows } from '../present/component-rows';
import { Icon } from '../ui/icon';

/** The five component rows of board 8a; the hovered row shows its restart / stop / start buttons. */
@Component({
  selector: 'sw-component-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  templateUrl: './component-list.html',
  styleUrl: './component-list.css',
})
export class ComponentList {
  private readonly store = inject(ServiceStore);
  private readonly i18n = inject(McI18n);

  readonly rows = computed(() =>
    componentRows(this.i18n, this.store.snapshot(), this.store.runs(), this.store.now()),
  );

  act(id: ComponentId, action: ComponentAction): void {
    void this.store.api
      .component(id, action)
      .catch(() => undefined)
      .then(() => this.store.refresh());
  }
}
