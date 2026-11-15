import type { ProjectAddFolderCommand, ProjectFolderReply, ProjectPort, ProjectRemoveCommand, ProjectReply, ProjectSaveCommand } from '../contracts/project-commands';
import { PROJECTS_DIR, type ProjectRecord } from '../contracts/projects';
import { checkDraft, isProjectId, mintProjectId, recordOf } from '../core/projects/project-edit';
import { parseProjectFile, projectFileText, projectIdOfPath } from '../core/projects/project-record';
import { chooseRepoEntry, type RepoSeed } from '../core/projects/repo-entry';
import { parseRepos, reposFileText, reposProse } from '../core/projects/repos-file';
import type { TicketsGit } from '../core/git/tickets-git';
import type { EngineHost, EngineVault } from './host';
import type { FolderProbe } from './folder-probe';
import { SkillCommitter } from './skill-committer';
import { NodeSkillFileSystem, type SkillFileSystem } from './skill-file-system';

const REPOS_PATH = 'tickets/_meta/repos.md';

export interface ProjectServiceDeps {
  readonly board: { detect(): Promise<EngineVault | null> };
  readonly host: Pick<EngineHost, 'read' | 'write' | 'listMarkdownFiles' | 'announceChanges' | 'log'>;
  readonly git: Pick<TicketsGit, 'locate' | 'commitTree'>;
  /** Tells a picked folder's git repository from a plain folder (req-304). */
  readonly probe: Pick<FolderProbe, 'probe'>;
  /** The disk of a vault (a removal deletes the record's file); default the vault folder itself. */
  readonly fsFor?: (vault: EngineVault) => SkillFileSystem;
  /** Fires after every write that changed a file (the board's change event). */
  readonly changed?: () => void;
}

const fail = (code: Extract<ProjectReply, { ok: false }>['code'], error: string): Extract<ProjectReply, { ok: false }> => ({ ok: false, code, error });

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const pathOf = (id: string): string => `${PROJECTS_DIR}/${id}.md`;

/**
 * Settings → Projects' writes (req-284, board 7m): a record created or
 * changed, removed, or given a folder — a git repository found in it joins
 * `repos.md` (req-304) — each change
 * one commit of exactly the files it touched (`projects: …`), then the
 * vault's change round, so every client's snapshot follows. Writes queue;
 * a write that changes nothing commits nothing.
 */
