import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { McI18nPipe } from '@mission-ui/i18n/i18n.pipe';
import { SessionsState } from '../api/sessions-state';
import { Icon } from '../ui/icon';

/** The raw steer ladder (ADR-0075): send a message, interrupt the turn, resume after a stop. */
@Component({
  selector: 'sw-composer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [McI18nPipe, Icon],
  templateUrl: './composer.html',
  styleUrl: './composer.css',
})
export class Composer {
  private readonly state = inject(SessionsState);

  readonly runId = input.required<string>();
  readonly text = signal('');
  readonly error = this.state.actionError;

  onInput(event: Event): void {
    this.text.set((event.target as HTMLInputElement).value);
  }

  async send(): Promise<void> {
    const text = this.text().trim();
    if (text === '') {
      return;
    }
    if (await this.state.act(this.runId(), 'send', text)) {
      this.text.set('');
    }
  }

  interrupt(): void {
    void this.state.act(this.runId(), 'interrupt');
  }

  resume(): void {
    void this.state.act(this.runId(), 'resume');
  }
}
