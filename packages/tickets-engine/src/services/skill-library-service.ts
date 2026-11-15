import type {
  SkillDeleteCommand,
  SkillLibraryCommand,
  SkillLibraryData,
  SkillLibraryPort,
  SkillLibraryReply,
  SkillSourceFetchCommand,
  SkillSourceRemoveCommand,
  SkillSourceReply,
  SkillSourceUpdateCommand,
} from '../contracts/skill-library';
import type { SkillErrorCode, SkillFailure } from '../contracts/skills';
import { personaRef, type Persona } from '../core/persona/persona';
import { isSkillName, ownSkillDir, sharedSkillDir } from '../core/skills/skill';
import { isRefName, normalizeSourcePath, parseGithubRepo, sourceIdOf, type GithubRepo } from '../core/skills/skill-source';
import { recordId, type SkillSourceRecord } from '../core/skills/skill-sources-file';
import type { EngineVault } from './host';
import { NodeSkillFileSystem, type SkillFileSystem } from './skill-file-system';
import { buildSkillKit, type SkillKit, type SkillKitGit, type SkillKitHost } from './skill-kit';
import { SkillLibraryLister } from './skill-library-lister';
import type { SkillsBoard } from './skill-service';
import type { SkillSourceFetcher } from './skill-source-fetcher';
import { SkillSourceWriter, type FolderChange } from './skill-source-writer';
import type { SkillUpdateChecks } from './skill-update-checks';
import type { SkillWriteQueue } from './skill-write-queue';

export interface SkillLibraryDeps {
  readonly board: Pick<SkillsBoard, 'detect' | 'loadPersona' | 'listPersonaIds'>;
  readonly host: SkillKitHost;
  readonly git: SkillKitGit;
  readonly fetcher: SkillSourceFetcher;
  readonly checks: SkillUpdateChecks;
  /** The engine's one queue of skill writes, shared with `SkillService`. */
  readonly queue: SkillWriteQueue;
  readonly fsFor?: (vault: EngineVault) => SkillFileSystem;
  readonly now?: () => Date;
}

type Ready = { readonly vault: EngineVault; readonly kit: SkillKit; readonly writer: SkillSourceWriter };
type Target = { readonly repo: GithubRepo; readonly path: string; readonly ref: string; readonly previous: readonly string[] };

const fail = (code: SkillErrorCode, error: string): SkillFailure => ({ ok: false, code, error });

/**
 * Settings → Skills library's engine half (req-289): the listing of every
 * skill with its users and source, and the GitHub sources — fetch, update,
 * remove — plus deleting a skill from the library. Each write is one commit
 * of exactly its files and the record (`skill-sources.md`), queued with
 * every other skill write. GitHub is asked only here, on the owner's action.
 */
export class SkillLibraryService implements SkillLibraryPort {
  constructor(private readonly deps: SkillLibraryDeps) {}

  skillLibrary(cmd: SkillLibraryCommand = {}): Promise<SkillLibraryReply> {
    return this.withVault(async (ready) => {
      if (cmd.check === true) {
        await this.deps.checks.check((await ready.kit.sources.read()).sources);
      }
      return { ok: true, library: await this.listOf(ready) };
    });
  }

  skillSourceFetch(cmd: SkillSourceFetchCommand): Promise<SkillSourceReply> {
    return this.write(async (ready) => {
      const repo = parseGithubRepo(typeof cmd.repo === 'string' ? cmd.repo : '');
      const path = normalizeSourcePath(typeof cmd.path === 'string' ? cmd.path : '');
      const ref = typeof cmd.ref === 'string' ? cmd.ref.trim() : '';
      if (repo === null || path === null || !isRefName(ref)) {
        return fail('bad_source', 'a source is a github.com repository, a folder in it and a tag or branch');
      }
      const id = sourceIdOf(repo.repo, path);
      if ((await this.recordOf(ready, id)) !== null) {
        return fail('exists', `${id} is already a source — update it instead`);
      }
      return this.fetchInto(ready, { repo, path, ref, previous: [] });
    });
  }

  skillSourceUpdate(cmd: SkillSourceUpdateCommand): Promise<SkillSourceReply> {
    return this.write(async (ready) => {
      const record = await this.recordOf(ready, cmd.source);
      const repo = record === null ? null : parseGithubRepo(record.repo);
      if (record === null || repo === null) {
        return fail('no_source', `no source ${cmd.source}`);
      }
      const ref = typeof cmd.to === 'string' && cmd.to.trim() !== '' ? cmd.to.trim() : record.ref;
      return isRefName(ref) ? this.fetchInto(ready, { repo, path: record.path, ref, previous: record.skills }) : fail('bad_source', `${ref} is no tag or branch name`);
    });
  }

  skillSourceRemove(cmd: SkillSourceRemoveCommand): Promise<SkillSourceReply> {
    return this.write(async (ready) => {
      const record = await this.recordOf(ready, cmd.source);
      if (record === null) {
        return fail('no_source', `no source ${cmd.source}`);
      }
      const deleted = await ready.writer.removeFolders(record.skills);
      const file = await ready.kit.sources.put(recordId(record), null);
      return this.committed(ready, { changed: [file], deleted }, `skills: source ${recordId(record)} removed (${record.skills.length} skills)`);
    });
  }

