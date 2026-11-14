/**
 * The project writes of Settings → Projects (req-284, board 7m): create or
 * change one record, remove one, and add a repository found in a folder —
 * each one commit in the tickets vault, applied as made (ADR-0010 later
 * change). Pure types; the engine's `services/project-service.ts` answers them.
 */
import type { ProjectRecord } from './projects';

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
 * `projectAddFolder` (*Add folder*, *From folder…*, and a finished clone):
 * the folder the owner picked is probed with the installed git. A git
 * repository — its root or a folder inside it — joins `repos.md` when no
 * entry names that checkout yet and the project lists it (both files, one
 * commit); a plain folder becomes one of the project's read-only folders.
 * `repoOnly` (*From folder…*, a clone) refuses a plain folder instead.
 */
export interface ProjectAddFolderCommand {
  readonly id: string;
  readonly folder: string;
  readonly repoOnly?: boolean;
}

export type ProjectFailureCode = 'no_vault' | 'invalid' | 'no_project' | 'write' | 'not_a_folder' | 'not_a_repository';

export type ProjectReply =
  | { readonly ok: true; readonly id: string; readonly warning?: string }
  | { readonly ok: false; readonly code: ProjectFailureCode; readonly error: string };

/** What `projectAddFolder` made of the folder: the repository it listed, or the folder it added. */
export type ProjectFolderReply =
  | { readonly ok: true; readonly id: string; readonly kind: 'repository' | 'folder'; readonly name: string; readonly warning?: string }
  | { readonly ok: false; readonly code: ProjectFailureCode; readonly error: string };

/** The port the invoke table and the routes call. */
export interface ProjectPort {
  projectSave(cmd: ProjectSaveCommand): Promise<ProjectReply>;
  projectRemove(cmd: ProjectRemoveCommand): Promise<ProjectReply>;
  projectAddFolder(cmd: ProjectAddFolderCommand): Promise<ProjectFolderReply>;
}
