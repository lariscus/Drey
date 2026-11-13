/**
 * The project writes of Settings → Projects (req-284, board 7m): create or
 * change one record, remove one, and add a repository found in a folder —
 * each one commit in the tickets vault, applied as made (ADR-0010 later
 * change). Pure types; the engine's `services/project-service.ts` answers them.
 */
import type { ProjectRecord } from './projects';
import type { RepoRef } from './repo-ref';

/** A record as the page edits it: everything but the id, which the file stem fixes. */
export type ProjectDraft = Omit<ProjectRecord, 'id'>;

/** `projectSave`: `id` absent = a new project (its id minted from the name); present = that record rewritten. */
export interface ProjectSaveCommand {
  readonly id?: string;
  readonly project: ProjectDraft;
}

/** `projectRemove`: the record's file leaves, in one commit; tickets that name it keep the name (the board reports it). */
export interface ProjectRemoveCommand {
  readonly id: string;
}

/**
 * `projectAddRepo` (*From folder…*): the repository joins `repos.md` when no
 * entry of that name exists and the project lists it — both files, one commit.
 */
export interface ProjectAddRepoCommand {
  readonly id: string;
  readonly repo: RepoRef;
}

export type ProjectFailureCode = 'no_vault' | 'invalid' | 'no_project' | 'write';

export type ProjectReply =
  | { readonly ok: true; readonly id: string; readonly warning?: string }
  | { readonly ok: false; readonly code: ProjectFailureCode; readonly error: string };

/** The port the invoke table and the routes call. */
export interface ProjectPort {
  projectSave(cmd: ProjectSaveCommand): Promise<ProjectReply>;
  projectRemove(cmd: ProjectRemoveCommand): Promise<ProjectReply>;
  projectAddRepo(cmd: ProjectAddRepoCommand): Promise<ProjectReply>;
}
