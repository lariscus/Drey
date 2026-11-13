/**
 * The wiring of model discovery (req-286): the composition root's helper
 * beside `compose-routing`. It builds one probe per harness — Claude Code
 * over its stream-json `initialize`, opencode, Kimi CLI and Copilot CLI
 * over ACP — the locator that tells *not installed* without spawning, the
 * last check's file in the service home (`discovery.json`) and the
 * discovery itself over the pool's settings and the slots.
 */
import type { ModelsDevImport } from './routing/models-dev-import';
import { ACP_PROBE_TARGETS, AcpProbe } from './harness/probe-acp';
import { BinaryLocator } from './harness/probe-binary';
import { ClaudeCodeProbe } from './harness/probe-claude-code';
import type { Clock } from './ports/clock';
import type { FileSystem } from './ports/file-system';
import type { SpawnFn } from './ports/process-spawner';
import { ModelDiscovery, type DiscoveryFile, type HarnessProbe, type SavedDiscovery } from './routing/model-discovery';
import type { PoolSettingsRegistry } from './routing/pool-settings';
import type { Slot } from './routing/slot';

export interface DiscoveryDeps {
  readonly home: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly fs: FileSystem;
  readonly clock: Clock;
  readonly log: (message: string) => void;
  readonly settings: PoolSettingsRegistry;
  readonly slots: () => readonly Slot[];
  readonly registry: ModelsDevImport;
  /** The probes; the four harnesses over the real processes by default (a spec passes fakes). */
  readonly probes?: readonly HarnessProbe[];
  readonly spawnFn: SpawnFn;
  readonly windows: boolean;
}

/** The four harness probes: Claude Code first, then the ACP harnesses — the order of board 7l v3's Harnesses rows. */
export function harnessProbes(deps: Pick<DiscoveryDeps, 'home' | 'env' | 'fs' | 'spawnFn' | 'windows'>): HarnessProbe[] {
  const locator = new BinaryLocator(deps.fs, deps.env, deps.windows);
  const cwd = deps.fs.join(deps.home, 'discovery');
  const probes: HarnessProbe[] = [new ClaudeCodeProbe(deps.spawnFn, locator, cwd), ...ACP_PROBE_TARGETS.map((target) => new AcpProbe(target, deps.spawnFn, locator, { cwd }))];
  // The probes' sessions start in the service home's own folder, made before the first spawn.
  return probes.map((p) => ({ provider: p.provider, label: p.label, probe: async () => (await deps.fs.mkdirp(cwd), p.probe()) }));
}

function discoveryFileOf(fs: FileSystem, home: string): DiscoveryFile {
  const file = fs.join(home, 'discovery.json');
  return {
    read: async () => {
      const text = await fs.readTextOrNull(file);
      return text === null ? null : (JSON.parse(text) as SavedDiscovery);
    },
    write: (saved) => fs.writeAtomic(file, `${JSON.stringify(saved, null, 2)}\n`),
  };
}

export function composeDiscovery(deps: DiscoveryDeps): ModelDiscovery {
  return new ModelDiscovery({
    probes: deps.probes ?? harnessProbes(deps),
    file: discoveryFileOf(deps.fs, deps.home),
    settings: deps.settings,
    slots: deps.slots,
    ignored: () => deps.settings.ignored(),
    registry: deps.registry,
    clock: deps.clock,
    log: deps.log,
  });
}
