import { Injectable, computed, inject, signal } from '@angular/core';
import { askOf, draftOf, type NewSessionDraft, type NewSessionOptions } from '../../../../../shared/new-session-form';
import { ServiceStore } from './service-store';
import { SessionsState } from './sessions-state';

/** The New session form's state (req-173): closed, loading its options, or open with a draft and the engine's last error. */
@Injectable({ providedIn: 'root' })
export class NewSessionState {
  private readonly store = inject(ServiceStore);
  private readonly sessions = inject(SessionsState);

  readonly open = signal(false);
  readonly options = signal<NewSessionOptions | null>(null);
  readonly draft = signal<NewSessionDraft | null>(null);
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);

  readonly canStart = computed(() => {
    const draft = this.draft();
    return !this.busy() && draft !== null && askOf(draft) !== null;
  });

  async show(): Promise<void> {
    this.error.set(null);
    this.open.set(true);
    try {
      const reply = await this.store.api.sessionOptions();
      if (reply.ok) {
        this.options.set(reply);
        this.draft.set(draftOf(reply));
      } else {
        this.error.set(reply.error);
      }
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : String(error));
    }
  }

  cancel(): void {
    this.open.set(false);
    this.error.set(null);
  }

  patch(change: Partial<NewSessionDraft>): void {
    this.draft.update((draft) => (draft === null ? draft : { ...draft, ...change }));
  }

  async browse(): Promise<void> {
    const folder = await this.store.api.pickFolder().catch(() => null);
    if (folder !== null) {
      this.patch({ typedFolder: folder });
    }
  }

  /** Starts the session; on success the form closes and the new session is selected. */
  async start(): Promise<void> {
    const draft = this.draft();
    const ask = draft === null ? null : askOf(draft);
    if (ask === null) {
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      const reply = await this.store.api.sessionStart(ask);
      if (reply.ok) {
        this.open.set(false);
        await this.store.refresh();
        await this.sessions.select(reply.runId);
      } else {
        this.error.set(reply.error);
      }
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.busy.set(false);
    }
  }
}