export class ProjectService implements ProjectPort {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: ProjectServiceDeps) {}

  projectSave(cmd: ProjectSaveCommand): Promise<ProjectReply> {
    return this.queue(() => this.save(cmd));
  }

  projectRemove(cmd: ProjectRemoveCommand): Promise<ProjectReply> {
    return this.queue(() => this.remove(cmd));
  }

  projectAddFolder(cmd: ProjectAddFolderCommand): Promise<ProjectFolderReply> {
    return this.queue(() => this.addFolder(cmd));
  }

  private queue<R>(op: () => Promise<R>): Promise<R> {
    const next = this.tail.catch(() => undefined).then(op);
    this.tail = next;
    return next;
  }

  private async save(cmd: ProjectSaveCommand): Promise<ProjectReply> {
    const checked = checkDraft(cmd.project ?? ({} as ProjectSaveCommand['project']));
    if (!checked.ok) {
      return fail('invalid', checked.error);
    }
    const vault = await this.deps.board.detect();
    if (vault === null) {
      return fail('no_vault', 'no tickets vault detected');
    }
    const ids = await this.projectIds(vault);
    const creating = cmd.id === undefined;
    if (!creating && (!isProjectId(cmd.id) || !ids.includes(cmd.id))) {
      return fail('no_project', `no project "${String(cmd.id)}"`);
    }
    const id = creating ? mintProjectId(checked.draft.name, ids) : (cmd.id as string);
    const record = recordOf(id, checked.draft);
    const message = creating ? `projects: ${record.name} created (req-284)` : `projects: ${record.name} changed (req-284)`;
    return this.write(vault, [[pathOf(id), projectFileText(record)]], message, id);
  }

  private async remove(cmd: ProjectRemoveCommand): Promise<ProjectReply> {
    if (!isProjectId(cmd.id)) {
      return fail('invalid', `${String(cmd.id)} is not a project id`);
    }
    const vault = await this.deps.board.detect();
    if (vault === null) {
      return fail('no_vault', 'no tickets vault detected');
    }
    const record = await this.record(vault, cmd.id);
    if (record === null) {
      return fail('no_project', `no project "${cmd.id}"`);
    }
    const fs = this.deps.fsFor?.(vault) ?? new NodeSkillFileSystem(vault.path);
    try {
      await fs.remove(pathOf(cmd.id));
    } catch (error) {
      return fail('write', `remove failed: ${messageOf(error)}`);
    }
    const warning = await this.committer().commit(vault, { changed: [], deleted: [pathOf(cmd.id)] }, `projects: ${record.name} removed (req-284)`);
    this.deps.changed?.();
    return { ok: true, id: cmd.id, ...(warning === null ? {} : { warning }) };
  }

  private async addFolder(cmd: ProjectAddFolderCommand): Promise<ProjectFolderReply> {
    const folder = typeof cmd.folder === 'string' ? cmd.folder.trim() : '';
    if (folder === '') {
      return fail('invalid', 'which folder?');
    }
    const vault = await this.deps.board.detect();
    if (vault === null) {
      return fail('no_vault', 'no tickets vault detected');
    }
    const record = isProjectId(cmd.id) ? await this.record(vault, cmd.id) : null;
    if (record === null) {
      return fail('no_project', `no project "${String(cmd.id)}"`);
    }
    const found = await this.deps.probe.probe(folder);
    if (found.kind === 'missing') {
      return fail('not_a_folder', `${folder} is not a folder`);
    }
    if (found.kind === 'plain') {
      return cmd.repoOnly === true ? fail('not_a_repository', `${folder} is not a git repository`) : this.attachFolder(vault, record, folder);
    }
    return this.attachRepo(vault, record, found.seed);
  }

  /** A plain folder: one of the project's read-only folders. */
  private async attachFolder(vault: EngineVault, record: ProjectRecord, folder: string): Promise<ProjectFolderReply> {
    const next: ProjectRecord = { ...record, folders: record.folders.includes(folder) ? record.folders : [...record.folders, folder] };
    const reply = await this.write(vault, [[pathOf(record.id), projectFileText(next)]], `projects: ${record.name} — folder ${folder} added (req-304)`, record.id);
    return reply.ok ? { ...reply, kind: 'folder', name: folder } : reply;
  }

  /** A recognised checkout: `repos.md` gains its entry when none names it, the project lists it, one commit. */
  private async attachRepo(vault: EngineVault, record: ProjectRecord, seed: RepoSeed): Promise<ProjectFolderReply> {
    const reposText = await this.read(vault, REPOS_PATH);
    const repos = parseRepos(reposText);
    if (repos.error !== null) {
      return fail('invalid', `repos.md does not parse: ${repos.error}`);
    }
    const choice = chooseRepoEntry(repos.repos, seed);
    const files: [string, string][] = [];
    if (choice.add !== null) {
      files.push([REPOS_PATH, reposFileText([...repos.repos, choice.add], reposProse(reposText))]);
    }
    const next: ProjectRecord = { ...record, repos: record.repos.includes(choice.name) ? record.repos : [...record.repos, choice.name] };
    files.push([pathOf(record.id), projectFileText(next)]);
    const reply = await this.write(vault, files, `projects: ${record.name} — repository ${choice.name} added (req-304)`, record.id);
    return reply.ok ? { ...reply, kind: 'repository', name: choice.name } : reply;
  }

  /** Writes the files whose text changed, then one commit of exactly those. */
  private async write(vault: EngineVault, files: readonly (readonly [string, string])[], message: string, id: string): Promise<ProjectReply> {
    const changed: string[] = [];
    try {
      for (const [path, text] of files) {
        if ((await this.read(vault, path)) !== text) {
          await this.deps.host.write(vault.id, path, text);
          changed.push(path);
        }
      }
    } catch (error) {
      return fail('write', `write failed: ${messageOf(error)}`);
    }
    if (changed.length === 0) {
      return { ok: true, id };
    }
    const warning = await this.committer().commit(vault, { changed, deleted: [] }, message);
    this.deps.changed?.();
    return { ok: true, id, ...(warning === null ? {} : { warning }) };
  }

  private committer(): SkillCommitter {
    return new SkillCommitter(this.deps.host, this.deps.git);
  }

  private async projectIds(vault: EngineVault): Promise<string[]> {
    const files = await this.deps.host.listMarkdownFiles(vault.id);
    return files.map(projectIdOfPath).filter((id): id is string => id !== null);
  }

  private async record(vault: EngineVault, id: string): Promise<ProjectRecord | null> {
    const text = await this.read(vault, pathOf(id));
    return text === null ? null : parseProjectFile(id, text).project;
  }

  private read(vault: EngineVault, path: string): Promise<string | null> {
    return this.deps.host.read(vault.id, path).catch(() => null);
  }
}
