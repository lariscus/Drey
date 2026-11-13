import type {
  PromptPreviewCommand,
  PromptPreviewReply,
  SkillErrorCode,
  SkillFailure,
  SkillListData,
  SkillListReply,
  SkillRemoveCommand,
  SkillsPort,
  SkillToggleCommand,
  SkillUploadCommand,
  SkillUploadReply,
} from '../contracts/skills';
import { personaRef, splitPoolEntry, type Persona } from '../core/persona';
import { isSkillName, ownSkillsDir, SHARED_SKILLS_DIR } from '../core/skill';
import { tokenizerFor } from '../core/token-count';
import type { EngineVault } from './host';
import { NodeSkillFileSystem, type SkillFileSystem } from './skill-file-system';
import { buildSkillKit, type SkillKit, type SkillKitGit, type SkillKitHost } from './skill-kit';
import type { SkillProvenance } from './skill-lister';
import { sourceRefOf } from './skill-source-store';
import type { SkillUpdateChecks } from './skill-update-checks';
import { SkillWriteQueue } from './skill-write-queue';

/** The board as the skills need it: the vault, the personas and the persona patch that holds the selection. */
export interface SkillsBoard {
  detect(): Promise<EngineVault | null>;
  loadPersona(vault: EngineVault, id: string): Promise<Persona | null>;
  listPersonaIds(): Promise<readonly string[]>;
  personaPatch(input: { readonly id: string; readonly skills: readonly string[] }): Promise<{ readonly ok: true; readonly warning?: string } | { readonly ok: false; readonly error: string }>;
}

export interface SkillServiceDeps {
  readonly board: SkillsBoard;
  readonly host: SkillKitHost;
  readonly git: SkillKitGit;
  /** The disk of a vault; default the vault folder itself. */
  readonly fsFor?: (vault: EngineVault) => SkillFileSystem;
  /** req-289: the engine's one queue of skill writes (the library's too); default one of its own. */
  readonly queue?: SkillWriteQueue;
  /** req-289: what the library's last look for newer refs found; absent = no `updateAvailable` is ever said. */
  readonly checks?: SkillUpdateChecks;
}

const fail = (code: SkillErrorCode, error: string): SkillFailure => ({ ok: false, code, error });
const DEFAULT_STEP = 'build';
const STEP = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

type Ready = { readonly vault: EngineVault; readonly kit: SkillKit };

/**
 * The skill routes' engine half (req-172, req-137, req-143): listing,
 * toggle, upload, delete of an own skill, and the prompt preview with its
 * token count. Every write is one commit of exactly its files; writes queue,
 * so two uploads or an upload and a toggle never interleave. The first call
 * per vault runs the one-time flat-file migration.
 */
export class SkillService implements SkillsPort {
  private readonly queue: SkillWriteQueue;
  private readonly migrated = new Map<string, Promise<unknown>>();

  constructor(private readonly deps: SkillServiceDeps) {
    this.queue = deps.queue ?? new SkillWriteQueue();
  }

  /** Startup: migrate the legacy flat skills of the detected vault. */
  async migrateAll(): Promise<void> {
    const ready = await this.ready();
    if (ready !== null) {
      await this.ensureMigrated(ready);
    }
  }

  sharedSkills(): Promise<SkillListReply> {
    return this.read(async (ready) => ({ ok: true, list: await this.listData(ready, null) }));
  }

  personaSkills(personaId: string): Promise<SkillListReply> {
    return this.withPersona(personaId, (ready, persona) => this.listFor(ready, persona));
  }

  personaSkillToggle(cmd: SkillToggleCommand): Promise<SkillListReply> {
    return this.serial(() =>
      this.withPersona(cmd.persona, async (ready, persona) => {
        if (!isSkillName(cmd.skill)) {
          return fail('bad_name', 'a skill is named like its folder');
        }
        const { records } = await ready.kit.reader.available(persona.id);
        if (cmd.on && !records.some((record) => record.name === cmd.skill)) {
          return fail('no_skill', `no skill named ${cmd.skill} is available to ${persona.id}`);
        }
        const rest = persona.skills.filter((name) => name !== cmd.skill);
        const selection = cmd.on ? [...rest, cmd.skill] : rest;
        const patched = await this.deps.board.personaPatch({ id: persona.id, skills: selection });
        return patched.ok ? this.listFor(ready, { ...persona, skills: selection }) : fail('internal', patched.error);
      }),
    );
  }

  personaSkillRemove(cmd: SkillRemoveCommand): Promise<SkillListReply> {
    return this.serial(() =>
      this.withPersona(cmd.persona, async (ready, persona) => {
        if (!isSkillName(cmd.name)) {
          return fail('bad_name', 'a skill is named like its folder');
        }
        const own = (await ready.kit.reader.home(ownSkillsDir(persona.id), 'own')).find((record) => record.name === cmd.name);
        if (own === undefined) {
          const shared = (await ready.kit.reader.home(SHARED_SKILLS_DIR, 'shared')).some((record) => record.name === cmd.name);
          return shared ? fail('not_own', `${cmd.name} is a shared skill — it is not deleted from one persona`) : fail('no_skill', `${persona.id} has no own skill named ${cmd.name}`);
        }
        const files = own.legacy ? [own.path] : (await ready.kit.fs.files(own.path)).map((file) => `${own.path}/${file}`);
        await ready.kit.fs.remove(own.path);
        await ready.kit.committer.commit(ready.vault, { changed: [], deleted: files }, `skills: ${persona.id} own skill ${cmd.name} removed`);
        return this.listFor(ready, persona);
      }),
    );
  }

