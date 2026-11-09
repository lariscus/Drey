import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { McI18n } from '@mission-ui/i18n/i18n.service';
import { McI18nPipe } from '@mission-ui/i18n/i18n.pipe';
import { ServiceStore } from '../api/service-store';
import { NewSessionState } from '../api/new-session-state';
import { SessionsState } from '../api/sessions-state';
import { sessionList } from '../present/session-list';
import { Icon } from '../ui/icon';
import { NewSession } from './new-session';

/** Board 8b's left list: summary, one row per live session, the ended-today group. */
@Component({
  selector: 'sw-session-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [McI18nPipe, Icon, NewSession],
  templateUrl: './session-list.html',
  styleUrl: './session-list.css',
})
export class SessionList {
  private readonly store = inject(ServiceStore);
  private readonly i18n = inject(McI18n);
  protected readonly state = inject(SessionsState);
  protected readonly newSession = inject(NewSessionState);

  readonly list = computed(() => sessionList(this.i18n, this.store.runs(), this.store.now()));

  /** Stop and release are the same action for now: both end the run's hold. */
  stop(runId: string): void {
    void this.state.act(runId, 'stop');
  }

  toggleEnded(): void {
    this.state.showEnded.update((shown) => !shown);
  }
}
