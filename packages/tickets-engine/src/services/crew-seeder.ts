import { CREW_FILE } from '../contracts/crew-config';
import { seededPersonaText, seededPromptText, type ShippedPersona } from '../core/default-crew';
import { seededCrewOf, withSeededCrew } from '../core/crew-seed-marker';
import { crewOrderOf, withCrewOrder } from '../core/crew-order';
import { HUMAN_PERSONA_ID, PERSONAS_DIR, type PersonaModels } from '../core/persona';
import type { CrewWrite } from '../core/crew-file-write';
import type { TicketsGit } from '../core/tickets-git';
import type { ModelRow } from '../fleet/protocol-pool';
import type { CrewConfigFiles } from './crew-config-files';
import type { CrewSeedModels } from './crew-seed-models';
import type { EngineHost, EngineVault } from './host';
import type { PersonaFolderPort } from './persona-folders';
import type { ModelTablePort } from './service-model-table';
import type { ShippedCrew, ShippedCrewSource } from './shipped-crew-files';

/** The commit message of the one commit a seeding makes. */
export const CREW_SEED_COMMIT = 'personas: the default crew (req-256)';

/** What one seeding did. */
export type CrewSeedResult =
  | { readonly kind: 'seeded'; readonly ids: readonly string[] }
  /** The marker (or an existing folder) already covers the shipped crew. */
  | { readonly kind: 'nothing' }
  | { readonly kind: 'refused'; readonly reason: string };

export interface CrewSeederDeps {
  readonly source: ShippedCrewSource;
  readonly host: Pick<EngineHost, 'write' | 'announceChanges'>;
  readonly git: Pick<TicketsGit, 'locate' | 'commitPaths'>;
  readonly folders: PersonaFolderPort;
  /** The vault's crew settings: the default worker, and the file the marker lives in. */
  readonly crew: {
    effective(vault: EngineVault): Promise<{ readonly defaultWorker: string }>;
    readonly crewFiles: Pick<CrewConfigFiles, 'read' | 'put' | 'serial'>;
  };
  /** The machine's model table, read from `service.json` (no runner needed). */
  readonly table: ModelTablePort;
  readonly models: CrewSeedModels;
  readonly log: (message: string, level?: 'info' | 'warn') => void;
}

/** What one seeding works with: the vault, the shipped crew, the worker, the model table's rows. */
interface Seeding {
  readonly vault: EngineVault;
  readonly shipped: ShippedCrew;
  readonly worker: string;
  readonly rows: readonly ModelRow[] | null;
}

/**
 * Seeds the shipped default crew Pia, Paul, Ben, Ralf and Tessa into a board
 * (req-256, D7) — "Initialize board" after the pipeline and the prompts, and
 * once at the engine's start for a board that lacks them. **Idempotent by
 * id**: the `seeded-crew:` key of `_meta/crew.md` lists the ids already
 * offered, so a persona the owner later deletes stays deleted; an id whose
 * folder exists is never touched (only marked). The worker is the vault's
 * default worker, the models the worker's rows of the model table
 * ({@link CrewSeedModels}); the pipeline and the crew's default persona are
 * not changed. One commit of the persona files and `crew.md`.
 */
/**
 * req-258: a file without `order:` gets the default crew's, the human last (the
 * concept §9); an order the owner already set stays as it is — except that
 * Mission Control's persona, offered for the first time, goes to its front
 * (req-269, the concept §12: "Pia first").
 */
function withOrder(marked: CrewWrite, shipped: readonly ShippedPersona[], offered: readonly ShippedPersona[]): CrewWrite {
  if (!marked.ok) {
    return marked;
  }
  const order = crewOrderOf(marked.text);
  if (order.length === 0) {
    return withCrewOrder(marked.text, [...shipped.map((persona) => persona.id), HUMAN_PERSONA_ID]);
  }
  const front = offered.filter((persona) => persona.persona.kind === 'mission' && !order.includes(persona.id)).map((persona) => persona.id);
  return front.length === 0 ? marked : withCrewOrder(marked.text, [...front, ...order]);
}

export class CrewSeeder {
  constructor(private readonly deps: CrewSeederDeps) {}

  /** Never throws: a failure is logged and leaves the marker unset, so the next start tries again. */
  async seed(vault: EngineVault): Promise<CrewSeedResult> {
    try {
      const shipped = await this.deps.source.load();
      for (const problem of shipped.problems) {
        this.deps.log(`crew: ${problem}`, 'warn');
      }
      if (shipped.personas.length === 0) {
        return { kind: 'nothing' };
      }
      // `effective` runs the crew.md migration, which takes the file's queue: ask before entering it.
      const worker = (await this.deps.crew.effective(vault)).defaultWorker;
      const rows = await this.deps.table.rows().catch(() => null);
      return await this.deps.crew.crewFiles.serial(() => this.seedLocked({ vault, shipped, worker, rows }));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.deps.log(`crew: seeding the default crew failed — ${reason}`, 'warn');
      return { kind: 'refused', reason };
    }
  }

