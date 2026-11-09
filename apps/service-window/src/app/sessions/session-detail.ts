import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { McI18n } from '@mission-ui/i18n/i18n.service';
import { McI18nPipe } from '@mission-ui/i18n/i18n.pipe';
import type { SessionRun } from '../../../../../shared/service-window/contract';
import { ServiceStore } from '../api/service-store';
import { SessionsState, type SessionView } from '../api/sessions-state';
import { idLine, sessionFacts } from '../present/session-facts';
import { isLive, sessionTitle } from '../present/session-list';
import { Switch } from '../ui/switch';
import { Composer } from './composer';
import { StreamViews } from './stream-views';

/** Board 8b's right pane: header, facts, the five views, composer, footer. */
@Component({
  selector: 'sw-session-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [McI18nPipe, Switch, Composer, StreamViews],
  templateUrl: './session-detail.html',
  styleUrl: './session-detail.css',
})
export class SessionDetail {
  private readonly store = inject(ServiceStore);
  private readonly i18n = inject(McI18n);
  protected readonly state = inject(SessionsState);

  readonly run = input.required<SessionRun>();

  readonly title = computed(() => sessionTitle(this.i18n, this.run()));
  readonly ids = computed(() => idLine(this.i18n, this.run()));
  readonly live = computed(() => isLive(this.run()));
  readonly dot = computed(() => (!this.live() ? 'off' : this.run().held ? 'warn' : 'running'));
  readonly facts = computed(() => sessionFacts(this.i18n, this.run(), this.store.snapshot(), this.state.events()));

  readonly views: readonly { readonly id: SessionView; readonly key: string }[] = [
    { id: 'stream', key: 'service_window.view.stream' },
    { id: 'instruction', key: 'service_window.view.instruction' },
    { id: 'tools', key: 'service_window.view.tools' },
    { id: 'process', key: 'service_window.view.process' },
    { id: 'raw', key: 'service_window.view.raw' },
  ];

  openWorktree(): void {
    void this.state.openWorktree(this.run().id);
  }

  copyAttach(): void {
    void this.state.copyAttach(this.run().id);
  }

  stop(): void {
    void this.state.act(this.run().id, 'stop');
  }

  openDrey(): void {
    void this.store.api.openDrey().catch(() => undefined);
  }
}
