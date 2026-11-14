/** What the blocks of Settings → Projects (req-284) share: the API, the words and the writes. */
import type { DreyPluginApi } from '../../../../shared/plugin-api/renderer';
import type { I18n } from '../../../../shared/i18n/types';
import type { ProjectDraft } from '../../../../packages/tickets-engine/src/contracts/project-commands';
import type { ProjectRecord } from '../../../../packages/tickets-engine/src/contracts/projects';

/** What a picked folder or a clone became: the repository listed, the folder added, or the words for why not. */
export type FolderOutcome =
  | { readonly ok: true; readonly kind: 'repository' | 'folder'; readonly name: string }
  | { readonly ok: false; readonly message: string; /** The owner cancelled a clone: no message to show. */ readonly cancelled?: boolean };

/** git's own progress words and the share done, as the clone prints them. */
export interface CloneProgressEvent {
  readonly phase: string;
  readonly percent: number;
}

export interface ProjectsContext {
  readonly api: DreyPluginApi;
  readonly t: I18n['t'];
  /** `repos.md`'s names, in file order. */
  repoNames(): readonly string[];
  /** This device's registered vaults by name, in registry order. */
  vaultNames(): readonly string[];
  /** The record as the page last wrote or read it. */
  latest(id: string): ProjectRecord;
  /** One commit of the latest record with `patch` over it; resolves true when it was written. */
  save(id: string, patch: Partial<ProjectDraft>): Promise<boolean>;
  remove(id: string): Promise<boolean>;
  /** The system folder picker (opened by Drey's own process) titled `title`; null when cancelled. */
  pickFolder(title: string): Promise<string | null>;
  /**
   * The picked folder joins the project (req-304): a git repository — its root or a folder
   * inside one — is listed (and registered in `repos.md`), a plain folder becomes a read-only
   * folder; `repoOnly` refuses a plain one. One commit; the page reloads so its copy follows.
   */
  addFolder(id: string, folder: string, repoOnly: boolean): Promise<FolderOutcome>;
  /** Clones `url` into a subfolder of `parent`, then lists it like `addFolder`; `onProgress` follows the clone. */
  cloneRepo(id: string, url: string, parent: string, onProgress: (progress: CloneProgressEvent) => void): Promise<FolderOutcome>;
  /** Stops the running clone. */
  cancelClone(): void;
}
