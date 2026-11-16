/**
 * The wiring of the slots (req-177, ADR-0096's `fleet/routing`): the
 * composition root's helper, as `compose-supervisor` is for the runs. It
 * resolves the machine's paths (the service home's `service.json`,
 * opencode's `auth.json`, Kimi's home, the user's home for Claude's default
 * login) and hands every part its collaborators; `routing/` itself never
 * touches Node.
 */
import * as path from 'node:path';
import type { PoolDesk } from '../api/model-routes';
import type { SlotListCheck } from '../api/slot-routes';
import { FetchQuotaHttp } from '../routing/fetch-quota-http';
import type { Clock } from '../ports/clock';
import type { FileSystem } from '../ports/file-system';
import { composeDiscovery } from './compose-discovery';
import { composePool, poolDeskOf, type Pool } from './compose-pool';
import { nodeSpawnFn } from '../runner/procs';
import { ClassMigration } from '../routing/class-migration';
import type { HarnessProbe } from '../routing/model-discovery';
import { ModelsDevImport } from '../routing/models-dev-import';
import type { PoolLoad, SlotView } from '../protocol';
import { ClaudeCodeQuotaSource } from '../routing/claude-code-quota-source';
import { CountingQuotaSource } from '../routing/counting-quota-source';
import { FallbackQuotaSource } from '../routing/fallback-quota-source';
import { KimiQuotaSource } from '../routing/kimi-quota-source';
import { QuotaRefreshLoop, type Schedule } from '../routing/quota-refresh-loop';
import type { QuotaHttp, QuotaSource } from '../routing/quota-source';
import { OpencodeAuthAccounts } from '../routing/opencode-auth-accounts';
import { ServiceConfigFile } from '../routing/service-config-file';
import { opencodeAuthFileOf } from './opencode-auth-file';
import type { Slot } from '../routing/slot';
import { parseServiceSlots, type SlotConfigParse } from '../routing/slot-config';
import type { BurnRateDayFile } from '../routing/burn-rate-day';
import { CapacityCap } from '../routing/capacity-cap';
import { PoolGate } from '../routing/pool-gate';
import type { ProviderThrottle } from '../routing/pool-grant';
import { PoolSettingsRegistry } from '../routing/pool-settings';
import { SlotRegistry } from '../routing/slot-registry';
import { SlotReservations } from '../routing/slot-reservations';
import { SlotRunListener } from '../routing/slot-run-listener';
import { SlotStateResolver } from '../routing/slot-state-resolver';
import { SurplusCalculator } from '../routing/surplus-calculator';
import { ZaiQuotaSource } from '../routing/zai-quota-source';

export interface RoutingDeps {
  /** req-286: the harness probes; the four real ones over `nodeSpawnFn` by default (a spec passes fakes). */
  readonly probes?: readonly HarnessProbe[];
  /** The service home (`~/.drey-engine`): `service.json` lives there. */
  readonly home: string;
  /** The user's home: Claude's default login, opencode's and Kimi's default folders. */
  readonly userHome: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly fs: FileSystem;
  readonly clock: Clock;
  readonly log: (message: string) => void;
  /** A slot's view changed: the runner's `slot` event. */
  readonly publish: (view: SlotView) => void;
  /** req-170: the pool's live load changed: the runner's `pool` event. */
  readonly publishPool?: (load: PoolLoad) => void;
  /** req-170: a provider's pause and ceiling (req-63's rule); absent = none. */
  readonly throttle?: ProviderThrottle;
  readonly http?: QuotaHttp;
  readonly schedule?: Schedule;
  /** req-181: the burn rate's resume time in the runner log; the machine's local `HH:MM` by default. */
  readonly timeText?: (iso: string) => string;
}

export interface Routing {
  readonly registry: SlotRegistry;
  readonly gate: PoolGate;
  readonly listener: SlotRunListener;
  readonly config: ServiceConfigFile;
  readonly check: SlotListCheck;
  readonly pool: Pool;
  /** req-170: the pool's settings as the `/models` routes read and write them. */
  readonly poolDesk: PoolDesk;
  /** Creates `service.json` when absent, loads the slots, reads the quotas, starts the schedule. */
  start(): Promise<void>;
  stop(): void;
}

export type { Pool } from './compose-pool';

const nodeSchedule: Schedule = (fn, ms) => {
  const timer = setTimeout(fn, ms);
  timer.unref();
  return { cancel: () => clearTimeout(timer) };
};