  private async seedLocked(run: Seeding): Promise<CrewSeedResult> {
    const { vault, shipped } = run;
    const files = this.deps.crew.crewFiles;
    const read = await files.read(vault);
    if (read.parse.error !== null) {
      this.deps.log(`crew: ${read.parse.error} — the default crew is seeded once it parses`, 'warn');
      return { kind: 'refused', reason: read.parse.error };
    }
    const marked = seededCrewOf(read.text);
    const offered = shipped.personas.filter((persona) => !marked.includes(persona.id));
    if (offered.length === 0) {
      return { kind: 'nothing' };
    }
    const missing: ShippedPersona[] = [];
    for (const persona of offered) {
      if (!(await this.deps.folders.has(vault, persona.id))) {
        missing.push(persona);
      }
    }
    const marker = withOrder(withSeededCrew(read.text, [...marked, ...offered.map((persona) => persona.id)]), shipped.personas, offered);
    if (!marker.ok) {
      this.deps.log(`crew: ${marker.error}`, 'warn');
      return { kind: 'refused', reason: marker.error };
    }
    const models = this.deps.models.pick(run.worker, run.rows);
    const written = await this.writePersonas(run, missing, models);
    await files.put(vault, marker.text);
    const paths = [...written, CREW_FILE];
    await this.commit(vault, paths);
    this.deps.host.announceChanges(vault.id, paths);
    this.report(run, { seeded: missing, models, kept: offered.length - missing.length });
    return missing.length === 0 ? { kind: 'nothing' } : { kind: 'seeded', ids: missing.map((persona) => persona.id) };
  }

  private async writePersonas(run: Seeding, personas: readonly ShippedPersona[], models: PersonaModels | null): Promise<string[]> {
    const { vault, worker } = run;
    const written: string[] = [];
    for (const persona of personas) {
      const prompt = seededPromptText(persona, run.shipped.steps);
      if (prompt.stepMissing) {
        this.deps.log(`crew: the package holds no step prompt for ${persona.id}'s role — it is seeded with its character alone`, 'warn');
      }
      const promptPath = `${PERSONAS_DIR}/${persona.id}/prompt.md`;
      const personaPath = `${PERSONAS_DIR}/${persona.id}/persona.md`;
      await this.deps.host.write(vault.id, promptPath, prompt.text);
      await this.deps.host.write(vault.id, personaPath, seededPersonaText(persona, worker, models));
      written.push(personaPath, promptPath);
    }
    return written;
  }

  /** One commit of exactly these paths; a vault outside git keeps the write unversioned (logged), a failed commit logs. */
  private async commit(vault: EngineVault, paths: readonly string[]): Promise<void> {
    const location = await this.deps.git.locate(vault.path);
    if (location === null) {
      this.deps.log('crew: the tickets vault is not a git repository — the default crew is not versioned', 'info');
      return;
    }
    try {
      await this.deps.git.commitPaths(location.root, paths.map((path) => `${location.prefix}${path}`), CREW_SEED_COMMIT);
    } catch (error) {
      this.deps.log(`crew: git commit failed: ${error instanceof Error ? error.message : String(error)}`, 'warn');
    }
  }

  private report(run: Seeding, done: { readonly seeded: readonly ShippedPersona[]; readonly models: PersonaModels | null; readonly kept: number }): void {
    const { seeded, models, kept } = done;
    const { worker, shipped } = run;
    const ids = seeded.map((persona) => persona.id).join(', ');
    const keptNote = kept > 0 ? `; ${kept} already had a folder and stayed as it is` : '';
    if (seeded.length === 0) {
      this.deps.log(`crew: the default crew is marked as offered${keptNote}`);
    } else if (models === null) {
      const fallback = shipped.personas.find((persona) => persona.persona.kind === 'agent')?.persona.models.default ?? '';
      this.deps.log(`crew: seeded the default crew (${ids}) with worker ${worker}; the model table names no model for it, so the persona default (${fallback}) stands${keptNote} — set it on the Persona page`);
    } else {
      this.deps.log(`crew: seeded the default crew (${ids}) with worker ${worker}, models ${models.default} (pool ${models.pool.join(', ')})${keptNote}`);
    }
  }
}
