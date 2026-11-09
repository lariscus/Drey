import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { McI18n } from '@mission-ui/i18n/i18n.service';
import { McI18nPipe } from '@mission-ui/i18n/i18n.pipe';
import { ServiceStore } from '../api/service-store';
import { LogPanel } from '../log/log-panel';
import { statusLine } from '../present/status-line';
import { ComponentList } from './component-list';
import { SlotsBlock } from './slots-block';

/** Board 8a: status line, components with slots and governor on the left, the log on the right, the footer. */
@Component({
  selector: 'sw-components-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [McI18nPipe, ComponentList, SlotsBlock, LogPanel],
  templateUrl: './components-tab.html',
  styleUrl: './components-tab.css',
})
export class ComponentsTab {
  private readonly store = inject(ServiceStore);
  private readonly i18n = inject(McI18n);

  readonly status = computed(() => statusLine(this.i18n, this.store.snapshot()));

  openDrey(): void {
    void this.store.api.openDrey().catch(() => undefined);
  }

  quit(): void {
    void this.store.api.quitService().catch(() => undefined);
  }
}
