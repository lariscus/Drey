import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import type { PlainFolderEntry, VaultStatus } from '../../../../shared/ipc-api';
import type { WorkspaceScopeOption } from '../../../../shared/plugin-api/renderer';
import { scopeVaultIds } from '../../../../shared/workspace-scope';
import { I18nService } from '../../i18n';
import { EditorService } from '../../services/editor.service';
import { VaultService } from '../../vault';
import { WorkspaceScopeService } from '../../views';
import { absolutePath } from './files-tree';

/** One plain folder a scope names: its absolute root and the name its header shows. */
export interface ScopeFolder {
  readonly root: string;
  readonly name: string;
}

/** One visible row of a plain folder's tree. */
export interface FolderRow {
  readonly root: string;
  /** Forward-slash path under the root. */
  readonly rel: string;
  readonly name: string;
  readonly type: PlainFolderEntry['type'];
  readonly depth: number;
}

/** A listed level, or the root that could not be listed. */
type Level = readonly PlainFolderEntry[] | 'missing';

/** The cache key of one level: root and sub-path. */
function levelKey(root: string, rel: string): string {
  return `${root}\n${rel}`;
}

/** The last segment of an absolute path, either separator, a trailing one ignored. */
function lastSegment(root: string): string {
  const parts = root.split(/[\\/]+/).filter((p) => p !== '');
  return parts[parts.length - 1] ?? root;
}

/** A scope that narrows Files: a choice with sources. */
type NarrowingScope = WorkspaceScopeOption & { readonly sources: NonNullable<WorkspaceScopeOption['sources']> };

/**
 * The Files panel under the title bar's project filter (req-285, board 7n):
 * which vaults show, which are read-only for the project, the summary line,
 * and the read-only trees of the project's plain folders -- listed one
 * level at a time over `folder:list`, opened as external tabs. "All" and a
 * choice without sources leave the panel as it was.
 *
 * Root-provided on purpose: `FilesPanel` must not name it in its eager
 * `providers` -- this file reaches `views` -> `dock` -> the widget registry
 * -> `FilesPanel`, and a provider list read at module load would see it
 * undefined whenever the load starts here. Injected lazily, the order does
 * not matter (the same shape as the Open windows panel over `views`).
 */
@Injectable({ providedIn: 'root' })
export class FilesScopeState {
  private readonly scope = inject(WorkspaceScopeService);
  private readonly vault = inject(VaultService);
  private readonly editor = inject(EditorService);
  private readonly i18n = inject(I18nService);

  /** The active choice when it narrows Files; null = the panel is unchanged. */
  readonly active = computed<NarrowingScope | null>(() => {
    const option = this.scope.active();
    return option?.sources ? (option as NarrowingScope) : null;
  });

  /** The registered vaults the panel shows, in registry order. */
  readonly vaults = computed<VaultStatus[]>(() => {
    const all = this.vault.vaults();
    const ids = scopeVaultIds(this.active(), all);
    return ids === null ? all : all.filter((v) => ids.has(v.id));
  });

  /** Ids of the shown vaults the project only reads. */
  private readonly readOnlyIds = computed<ReadonlySet<string>>(() => {
    const active = this.active();
    if (active === null) {
      return new Set();
    }
    const names = new Set(active.sources.vaults.filter((v) => v.readOnly).map((v) => v.name));
    return new Set(this.vaults().filter((v) => names.has(v.name)).map((v) => v.id));
  });

  readonly folders = computed<ScopeFolder[]>(() =>
    (this.active()?.sources.folders ?? []).map((root) => ({ root, name: lastSegment(root) })),
  );

  /** "Drey · 2 vaults, 1 folder" -- only while a narrowing scope is active. */
  readonly summary = computed<string | null>(() => {
    const active = this.active();
    return active === null
      ? null
      : this.i18n.t('files.scope.summary', {
          label: active.label,
          vaults: this.vaults().length,
          folders: this.folders().length,
        });
  });

  private readonly levels = signal<ReadonlyMap<string, Level>>(new Map());
  private readonly expanded = signal<ReadonlySet<string>>(new Set());
  private readonly collapsed = signal<ReadonlySet<string>>(new Set());
  private readonly pending = new Set<Promise<void>>();

  constructor() {
    // A (re)picked scope lists its folders afresh: what is on disk may have
    // changed since the last time this project was shown.
    effect(() => {
      const roots = this.folders().map((f) => f.root);
      untracked(() => {
        this.levels.set(new Map());
        for (const root of roots) {
          this.load(root, '');
        }
      });
    });
  }

  isReadOnly(vaultId: string): boolean {
    return this.readOnlyIds().has(vaultId);
  }

  isSectionCollapsed(root: string): boolean {
    return this.collapsed().has(root);
  }

  isExpanded(root: string, rel: string): boolean {
    return this.expanded().has(levelKey(root, rel));
  }

  toggleSection(root: string): void {
    this.collapsed.update((set) => toggled(set, root));
  }

  /** Folds or unfolds a directory row; its level is listed the first time it opens. */
  toggleDir(root: string, rel: string): void {
    const key = levelKey(root, rel);
    const opening = !this.expanded().has(key);
    this.expanded.update((set) => toggled(set, key));
    if (opening && !this.levels().has(key)) {
      this.load(root, rel);
    }
  }

  /** The visible rows of one folder, or 'missing' when its root cannot be listed. */
  rows(root: string): readonly FolderRow[] | 'missing' {
    const levels = this.levels();
    const top = levels.get(levelKey(root, ''));
    if (top === 'missing') {
      return 'missing';
    }
    const out: FolderRow[] = [];
    const walk = (entries: Level | undefined, parent: string, depth: number): void => {
      if (entries === undefined || entries === 'missing') {
        return;
      }
      for (const entry of entries) {
        const rel = parent ? `${parent}/${entry.name}` : entry.name;
        out.push({ root, rel, name: entry.name, type: entry.type, depth });
        if (entry.type === 'directory' && this.isExpanded(root, rel)) {
          walk(levels.get(levelKey(root, rel)), rel, depth + 1);
        }
      }
    };
    walk(top, '', 0);
    return out;
  }

  /** The absolute OS path of a row, in the root's separator style. */
  pathOf(root: string, rel: string): string {
    return rel === '' ? root : absolutePath(root, rel);
  }

  /** Opens a file of a plain folder as an external tab (ADR-0054). */
  open(row: FolderRow): void {
    if (row.type === 'file') {
      void this.editor.openExternalFile(this.pathOf(row.root, row.rel));
    }
  }

  async reveal(root: string, rel: string): Promise<void> {
    await window.dreyApi?.revealPlainFolderPath?.({ root, rel });
  }

  /** Resolves once every listing started so far has landed (test hygiene). */
  async idle(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.all([...this.pending]);
    }
  }

  private load(root: string, rel: string): void {
    const api = typeof window !== 'undefined' ? window.dreyApi : undefined;
    if (typeof api?.listPlainFolder !== 'function') {
      return;
    }
    const key = levelKey(root, rel);
    const job = api
      .listPlainFolder({ root, rel })
      .then(
        (entries): Level => entries,
        (): Level => (rel === '' ? 'missing' : []),
      )
      .then((level) => {
        // A scope switched meanwhile: drop a listing of a folder no longer shown.
        if (this.folders().some((f) => f.root === root)) {
          this.levels.update((map) => new Map(map).set(key, level));
        }
      })
      .finally(() => this.pending.delete(job));
    this.pending.add(job);
  }
}

function toggled(set: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(set);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  return next;
}
