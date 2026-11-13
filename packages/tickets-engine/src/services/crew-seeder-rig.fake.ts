import { promises as fsp } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ModelRow } from '../fleet/protocol-pool';
import { CrewConfigFiles } from './crew-config-files';
import { CrewSeeder } from './crew-seeder';
import { CrewSeedModels } from './crew-seed-models';
import type { EngineHost, EngineVault } from './host';
import { PersonaAvatars } from './persona-avatars';
import { PersonaFolders } from './persona-folders';
import { ShippedCrewFiles } from './shipped-crew-files';

/** One row of a model table, the way `service.json` would parse it. */
export function modelRow(model: string, provider: ModelRow['provider'], cls: ModelRow['class']): ModelRow {
  return { model, slot: null, provider, category: 'everyday', class: cls, cost: 1, enabled: true };
}

export interface CrewSeederRigOptions {
  /** The crew.md default worker. */
  readonly worker?: string;
  /** The model table's rows; null = no table. */
  readonly rows?: readonly ModelRow[] | null;
  /** The git port: absent = a recording fake that "commits" nothing. */
  readonly git?: ConstructorParameters<typeof CrewSeeder>[0]['git'];
}

/** A seeder over a temp folder standing in for the tickets vault, with the real shipped crew. */
export class CrewSeederRig {
  readonly logs: string[] = [];
  readonly announced: string[][] = [];
  readonly commits: { readonly paths: readonly string[]; readonly message: string }[] = [];
  readonly seeder: CrewSeeder;
  readonly vault: EngineVault;

  private constructor(readonly root: string, options: CrewSeederRigOptions) {
    this.vault = { id: 'v', name: 'tickets', path: root, exists: true, active: true };
    const host = {
      read: (_vault: string, rel: string) => fsp.readFile(path.join(root, rel), 'utf8'),
      write: (_vault: string, rel: string, text: string) => this.write(rel, text),
      announceChanges: (_vault: string, paths: string[]) => void this.announced.push(paths),
      log: (message: string) => void this.logs.push(message),
      resolveAssetPath: (_vault: string, rel: string) => path.join(root, rel),
    } as unknown as EngineHost;
    const git = options.git ?? {
      locate: async () => ({ root: '/repo', prefix: '' }),
      commitPaths: async (_root: string, paths: readonly string[], message: string) => void this.commits.push({ paths, message }),
    };
    this.seeder = new CrewSeeder({
      source: new ShippedCrewFiles(),
      host,
      git,
      folders: new PersonaFolders(host),
      avatars: new PersonaAvatars(host),
      crew: { effective: async () => ({ defaultWorker: options.worker ?? 'opencode' }), crewFiles: new CrewConfigFiles(host, git) },
      table: { rows: async () => options.rows ?? null },
      models: new CrewSeedModels(),
      log: (message) => void this.logs.push(message),
    });
  }

  static async create(options: CrewSeederRigOptions = {}): Promise<CrewSeederRig> {
    return new CrewSeederRig(await fsp.mkdtemp(path.join(os.tmpdir(), 'drey-crew-seed-')), options);
  }

  /** The same rig over an existing folder (a vault inside a real repository); `dispose` removes it. */
  static createAt(root: string, options: CrewSeederRigOptions = {}): CrewSeederRig {
    return new CrewSeederRig(root, options);
  }

  async write(rel: string, text: string): Promise<void> {
    await fsp.mkdir(path.dirname(path.join(this.root, rel)), { recursive: true });
    await fsp.writeFile(path.join(this.root, rel), text, 'utf8');
  }

  read(rel: string): Promise<string | null> {
    return fsp.readFile(path.join(this.root, rel), 'utf8').catch(() => null);
  }

  async exists(rel: string): Promise<boolean> {
    return (await fsp.stat(path.join(this.root, rel)).catch(() => null)) !== null;
  }

  /** A folder with everything in it, as the owner's deletion leaves the vault (req-261). */
  removeFolder(rel: string): Promise<void> {
    return fsp.rm(path.join(this.root, rel), { recursive: true, force: true });
  }

  dispose(): Promise<void> {
    return fsp.rm(this.root, { recursive: true, force: true });
  }
}
