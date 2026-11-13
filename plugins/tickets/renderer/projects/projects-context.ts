/** What the blocks of Settings → Projects (req-284) share: the API, the words and the writes. */
import type { DreyPluginApi } from '../../../../shared/plugin-api/renderer';
import type { I18n } from '../../../../shared/i18n/types';
import type { RepoCandidate, RepoRef } from '../../shared/tickets';
import type { ProjectDraft } from '../../../../packages/tickets-engine/src/contracts/project-commands';
import type { ProjectRecord } from '../../../../packages/tickets-engine/src/contracts/projects';

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
  addRepo(id: string, repo: RepoRef): Promise<boolean>;
  remove(id: string): Promise<boolean>;
  /** The native folder picker; null when cancelled. */
  pickFolder(): Promise<string | null>;
  /** The folder picker, then the git repositories found in the folder. */
  scanFolder(): Promise<readonly RepoCandidate[]>;
}
