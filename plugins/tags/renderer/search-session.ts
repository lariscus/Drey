/**
 * The Search panel's model: the query, the persisted choices, the hits of
 * the last run and the run itself. No DOM -- the panel, the replace flow
 * and the summary all read and change this one object and re-render
 * through `subscribe`.
 */
import type {
  DreyPluginApi,
  SectionSearchScope,
  TagSearchHit,
  TagSearchQuery,
} from '../../../shared/plugin-api/renderer';
import {
  buildTextMatcher,
  filterChatHits,
  runTagSearch,
} from '../shared/search.js';
import { sectionRecordsFor } from '../shared/section-records.js';
import { scopeNarrows, scopeVaultIds, type NamedVault } from '../../../shared/workspace-scope';
import { mergeOpenBufferHits } from './hit-list.js';
import { loadPrefs, savePrefs, type Scope, type SearchPrefs } from './search-prefs.js';

/** Files under here are kept out of the tag index (mirrors the main-side index). */
const TEMPLATES_PREFIX = 'templates/';

export interface SearchState {
  queryTags: string[];
  queryText: string;
  replacement: string;
  hits: TagSearchHit[];
  searching: boolean;
  ran: boolean;
  /** Matcher / provider error, surfaced instead of a silent empty list. */
  error: string | null;
  /** The summarise flow's error (a failed generation), beside the search error. */
  summaryError: string | null;
}

export interface SearchSession {
  /** Mutable; call `persistPrefs()` after a change. */
  readonly prefs: SearchPrefs;
  /** Mutable; call `notify()` after a change. */
  readonly state: SearchState;
  /** File groups the user folded; a fresh result set starts unfolded. */
  readonly collapsedFiles: Set<string>;
  persistPrefs(): void;
  subscribe(listener: () => void): () => void;
  notify(): void;
  activeVaultId(): string | null;
  /**
   * The scope a run uses: `prefs.scope`, except that a stored `project`
   * reads as `vault` while the title bar's choice does not narrow (none, or
   * one without sources) -- the pref is kept, so it comes back with one.
   */
  scope(): Scope;
  /** The title bar's choice's name while it narrows (This project is offered), else null. */
  projectLabel(): string | null;
  /** Project scope: the ids of the registered vaults the choice names, else null. */
  projectVaultIds(): ReadonlySet<string> | null;
  hasQuery(): boolean;
  currentQuery(): TagSearchQuery;
  /** The focused document when it is a text tab, else null. */
  activeTextDoc(): ReturnType<DreyPluginApi['documents']['active']>;
  run(): Promise<void>;
  /** Empties the query and the results. */
  clear(): void;
}

