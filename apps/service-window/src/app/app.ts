import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ServiceStore } from './api/service-store';
import { ComponentsTab } from './components/components-tab';
import { LogsTab } from './shell/logs-tab';
import { TabStrip } from './shell/tab-strip';
import { TitleBar } from './shell/title-bar';
import { SessionsTab } from './sessions/sessions-tab';

/** The Drey Service window (req-165/166): title bar, tab strip, one of three tabs. */
@Component({
  selector: 'sw-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TitleBar, TabStrip, ComponentsTab, SessionsTab, LogsTab],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly store = inject(ServiceStore);

  constructor() {
    void this.store.start();
  }
}
