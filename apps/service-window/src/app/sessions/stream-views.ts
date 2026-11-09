import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { McI18n } from '@mission-ui/i18n/i18n.service';
import type { SessionRun } from '../../../../../shared/service-window/contract';
import { SessionsState } from '../api/sessions-state';
import { processRows } from '../present/session-facts';
import { rawRows, streamRows, toolRows } from '../present/stream-rows';
import { FollowScroll } from '../ui/follow-scroll';

/** The selected view's body: Stream, Instruction, Tool calls, Process or Raw JSON (board 8b). */
@Component({
  selector: 'sw-stream-views',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FollowScroll],
  templateUrl: './stream-views.html',
  styleUrl: './stream-views.css',
})
export class StreamViews {
  private readonly i18n = inject(McI18n);
  protected readonly state = inject(SessionsState);

  readonly run = input.required<SessionRun>();

  readonly stream = computed(() => streamRows(this.i18n, this.state.events(), this.run()));
  readonly tools = computed(() => toolRows(this.i18n, this.state.events(), this.run()));
  readonly raw = computed(() => rawRows(this.state.events()));
  readonly process = computed(() => processRows(this.i18n, this.run()));

  /** Only the views that grow follow; Instruction and Process stay where the reader put them. */
  readonly following = computed(() => {
    const view = this.state.view();
    return this.state.follow() && (view === 'stream' || view === 'tools' || view === 'raw');
  });
  readonly tick = computed(() => [this.state.events(), this.state.view()]);
}
