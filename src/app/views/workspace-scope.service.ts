import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import type { Unsubscribe, WorkspaceScopeContrib, WorkspaceScopeHandle, WorkspaceScopeOption } from '../../../shared/plugin-api/renderer';
import { LogService } from '../services/log.service';
import { ViewService } from './view.service';

const KEY = 'drey.views.scope';

/**
 * The title bar's scope filter (SDK 1.59, req-285, board 7n): one plugin
 * offers the choices (a project, say), the base draws the control right of
 * the view switcher and keeps **which choice each view shows** (ADR-0089
 * later change: a view opens filtered). The base attaches no meaning beyond
 * the Files panel's sources; plugins read the active choice through
 * `ui.workspaceScope()`.
 *
 * The choice per view lives in `localStorage['drey.views.scope']` (small
 * per-machine window state, like the views list) and is written as it is
 * picked: it is part of the view, not of its saved layout (D-6) — a filter
 * is a lens, not an arrangement. A choice whose option went away (a deleted
 * project) reads as "all" and is kept, in case it comes back.
 */
@Injectable({ providedIn: 'root' })
export class WorkspaceScopeService {
  private readonly views = inject(ViewService);
  private readonly log = inject(LogService);

  private readonly registration = signal<{ readonly owner: string; readonly contrib: WorkspaceScopeContrib } | null>(null);
  private readonly options = signal<readonly WorkspaceScopeOption[]>([]);
  private readonly chosen = signal<Readonly<Record<string, string>>>(this.read());

  /** The registered filter, or null (no control in the title bar). */
  readonly contrib = computed(() => this.registration()?.contrib ?? null);
  readonly choices = this.options.asReadonly();
  /** The active view's choice; null = all. */
  readonly active = computed<WorkspaceScopeOption | null>(() => {
    if (this.registration() === null) {
      return null;
    }
    const id = this.chosen()[this.views.activeId()];
    return id === undefined ? null : (this.options().find((o) => o.id === id) ?? null);
  });

  private readonly listeners = new Set<() => void>();

  constructor() {
    let last: WorkspaceScopeOption | null | undefined;
    effect(() => {
      const now = this.active();
      untracked(() => {
        if (last !== undefined && sameChoice(last, now)) {
          return;
        }
        last = now;
        for (const listener of [...this.listeners]) {
          listener();
        }
      });
    });
    // "Save current layout as a view…" copies the active view's lens; a deleted view's entry goes.
    this.views.onViewCopied((from, to) => this.copy(from, to));
    this.views.onViewRemoved((id) => this.drop(id));
  }

  /** `ui.registerWorkspaceScope`: the first registration wins, a second is refused (logged). */
  register(owner: string, contrib: WorkspaceScopeContrib): WorkspaceScopeHandle {
    if (this.registration() !== null) {
      this.log.record('warn', `workspace scope of plugin "${owner}" refused: the title bar already has one`);
      return { setOptions: () => undefined, dispose: () => undefined };
    }
    const entry = { owner, contrib };
    this.registration.set(entry);
    return {
      setOptions: (options) => {
        if (this.registration() === entry) {
          this.options.set([...options]);
        }
      },
      dispose: () => {
        if (this.registration() === entry) {
          this.registration.set(null);
          this.options.set([]);
        }
      },
    };
  }

  /** The control's pick for the active view; null = all. */
  pick(id: string | null): void {
    const view = this.views.activeId();
    this.chosen.update((all) => {
      const { [view]: _was, ...rest } = all;
      return id === null ? rest : { ...rest, [view]: id };
    });
    this.persist();
  }

  /** The id the active view chose, even when no option carries it now. */
  chosenId(): string | null {
    return this.chosen()[this.views.activeId()] ?? null;
  }

  manage(): void {
    this.registration()?.contrib.manage?.();
  }

  onChange(listener: () => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private copy(from: string, to: string): void {
    const id = this.chosen()[from];
    if (id !== undefined) {
      this.chosen.update((all) => ({ ...all, [to]: id }));
      this.persist();
    }
  }

  private drop(view: string): void {
    if (this.chosen()[view] !== undefined) {
      this.chosen.update(({ [view]: _gone, ...rest }) => rest);
      this.persist();
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify({ views: this.chosen() }));
    } catch {
      // Storage disabled: the choices last for this session.
    }
  }

  private read(): Readonly<Record<string, string>> {
    try {
      const raw = localStorage.getItem(KEY);
      const views = raw ? (JSON.parse(raw) as { views?: unknown }).views : null;
      if (typeof views === 'object' && views !== null) {
        return Object.fromEntries(Object.entries(views as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string'));
      }
    } catch {
      // A damaged store: every view shows all.
    }
    return {};
  }
}

function sameChoice(a: WorkspaceScopeOption | null, b: WorkspaceScopeOption | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