/** `00:00`: an instant in the machine's local time, as the runner log writes the burn rate's resume time. */
export function localTimeText(iso: string): string {
  const at = new Date(iso);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/** req-181: the burn rate's day book as a JSON file in the service home. */
function burnRateFileOf(fs: FileSystem, file: string): BurnRateDayFile {
  return {
    read: async () => {
      const text = await fs.readTextOrNull(file);
      return text === null ? null : (JSON.parse(text) as unknown);
    },
    write: async (value) => fs.writeAtomic(file, `${JSON.stringify(value, null, 2)}\n`),
  };
}

function kimiHomeOf(deps: RoutingDeps): string {
  const home = deps.env['KIMI_HOME'];
  return home !== undefined && home !== '' ? home : path.join(deps.userHome, '.kimi-code');
}

/** One source per slot: its provider's readout, with the runner's counting behind it. */
function sourcesOf(deps: RoutingDeps, http: QuotaHttp, claude: ClaudeCodeQuotaSource, counting: CountingQuotaSource): (slot: Slot) => QuotaSource {
  const zai = new FallbackQuotaSource(new ZaiQuotaSource({ http, fs: deps.fs, authFile: opencodeAuthFileOf(deps.env, deps.userHome), clock: deps.clock }), counting);
  const kimi = new FallbackQuotaSource(new KimiQuotaSource({ http, fs: deps.fs, home: kimiHomeOf(deps), clock: deps.clock }), counting);
  const claudeCode = new FallbackQuotaSource(claude, counting);
  const byKind: Readonly<Record<Slot['quota'], QuotaSource>> = { zai, kimi, 'claude-code': claudeCode, counting };
  return (slot) => byKind[slot.quota];
}

/** Publishes the pool's load when it changed. */
function loadAnnouncer(pool: () => PoolLoad, publish: ((load: PoolLoad) => void) | undefined): () => void {
  let last = '';
  return () => {
    const load = pool();
    const json = JSON.stringify(load);
    if (publish !== undefined && json !== last) {
      last = json;
      publish(load);
    }
  };
}

/** req-286: the registry import and the discovery over the harness probes (the real four unless a spec passes its own). */
function discoveryOf(deps: RoutingDeps, settings: PoolSettingsRegistry, slots: () => readonly Slot[], http: QuotaHttp): { importer: ModelsDevImport; discovery: ReturnType<typeof composeDiscovery> } {
  // DREY_MODELS_REGISTRY_URL: another registry file (an e2e points it at a closed port: no network call).
  const url = deps.env['DREY_MODELS_REGISTRY_URL'];
  const importer = url !== undefined && url !== '' ? new ModelsDevImport(http, url) : new ModelsDevImport(http);
  const probes = deps.probes !== undefined ? { probes: deps.probes } : {};
  const discovery = composeDiscovery({ home: deps.home, env: deps.env, fs: deps.fs, clock: deps.clock, log: deps.log, settings, slots, registry: importer, spawnFn: nodeSpawnFn(), windows: process.platform === 'win32', ...probes });
  return { importer, discovery };
}

export function composeRouting(deps: RoutingDeps): Routing {
  const config = new ServiceConfigFile(deps.fs, path.join(deps.home, 'service.json'), new OpencodeAuthAccounts(deps.fs, opencodeAuthFileOf(deps.env, deps.userHome)));
  const classMigration = new ClassMigration(config, deps.log);
  const claude = new ClaudeCodeQuotaSource(deps.fs, deps.userHome);
  const counting = new CountingQuotaSource(deps.clock);
  const reservations = new SlotReservations();
  const http = deps.http ?? new FetchQuotaHttp();
  const settings = new PoolSettingsRegistry(deps.log);
  const cap = new CapacityCap(settings, reservations);
  // The announcer reads the registry only once the registry exists (its first change).
  const announce = loadAnnouncer(() => cap.load(registry.views()), deps.publishPool);
  const load = async (): Promise<SlotConfigParse> => {
    const { root, error } = await config.read();
    const parsed = parseServiceSlots(root);
    settings.apply(root, parsed.slots, error);
    return error === null ? parsed : { ...parsed, errors: [error, ...parsed.errors] };
  };
  const registry: SlotRegistry = new SlotRegistry({
    config: { load },
    sourceOf: sourcesOf(deps, http, claude, counting),
    reservations,
    resolver: new SlotStateResolver(new SurplusCalculator()),
    clock: deps.clock,
    onChange: (view) => {
      deps.publish(view);
      announce();
      pool.burnMeter.observe(view); // req-181: the day's first weekly reading is its start
    },
    log: deps.log,
  });
  const pool: Pool = composePool({
    clock: deps.clock,
    log: deps.log,
    ...(deps.throttle !== undefined ? { throttle: deps.throttle } : {}),
    ...{ registry, settings, cap, reservations, config },
    burnRateFile: burnRateFileOf(deps.fs, path.join(deps.home, 'burn-rate.json')),
    timeText: deps.timeText ?? localTimeText,
  });
  const loop = new QuotaRefreshLoop(registry, deps.schedule ?? nodeSchedule, deps.log);
  const { importer, discovery } = discoveryOf(deps, settings, () => registry.list(), http);
  return {
    registry,
    gate: new PoolGate(registry, reservations, pool.grant, pool.shares),
    listener: new SlotRunListener({ registry, reservations, claude, counting }),
    config,
    check: (slots) => parseServiceSlots({ slots }).errors,
    pool,
    poolDesk: poolDeskOf(pool, registry, importer, discovery),
    start: async () => {
      await config.ensure().catch((error: unknown) => deps.log(`service.json could not be created: ${error instanceof Error ? error.message : String(error)}`));
      await classMigration.run();
      await discovery.load();
      await pool.burnBook.load();
      await loop.tick();
      announce();
      loop.start();
    },
    stop: () => loop.stop(),
  };
}
