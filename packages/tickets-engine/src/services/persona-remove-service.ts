import type { PersonaRemoveCommand, PersonaRemoveFailure, PersonaRemovePort, PersonaRemoveReply } from '../contracts/persona-remove';
import { personaRef, PERSONAS_DIR, type Persona } from '../core/persona';
import { hasLiveSession, removalRefusal, type RemovalRun } from '../core/persona-removal';
import type { TicketsGit } from '../core/tickets-git';
import type { EngineHost, EngineVault } from './host';
import type { PersonaPinPort } from './persona-pin-reader';
import { SkillCommitter } from './skill-committer';
import { NodeSkillFileSystem, type SkillFileSystem } from './skill-file-system';

/** The board as the removal needs it: the vault and the persona. */
export interface PersonaRemoveBoard {
  detect(): Promise<EngineVault | null>;
  loadPersona(vault: EngineVault, id: string): Promise<Persona | null>;
}

export interface PersonaRemoveDeps {
  readonly board: PersonaRemoveBoard;
  /** The runner's run records (every kind of session); a runner that does not answer has none. */
  readonly fleet: { runs(): Promise<readonly RemovalRun[]> };
  readonly pins: PersonaPinPort;
  readonly host: Pick<EngineHost, 'announceChanges' | 'log'>;
  readonly git: Pick<TicketsGit, 'locate' | 'commitTree'>;
  /** The disk of a vault; default the vault folder itself. */
  readonly fsFor?: (vault: EngineVault) => SkillFileSystem;
}

const fail = (code: PersonaRemoveFailure['code'], error: string): PersonaRemoveFailure => ({ ok: false, code, error });

/**
 * Deletes a persona (req-261): `tickets/_meta/personas/<id>/` whole, in one
 * commit `personas: <id> removed`, after the engine itself has checked what
 * the client may only have shown — the typed title, the human persona, a
 * live or held session, a pin ({@link removalRefusal}). The ticket history
 * and the 1:1 chat files under `_meta/chat/` are not in the folder and
 * stay. A removed seeded persona stays removed: the `seeded-crew:` marker in
 * `crew.md` was written when it was first offered. Removals queue.
 */
export class PersonaRemoveService implements PersonaRemovePort {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: PersonaRemoveDeps) {}

  personaRemove(cmd: PersonaRemoveCommand): Promise<PersonaRemoveReply> {
    const next = this.tail.catch(() => undefined).then(() => this.remove(cmd));
    this.tail = next;
    return next;
  }

  private async remove(cmd: PersonaRemoveCommand): Promise<PersonaRemoveReply> {
    let id: string;
    try {
      id = personaRef(cmd.persona);
    } catch {
      return fail('no_persona', `${cmd.persona} is not a persona id`);
    }
    const vault = await this.deps.board.detect();
    if (vault === null) {
      return fail('no_vault', 'no tickets vault detected');
    }
    const persona = await this.deps.board.loadPersona(vault, id);
    if (persona === null) {
      return fail('no_persona', `no persona named ${id}`);
    }
    const runs = await this.deps.fleet.runs().catch(() => [] as readonly RemovalRun[]);
    const refusal = removalRefusal({ persona, confirm: cmd.confirm, live: hasLiveSession(runs, id), pins: await this.deps.pins.pinsOf(vault, id) });
    if (refusal !== null) {
      return refusal;
    }
    return this.delete(vault, id);
  }

  private async delete(vault: EngineVault, id: string): Promise<PersonaRemoveReply> {
    const fs = this.deps.fsFor?.(vault) ?? new NodeSkillFileSystem(vault.path);
    const folder = `${PERSONAS_DIR}/${id}`;
    try {
      const files = (await fs.files(folder)).map((file) => `${folder}/${file}`);
      await fs.remove(folder);
      const warning = await new SkillCommitter(this.deps.host, this.deps.git).commit(vault, { changed: [], deleted: files }, `personas: ${id} removed`);
      return { ok: true, persona: id, files: files.length, ...(warning === null ? {} : { warning }) };
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      this.deps.host.log(`persona ${id} removal failed: ${text}`, 'warn');
      return fail('internal', `the removal failed: ${text}`);
    }
  }
}
