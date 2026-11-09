import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { McI18n } from '@mission-ui/i18n/i18n.service';
import { McI18nPipe } from '@mission-ui/i18n/i18n.pipe';
import type { NewSessionClass, NewSessionPermission } from '../../../../../shared/service-window/contract';
import { NewSessionState } from '../api/new-session-state';
import { PERMISSIONS } from '../../../../../shared/new-session-form';
import { folderChoices } from '../present/new-session-form';

const MODE_KEYS = {
  'read-only': 'service_window.new_session.mode.read_only',
  'accept-edits': 'service_window.new_session.mode.accept_edits',
  bypass: 'service_window.new_session.mode.bypass',
} as const satisfies Record<NewSessionPermission, string>;

/** The New session form (req-173): persona, folder, class, permission, an optional first line. */
@Component({
  selector: 'sw-new-session',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [McI18nPipe],
  templateUrl: './new-session.html',
  styleUrl: './new-session.css',
})
export class NewSession {
  private readonly i18n = inject(McI18n);
  protected readonly state = inject(NewSessionState);

  protected readonly folders = computed(() => {
    const options = this.state.options();
    return options === null ? [] : folderChoices(this.i18n, options);
  });
  protected readonly permissions = computed(() =>
    PERMISSIONS.map((value) => ({ value, label: this.i18n.t(MODE_KEYS[value]) })),
  );

  protected value(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value;
  }

  protected setClass(value: string): void {
    this.state.patch({ poolClass: value as NewSessionClass | '' });
  }

  protected setPermission(value: string): void {
    this.state.patch({ permission: value as NewSessionPermission });
  }
}
