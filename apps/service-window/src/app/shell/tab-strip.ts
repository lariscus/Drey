import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { McI18nPipe } from '@mission-ui/i18n/i18n.pipe';
import type { ServiceWindowTab } from '../../../../../shared/service-window/contract';
import { ServiceStore } from '../api/service-store';

/** The 32 px tab strip: Components, Sessions, Logs. */
@Component({
  selector: 'sw-tab-strip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [McI18nPipe],
  templateUrl: './tab-strip.html',
  styleUrl: './tab-strip.css',
})
export class TabStrip {
  protected readonly store = inject(ServiceStore);

  readonly tabs: readonly { readonly id: ServiceWindowTab; readonly key: string }[] = [
    { id: 'components', key: 'service_window.tab.components' },
    { id: 'sessions', key: 'service_window.tab.sessions' },
    { id: 'logs', key: 'service_window.tab.logs' },
  ];
}
