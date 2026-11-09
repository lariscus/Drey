import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import type {
  LogLine,
  ServiceSnapshot,
  ServiceWindowEvent,
  ServiceWindowTab,
  SessionRun,
  StreamEvent,
} from '../../../../../shared/service-window/contract';
import { appendLog } from '../present/log-rows';
import { SERVICE_WINDOW_API } from './service-window-api';

const REFRESH_MS = 3000;
const DEBOUNCE_MS = 150;

type LineListener = (runId: string, event: StreamEvent) => void;

/**
 * The window's one state: the snapshot, the runs and the log, refreshed every
 * 3 s and on any status/run event. The bridge may reject (service gone): the
 * snapshot then reads null and the UI shows the stopped line, nothing else changes.
 */
@Injectable({ providedIn: 'root' })
export class ServiceStore {
  readonly api = inject(SERVICE_WINDOW_API);
  private readonly destroyRef = inject(DestroyRef);

  readonly snapshot = signal<ServiceSnapshot | null>(null);
  readonly runs = signal<readonly SessionRun[]>([]);
  readonly logs = signal<readonly LogLine[]>([]);
  readonly tab = signal<ServiceWindowTab>('components');
  /** The clock the spans ("idle 4 min") read; moves with every refresh. */
  readonly now = signal(Date.now());

  private readonly lineListeners = new Set<LineListener>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private started = false;

  /** Idempotent: loads once, then subscribes and starts the 3 s refresh. */
  start(): Promise<void> {
    if (this.started) {
      return Promise.resolve();
    }
    this.started = true;
    const unsubscribeEvents = this.api.onEvent((event) => this.onEvent(event));
    const unsubscribeTab = this.api.onShowTab((tab) => this.tab.set(tab));
    this.timer = setInterval(() => void this.refresh(), REFRESH_MS);
    this.destroyRef.onDestroy(() => {
      unsubscribeEvents();
      unsubscribeTab();
      if (this.timer !== null) {
        clearInterval(this.timer);
      }
      if (this.debounce !== null) {
        clearTimeout(this.debounce);
      }
    });
    return Promise.all([this.refresh(), this.loadLog()]).then(() => undefined);
  }

  /** Both reads in parallel; a rejection of either reads as "service gone" for that part. */
  async refresh(): Promise<void> {
    const [snapshot, runs] = await Promise.all([
      this.api.snapshot().catch(() => null),
      this.api.runs().catch(() => null),
    ]);
    this.snapshot.set(snapshot);
    if (runs !== null) {
      this.runs.set(runs);
    }
    this.now.set(Date.now());
  }

  addLineListener(listener: LineListener): () => void {
    this.lineListeners.add(listener);
    return () => this.lineListeners.delete(listener);
  }

  private async loadLog(): Promise<void> {
    const tail = await this.api.logTail().catch(() => []);
    this.logs.update((current) => appendLog(tail, current));
  }

  private onEvent(event: ServiceWindowEvent): void {
    switch (event.kind) {
      case 'log':
        this.logs.update((current) => appendLog(current, [event.line]));
        return;
      case 'line':
        this.lineListeners.forEach((listener) => listener(event.runId, event.event));
        return;
      case 'run':
      case 'status':
        this.scheduleRefresh();
        return;
    }
  }

  private scheduleRefresh(): void {
    if (this.debounce !== null) {
      return;
    }
    this.debounce = setTimeout(() => {
      this.debounce = null;
      void this.refresh();
    }, DEBOUNCE_MS);
  }
}
