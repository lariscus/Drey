import { splitFrontmatter } from '../../../../shared/frontmatter';
import { PROJECTS_DIR } from '../contracts/projects';
import { parseRegisteredVaults, VAULTS_KEY } from '../contracts/vaults';
import { parsePersonaFile, personaFileText, PERSONAS_DIR, type Persona } from '../core/persona/persona';
import { planProjectMigration, type ProjectMigrationPlan } from '../core/projects/project-migration';
import { projectFileText } from '../core/projects/project-record';
import { parseRepos } from '../core/projects/repos-file';
import { TicketsGit } from '../core/git/tickets-git';
import type { EngineHost, EngineVault } from './host';

const REPOS_PATH = 'tickets/_meta/repos.md';

export interface ProjectMigratorDeps {
  readonly board: { detect(): Promise<EngineVault | null>; listPersonaIds(): Promise<readonly string[]> };
  readonly host: Pick<EngineHost, 'read' | 'write' | 'listMarkdownFiles' | 'configGet' | 'announceChanges'>;
  readonly git?: TicketsGit;
  readonly log: (message: string, level?: 'info' | 'warn' | 'error') => void;
}

/** What one start's migration did; null = nothing to do (projects exist, no board, or `repos.md` broken). */
export interface ProjectMigrationResult {
  readonly plan: ProjectMigrationPlan;
  readonly touched: readonly string[];
}

/** One persona file as read: the record and the prose below its fence (kept on rewrite). */
interface PersonaFile {
  readonly persona: Persona;
  readonly body: string;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * req-282 at the engine's start: a board whose `_meta/projects/` holds no
 * record gets its first project (`planProjectMigration`), the personas that
 * named `write-vaults` get `allowed: write-notes: true`, and everything lands
 * in one logged commit. Idempotent — a board with a project file is left
 * alone, so every start can run it. req-283: once a project exists, the
 * retired `write-vaults` leaves every persona file that still carries it, in
 * a commit of its own — the vault rights are the project's now.
 */
export class ProjectMigrator {
  private readonly git: TicketsGit;

  constructor(private readonly deps: ProjectMigratorDeps) {
    this.git = deps.git ?? new TicketsGit(() => 'git');
  }

  async migrate(): Promise<ProjectMigrationResult | null> {
    const vault = await this.deps.board.detect();
    if (vault === null) {
      return null;
    }
    const files = await this.deps.host.listMarkdownFiles(vault.id);
    const hasProject = files.some((p) => p.startsWith(`${PROJECTS_DIR}/`));
    const result = hasProject ? null : await this.firstProject(vault);
    if (hasProject || result !== null) {
      await this.dropWriteVaults(vault);
    }
    return result;
  }

  /** req-283: `write-vaults` out of every persona file that still names it — only once a project carries the rights. */
  private async dropWriteVaults(vault: EngineVault): Promise<void> {
    const stale = (await this.personaFiles(vault)).filter((f) => (f.persona.allowed.writeVaults ?? []).length > 0);
    if (stale.length === 0) {
      return;
    }
    const touched: string[] = [];
    for (const file of stale) {
      const path = `${PERSONAS_DIR}/${file.persona.id}/persona.md`;
      await this.deps.host.write(vault.id, path, personaFileText(file.persona, file.body));
      touched.push(path);
    }
    await this.commit(vault, touched, 'personas: drop write-vaults — the vault rights are the project\'s (req-283)');
    this.deps.host.announceChanges(vault.id, touched);
    this.deps.log(`projects: dropped write-vaults from ${stale.map((f) => f.persona.id).join(', ')} — the project grants the vaults, write-notes the persona's half`);
  }

  /** req-282: the board's first project; null when `repos.md` does not parse (the next start tries again). */
  private async firstProject(vault: EngineVault): Promise<ProjectMigrationResult | null> {
    const repos = parseRepos(await this.read(vault, REPOS_PATH));
    if (repos.error !== null) {
      this.deps.log(`projects: the first project waits for a readable repos.md — ${repos.error}`, 'warn');
      return null;
    }
    const personas = await this.personaFiles(vault);
    const plan = planProjectMigration({
      repos: repos.repos.map((r) => r.name),
      vaults: parseRegisteredVaults(await this.deps.host.configGet<unknown>(VAULTS_KEY).catch(() => undefined)),
      personas: personas.map((f) => ({ id: f.persona.id, writeVaults: f.persona.allowed.writeVaults ?? [] })),
      fallbackName: vault.name,
    });
    const touched = await this.write(vault, plan, personas);
    await this.commit(vault, touched, `projects: the first project "${plan.project.name}" from repos.md and the registered vaults (req-282)`);
    this.deps.host.announceChanges(vault.id, touched);
    this.report(plan);
    return { plan, touched };
  }

  /** The project file, then the personas that gain `write-notes`; the vault-relative paths written. */
  private async write(vault: EngineVault, plan: ProjectMigrationPlan, personas: readonly PersonaFile[]): Promise<string[]> {
    const projectPath = `${PROJECTS_DIR}/${plan.project.id}.md`;
    await this.deps.host.write(vault.id, projectPath, projectFileText(plan.project));
    const touched = [projectPath];
    for (const file of personas.filter((f) => plan.writeNotes.includes(f.persona.id) && f.persona.allowed.writeNotes !== true)) {
      const persona: Persona = { ...file.persona, allowed: { ...file.persona.allowed, writeNotes: true } };
      const path = `${PERSONAS_DIR}/${persona.id}/persona.md`;
      await this.deps.host.write(vault.id, path, personaFileText(persona, file.body));
      touched.push(path);
    }
    return touched;
  }

  private report(plan: ProjectMigrationPlan): void {
    const { project } = plan;
    const vaults = Object.keys(project.vaults).length;
    this.deps.log(`projects: wrote the first project "${project.name}" — ${project.repos.length} repositories, ${vaults} vaults; write-notes for ${plan.writeNotes.length} personas`);
    for (const miss of plan.unresolved) {
      this.deps.log(`projects: persona ${miss.persona} names vault id ${miss.vaultId} in write-vaults, which this device has not registered — not carried into project "${project.name}"`, 'warn');
    }
  }

  /** Every readable persona file; an unreadable one is skipped (the persona keeps what it has). */
  private async personaFiles(vault: EngineVault): Promise<PersonaFile[]> {
    const out: PersonaFile[] = [];
    for (const id of await this.deps.board.listPersonaIds()) {
      const text = await this.read(vault, `${PERSONAS_DIR}/${id}/persona.md`);
      if (text === null) {
        continue;
      }
      try {
        out.push({ persona: parsePersonaFile(id, text), body: splitFrontmatter(text).body });
      } catch (error) {
        this.deps.log(`projects: persona ${id} is not readable — ${messageOf(error)}`, 'warn');
      }
    }
    return out;
  }

  private read(vault: EngineVault, path: string): Promise<string | null> {
    return this.deps.host.read(vault.id, path).catch(() => null);
  }

  /** One commit of exactly these paths; a failure logs, never throws. */
  private async commit(vault: EngineVault, vaultRelPaths: readonly string[], message: string): Promise<void> {
    const location = await this.git.locate(vault.path).catch(() => null);
    if (location === null) {
      return;
    }
    const paths = vaultRelPaths.map((p) => `${location.prefix}${p}`);
    try {
      await this.git.commitTree(location.root, paths, message);
    } catch (error) {
      await this.git.commitPaths(location.root, paths, message).catch(() => this.deps.log(`projects: git commit failed — ${messageOf(error)}`, 'warn'));
    }
  }
}
