import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { McI18n } from '@mission-ui/i18n/i18n.service';
import { McI18nPipe } from '@mission-ui/i18n/i18n.pipe';
import { ServiceStore } from '../api/service-store';
import { logRows, type ComponentFilter, type LevelFilter } from '../present/log-rows';
import { FollowScroll } from '../ui/follow-scroll';
import { Segmented, type SegmentOption } from '../ui/segmented';
import { Switch } from '../ui/switch';

/** The service log (board 8a): level control, Follow, one line per entry; the Logs tab adds the component filter. */
@Component({
  selector: 'sw-log-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [McI18nPipe, Segmented, Switch, FollowScroll],
  templateUrl: './log-panel.html',
  styleUrl: './log-panel.css',
})
export class LogPanel {
  private readonly store = inject(ServiceStore);
  private readonly i18n = inject(McI18n);

  readonly withComponents = input(false);
  readonly level = signal<LevelFilter>('all');
  readonly component = signal<ComponentFilter>('all');
  readonly follow = signal(true);

  readonly rows = computed(() => logRows(this.store.logs(), this.level(), this.component()));

  readonly levelOptions: readonly SegmentOption<LevelFilter>[] = [
    { value: 'all', label: this.i18n.t('service_window.log.all') },
    { value: 'warn', label: this.i18n.t('service_window.log.warnings') },
    { value: 'error', label: this.i18n.t('service_window.log.errors') },
  ];
  readonly componentOptions: readonly SegmentOption<ComponentFilter>[] = [
    { value: 'all', label: this.i18n.t('service_window.log.component_all') },
    { value: 'service', label: this.i18n.t('service_window.log.component_service') },
    { value: 'engine', label: this.i18n.t('service_window.log.component_engine') },
    { value: 'runner', label: this.i18n.t('service_window.log.component_runner') },
    { value: 'gateway', label: this.i18n.t('service_window.log.component_gateway') },
  ];
}
