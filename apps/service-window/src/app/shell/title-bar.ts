import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { McI18nPipe } from '@mission-ui/i18n/i18n.pipe';
import { ServiceStore } from '../api/service-store';
import { Icon } from '../ui/icon';

/** The frameless window's 36 px title bar: the mark, the name, three controls; the bar drags the window. */
@Component({
  selector: 'sw-title-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [McI18nPipe, Icon],
  templateUrl: './title-bar.html',
  styleUrl: './title-bar.css',
})
export class TitleBar {
  private readonly store = inject(ServiceStore);

  control(action: 'minimize' | 'maximize' | 'close'): void {
    this.store.api.windowControl(action);
  }
}
