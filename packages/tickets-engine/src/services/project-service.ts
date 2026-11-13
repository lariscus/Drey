import type { ProjectAddRepoCommand, ProjectPort, ProjectRemoveCommand, ProjectReply, ProjectSaveCommand } from '../contracts/project-commands';
import { PROJECTS_DIR, type ProjectRecord } from '../contracts/projects';
import { checkDraft, isProjectId, mintProjectId, recordOf } from '../core/project-edit';
import { parseProjectFile, projectFileText, projectIdOfPath } from '../core/project-record';
import { parseRepos, reposFileText, reposProse } from '../core/repos-file';
import type { TicketsGit } from '../core/tickets-git';
import type { EngineHost, EngineVault } from './host';
import { SkillCommitter } from './skill-committer';
import { NodeSkillFileSystem, type SkillFileSystem } from './skill-file-system';

const REPOS_PATH = 'tickets/_meta/repos.md';

export interface ProjectServiceDeps {
  readonly board: { detect(): Promise<EngineVault | null> };
  readonly host: Pick<EngineHost, 'read' | 'write' | 'listMarkdownFiles' | 'announceChanges' | 'log'>;
  readonly git: Pick<TicketsGit, 'locate' | 'commitTree'>;
  /** The disk of a vault (a removal deletes the record's file); default the vault folder itself. */
  readonly fsFor?: (vault: EngineVault) => SkillFileSystem;
  /** Fires after every write that changed a file (the board's change event). */
  readonly changed?: () => void;
}

const fail = (code: Extract<ProjectReply, { ok: false }>['code'], error: string): ProjectReply => ({ ok: false, code, error });

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const pathOf = (id: string): string => `${PROJECTS_DIR}/${id}.md`;

/**
 * Settings → Projects' writes (req-284, board 7m): a record created or
 * changed, removed, or given a repository found in a folder — each change
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

  projectAddRepo(cmd: ProjectAddRepoCommand): Promise<ProjectReply> {
    return this.queue(() => this.addRepo(cmd));
  }

  private queue(op: () => Promise<ProjectReply>): Promise<ProjectReply> {
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

  private async addRepo(cmd: ProjectAddRepoCommand): Promise<ProjectReply> {
    const name = typeof cmd.repo?.name === 'string' ? cmd.repo.name.trim() : '';
    if (name === '' || typeof cmd.repo.url !== 'string' || cmd.repo.url.trim() === '') {
      return fail('invalid', 'a repository needs a name and a url');
    }
    const vault = await this.deps.board.detect();
    if (vault === null) {
      return fail('no_vault', 'no tickets vault detected');
    }
    const record = isProjectId(cmd.id) ? await this.record(vault, cmd.id) : null;
    if (record === null) {
      return fail('no_project', `no project "${String(cmd.id)}"`);
    }
    const reposText = await this.read(vault, REPOS_PATH);
    const repos = parseRepos(reposText);
    if (repos.error !== null) {
      return fail('invalid', `repos.md does not parse: ${repos.error}`);
    }
    const files: [string, string][] = [];
    if (!repos.repos.some((r) => r.name === name)) {
      files.push([REPOS_PATH, reposFileText([...repos.repos, { ...cmd.repo, name, url: cmd.repo.url.trim() }], reposProse(reposText))]);
    }
    const next: ProjectRecord = { ...record, repos: record.repos.includes(name) ? record.repos : [...record.repos, name] };
    files.push([pathOf(record.id), projectFileText(next)]);
    return this.write(vault, files, `projects: ${record.name} — repository ${name} added (req-284)`, record.id);
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