  skillUpload(cmd: SkillUploadCommand): Promise<SkillUploadReply> {
    return this.serial(async () => {
      const ready = await this.ready();
      if (ready === null) {
        return fail('no_vault', 'no tickets vault detected');
      }
      await this.ensureMigrated(ready);
      if (cmd.scope !== 'shared' && cmd.scope !== 'own') {
        return fail('bad_scope', 'a skill goes to the shared pool or to a persona');
      }
      const persona = cmd.scope === 'own' ? await this.personaOf(ready, cmd.persona ?? '') : null;
      if (persona !== null && 'ok' in persona) {
        return persona;
      }
      const home = persona === null ? SHARED_SKILLS_DIR : ownSkillsDir(persona.id);
      const outcome = await ready.kit.uploader.upload(home, cmd);
      if (!outcome.ok) {
        return outcome;
      }
      await this.commitUpload(ready, persona, outcome);
      return { ok: true, name: outcome.name, origin: cmd.scope, files: outcome.changed.length, replaced: outcome.replaced, list: await this.listData(ready, persona) };
    });
  }

  personaPromptPreview(cmd: PromptPreviewCommand): Promise<PromptPreviewReply> {
    return this.withPersona(cmd.persona, async (ready, persona) => {
      const step = cmd.step ?? DEFAULT_STEP;
      if (!STEP.test(step)) {
        return fail('bad_name', 'a step is a pipeline phase id');
      }
      const data = await ready.kit.preview.build(persona, { step, model: cmd.model ?? null });
      data.warnings.forEach((line) => this.deps.host.log(`persona ${persona.id}: ${line}`, 'warn'));
      return { ok: true, persona: persona.id, step: data.step, text: data.text, tokens: data.tokens, tokenizer: data.tokenizer, parts: data.parts, skills: data.skills };
    });
  }

  // --- plumbing ----------------------------------------------------------

  private async commitUpload(ready: Ready, persona: Persona | null, outcome: { readonly name: string; readonly replaced: boolean; readonly changed: readonly string[]; readonly deleted: readonly string[] }): Promise<void> {
    const where = persona === null ? 'the shared pool' : persona.id;
    // req-289: an upload over a fetched skill makes it the owner's own upload: its source no longer lists it.
    const record = persona === null ? await ready.kit.sources.dropSkill(outcome.name) : null;
    const change = record === null ? outcome : { changed: [...outcome.changed, record], deleted: outcome.deleted };
    await ready.kit.committer.commit(ready.vault, change, `skills: ${outcome.name} ${outcome.replaced ? 'replaced' : 'added'} in ${where}`);
  }

  private async listData(ready: Ready, persona: Persona | null): Promise<SkillListData> {
    const provenance = await this.provenanceOf(ready);
    if (persona === null) {
      return ready.kit.lister.list(null, [], tokenizerFor('claude-code', null), provenance);
    }
    const entry = splitPoolEntry(persona.models.default);
    return ready.kit.lister.list(persona.id, persona.skills, tokenizerFor(entry.provider ?? persona.worker, entry.model), provenance);
  }

  /** req-289: the shared skills' sources and what the library's last look found for them. */
  private async provenanceOf(ready: Ready): Promise<SkillProvenance> {
    const byName = await ready.kit.sources.provenance();
    const checks = this.deps.checks;
    return (name) => {
      const record = byName.get(name);
      return record === undefined ? null : { source: sourceRefOf(record), updateAvailable: checks?.lookOf(record).updateAvailable ?? null };
    };
  }

  private async listFor(ready: Ready, persona: Persona): Promise<SkillListReply> {
    return { ok: true, list: await this.listData(ready, persona) };
  }

  /** A read route: the vault, the migration, then the body. */
  private async read<T extends { readonly ok: boolean }>(body: (ready: Ready) => Promise<T>): Promise<T | SkillFailure> {
    const ready = await this.ready();
    if (ready === null) {
      return fail('no_vault', 'no tickets vault detected');
    }
    await this.ensureMigrated(ready);
    return body(ready);
  }

  private withPersona<T extends { readonly ok: boolean }>(personaId: string, body: (ready: Ready, persona: Persona) => Promise<T>): Promise<T | SkillFailure> {
    return this.read(async (ready) => {
      const persona = await this.personaOf(ready, personaId);
      return 'ok' in persona ? persona : body(ready, persona);
    });
  }

  private async personaOf(ready: Ready, raw: string): Promise<Persona | SkillFailure> {
    let id: string;
    try {
      id = personaRef(raw);
    } catch {
      return fail('no_persona', `${raw} is not a persona id`);
    }
    const persona = await this.deps.board.loadPersona(ready.vault, id);
    return persona ?? fail('no_persona', `no persona named ${id}`);
  }

  private async ready(): Promise<Ready | null> {
    const vault = await this.deps.board.detect();
    if (vault === null) {
      return null;
    }
    const fs = this.deps.fsFor?.(vault) ?? new NodeSkillFileSystem(vault.path);
    return { vault, kit: buildSkillKit(fs, this.deps.host, this.deps.git) };
  }

  private ensureMigrated(ready: Ready): Promise<unknown> {
    let pass = this.migrated.get(ready.vault.id);
    if (pass === undefined) {
      pass = this.deps.board.listPersonaIds().then((ids) => ready.kit.migrator.run(ready.vault, ids)).catch((error: unknown) => {
        this.migrated.delete(ready.vault.id);
        this.deps.host.log(`skills migration failed: ${error instanceof Error ? error.message : String(error)}`, 'warn');
      });
      this.migrated.set(ready.vault.id, pass);
    }
    return pass;
  }

  private serial<T>(op: () => Promise<T>): Promise<T> {
    return this.queue.run(op);
  }
}