  skillDelete(cmd: SkillDeleteCommand): Promise<SkillSourceReply> {
    return this.write(async (ready) => {
      if (!isSkillName(typeof cmd.name === 'string' ? cmd.name : '')) {
        return fail('bad_name', 'a skill is named like its folder');
      }
      const persona = cmd.persona === undefined ? null : await this.personaOf(ready, cmd.persona);
      if (persona !== null && 'ok' in persona) {
        return persona;
      }
      const folder = persona === null ? sharedSkillDir(cmd.name) : ownSkillDir(persona.id, cmd.name);
      const files = (await ready.kit.fs.files(folder)).map((file) => `${folder}/${file}`);
      if (files.length === 0) {
        return fail('no_skill', `no skill ${cmd.name} ${persona === null ? 'in the shared pool' : `of ${persona.id}`}`);
      }
      await ready.kit.fs.remove(folder);
      const record = persona === null ? await ready.kit.sources.dropSkill(cmd.name) : null;
      const where = persona === null ? 'from the shared pool' : `of ${persona.id}`;
      return this.committed(ready, { changed: record === null ? [] : [record], deleted: files }, `skills: ${cmd.name} deleted ${where}`);
    });
  }

  // --- plumbing ----------------------------------------------------------

  private async fetchInto(ready: Ready, target: Target): Promise<SkillSourceReply> {
    const outcome = await this.deps.fetcher.fetch(target.repo, target.path, target.ref);
    if (!outcome.ok) {
      return outcome;
    }
    if (outcome.skills.length === 0) {
      return fail(outcome.skipped[0]?.code ?? 'no_skill', `no skill could be taken: ${outcome.skipped.map((skip) => `${skip.folder}: ${skip.error}`).join('; ')}`);
    }
    const names = outcome.skills.map((skill) => skill.name).sort();
    const clashes = (await ready.writer.taken(names)).filter((name) => !target.previous.includes(name));
    if (clashes.length > 0) {
      return fail('exists', `the library already holds ${clashes.join(', ')} — delete ${clashes.length === 1 ? 'it' : 'them'} first`);
    }
    const change = await ready.writer.replace(target.previous, outcome.skills);
    const now = (this.deps.now ?? (() => new Date()))();
    const record: SkillSourceRecord = { repo: target.repo.repo, path: target.path, ref: target.ref, commit: outcome.commit, fetched: now.toISOString(), skills: names };
    const file = await ready.kit.sources.put(recordId(record), record);
    const verb = target.previous.length === 0 ? 'fetched' : 'updated';
    const warning = await ready.kit.committer.commit(ready.vault, { changed: [...change.changed, file], deleted: change.deleted }, `skills: ${recordId(record)} ${verb} at ${target.ref} (${names.length} skills)`);
    // the page shows at once whether a newer ref than the one just fetched exists
    await this.deps.checks.check([record]);
    return { ok: true, library: await this.listOf(ready), source: recordId(record), skipped: outcome.skipped, warning };
  }

  private async committed(ready: Ready, change: FolderChange, message: string): Promise<SkillSourceReply> {
    const warning = await ready.kit.committer.commit(ready.vault, change, message);
    return { ok: true, library: await this.listOf(ready), skipped: [], warning };
  }

  private async listOf(ready: Ready): Promise<SkillLibraryData> {
    const personas: Persona[] = [];
    for (const id of await this.deps.board.listPersonaIds()) {
      const persona = await this.deps.board.loadPersona(ready.vault, id);
      if (persona !== null) {
        personas.push(persona);
      }
    }
    return new SkillLibraryLister(ready.kit, (record) => this.deps.checks.lookOf(record)).list(personas);
  }

  private async recordOf(ready: Ready, id: string): Promise<SkillSourceRecord | null> {
    return (await ready.kit.sources.read()).sources.find((source) => recordId(source) === id) ?? null;
  }

  private async personaOf(ready: Ready, raw: string): Promise<Persona | SkillFailure> {
    let id: string;
    try {
      id = personaRef(raw);
    } catch {
      return fail('no_persona', `${raw} is not a persona id`);
    }
    return (await this.deps.board.loadPersona(ready.vault, id)) ?? fail('no_persona', `no persona named ${id}`);
  }

  private async withVault<T extends { readonly ok: boolean }>(body: (ready: Ready) => Promise<T>): Promise<T | SkillFailure> {
    const vault = await this.deps.board.detect();
    if (vault === null) {
      return fail('no_vault', 'no tickets vault detected');
    }
    const fs = this.deps.fsFor?.(vault) ?? new NodeSkillFileSystem(vault.path);
    return body({ vault, kit: buildSkillKit(fs, this.deps.host, this.deps.git), writer: new SkillSourceWriter(fs) });
  }

  private write<T extends { readonly ok: boolean }>(body: (ready: Ready) => Promise<T>): Promise<T | SkillFailure> {
    return this.deps.queue.run(() => this.withVault(body));
  }
}
