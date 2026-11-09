import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import type { ActionReply, RunAction, StreamEvent } from '../../../../../shared/service-window/contract';
import { ServiceStore } from './service-store';

export type SessionView = 'stream' | 'instruction' | 'tools' | 'process' | 'raw';

/** The Sessions tab's state: the selected run, its stream and instruction, the last action error. */
@Injectable({ providedIn: 'root' })
export class SessionsState {
  private readonly store = inject(ServiceStore);

  readonly selectedId = signal<string | null>(null);
  readonly showEnded = signal(false);
  readonly view = signal<SessionView>('stream');
  readonly follow = signal(true);
  readonly events = signal<readonly StreamEvent[]>([]);
  readonly instruction = signal<string | null>(null);
  readonly actionError = signal<string | null>(null);

  readonly run = computed(() => this.store.runs().find((candidate) => candidate.id === this.selectedId()) ?? null);

  private generation = 0;

  constructor() {
    const stop = this.store.addLineListener((runId, event) => {
      if (runId === this.selectedId()) {
        this.events.update((current) => [...current, event]);
      }
    });
    inject(DestroyRef).onDestroy(stop);
  }

  async select(runId: string): Promise<void> {
    const generation = ++this.generation;
    this.selectedId.set(runId);
    this.events.set([]);
    this.instruction.set(null);
    this.actionError.set(null);
    const [events, instruction] = await Promise.all([
      this.store.api.stream(runId).catch(() => []),
      this.store.api.instruction(runId).catch(() => null),
    ]);
    if (generation === this.generation) {
      // Lines that arrived while the load was in flight belong after the loaded ones.
      this.events.update((arrived) => [...events, ...arrived]);
      this.instruction.set(instruction);
    }
  }

  /** Runs one action and shows the reply's error raw; true when it went through. */
  async act(runId: string, action: RunAction, text?: string): Promise<boolean> {
    const reply = await this.report(this.store.api.run(runId, action, text));
    if (reply) {
      void this.store.refresh();
    }
    return reply;
  }

  async openWorktree(runId: string): Promise<void> {
    await this.report(this.store.api.openWorktree(runId));
  }

  async copyAttach(runId: string): Promise<void> {
    await this.report(this.store.api.copyAttachCommand(runId));
  }

  private async report(pending: Promise<ActionReply>): Promise<boolean> {
    try {
      const reply = await pending;
      this.actionError.set(reply.ok ? null : reply.error);
      return reply.ok;
    } catch (error) {
      this.actionError.set(error instanceof Error ? error.message : String(error));
      return false;
    }
  }
}
