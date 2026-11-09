import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { SessionsState } from '../api/sessions-state';
import { SessionDetail } from './session-detail';
import { SessionList } from './session-list';

/** Board 8b: the live sessions on the left, the selected one's raw harness view on the right. */
@Component({
  selector: 'sw-sessions-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SessionList, SessionDetail],
  templateUrl: './sessions-tab.html',
  styleUrl: './sessions-tab.css',
})
export class SessionsTab {
  protected readonly state = inject(SessionsState);
}