export function createSearchSession(api: DreyPluginApi): SearchSession {
  const prefs = loadPrefs();
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of [...listeners]) {
      listener();
    }
  };

  // Hits of another vault are labelled with it, so a switch re-renders.
  let activeVaultId: string | null = null;
  let vaults: readonly NamedVault[] = [];
  const refreshVaults = (): void => {
    void api.vault
      .listVaults()
      .then((list) => {
        vaults = list;
        activeVaultId = list.find((v) => v.active)?.id ?? null;
        notify();
      })
      .catch(() => undefined);
  };
  refreshVaults();
  api.vault.onChanged(refreshVaults);

  const scope = (): Scope =>
    prefs.scope === 'project' && !scopeNarrows(api.ui.workspaceScope()) ? 'vault' : prefs.scope;
  const projectLabel = (): string | null => {
    const option = api.ui.workspaceScope();
    return option !== null && scopeNarrows(option) ? option.label : null;
  };
  const projectVaultIds = (): ReadonlySet<string> | null =>
    scope() === 'project' ? scopeVaultIds(api.ui.workspaceScope(), vaults) : null;

  const state: SearchState = {
    queryTags: [],
    queryText: '',
    replacement: '',
    hits: [],
    searching: false,
    ran: false,
    error: null,
    summaryError: null,
  };
  const hasQuery = (): boolean => state.queryTags.length > 0 || state.queryText.trim() !== '';

  const currentQuery = (): TagSearchQuery => ({
    tags: state.queryTags,
    text: state.queryText.trim(),
    match: {
      caseSensitive: prefs.matchCase,
      wholeWord: prefs.wholeWord,
      regex: prefs.regex,
    },
  });

  const activeTextDoc = (): ReturnType<typeof api.documents.active> => {
    const doc = api.documents.active();
    return doc !== null && doc.kind === 'text' ? doc : null;
  };

  /**
   * The open tabs whose unsaved text takes part in a vault / all / project
   * search; `inScope` narrows them to the scope's vaults (null = every vault).
   */
  const dirtyDocs = (
    inScope: ReadonlySet<string> | null,
  ): ReturnType<typeof api.documents.list> =>
    api.documents
      .list()
      .filter(
        (d) =>
          d.kind === 'text' &&
          d.dirty &&
          d.vaultId !== null &&
          !d.path.startsWith(TEMPLATES_PREFIX) &&
          d.name !== 'search-results.md' &&
          (inScope === null || inScope.has(d.vaultId)),
      );

  /** Ends a run that cannot search: the reason shows instead of an empty list. */
  const refuse = (message: string): void => {
    state.error = message;
    state.hits = [];
    state.ran = true;
    notify();
  };

  const run = async (): Promise<void> => {
    if (!hasQuery()) {
      state.hits = [];
      state.ran = false;
      state.error = null;
      notify();
      return;
    }
    const matcher = buildTextMatcher(currentQuery());
    if (!matcher.ok) {
      refuse(matcher.error);
      return;
    }
    const runScope = scope();
    if (runScope === 'file' && activeTextDoc() === null) {
      refuse('Open a text document to search the file scope.');
      return;
    }
    state.searching = true;
    state.error = null;
    notify();
    try {
      if (runScope === 'file') {
        const doc = activeTextDoc();
        state.hits =
          doc === null
            ? []
            : runTagSearch(sectionRecordsFor(doc.path, doc.buffer), currentQuery()).map((h) => ({
                ...h,
                vaultId: doc.vaultId ?? undefined,
              }));
        state.ran = true;
      } else {
        // Project scope: every vault searched, the hits kept to the vaults the
        // title bar's choice names (resolved by name against a fresh registry).
        let inScope: ReadonlySet<string> | null = null;
        if (runScope === 'project') {
          vaults = await api.vault.listVaults();
          inScope = scopeVaultIds(api.ui.workspaceScope(), vaults) ?? new Set<string>();
        } else if (runScope === 'vault') {
          inScope = new Set(activeVaultId !== null ? [activeVaultId] : []);
        }
        const searchScope: SectionSearchScope | undefined =
          runScope === 'all' || runScope === 'project'
            ? { kind: 'all' }
            : activeVaultId !== null
              ? { kind: 'vault', vaultId: activeVaultId }
              : undefined;
        const query = currentQuery();
        const found = await api.search.searchSections(query, searchScope);
        const diskHits =
          runScope === 'project'
            ? found.filter((h) => h.vaultId !== undefined && inScope?.has(h.vaultId) === true)
            : found;
        // Chats stay indexed; the panel lists them only on request.
        state.hits = filterChatHits(
          mergeOpenBufferHits(diskHits, dirtyDocs(inScope), query),
          prefs.includeChats,
        );
        state.ran = true;
      }
    } catch (error) {
      // A rejected search (e.g. the tags backend is gone) is a message,
      // never a silent empty panel.
      state.error = error instanceof Error ? error.message : String(error);
      state.hits = [];
    } finally {
      state.searching = false;
      notify();
    }
  };

  // The title bar's choice changed: a stored project scope now searches other
  // vaults (or, without sources, the active vault) -- re-run what is shown.
  api.ui.onWorkspaceScopeChange(() => {
    notify();
    if (prefs.scope === 'project' && state.ran && hasQuery()) {
      void run();
    }
  });

  return {
    prefs,
    state,
    collapsedFiles: new Set<string>(),
    persistPrefs: () => savePrefs(prefs),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    notify,
    activeVaultId: () => activeVaultId,
    scope,
    projectLabel,
    projectVaultIds,
    hasQuery,
    currentQuery,
    activeTextDoc,
    run,
    clear: () => {
      state.queryTags = [];
      state.queryText = '';
      state.hits = [];
      state.ran = false;
      state.error = null;
      state.summaryError = null;
      notify();
    },
  };
}
