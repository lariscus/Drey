/**
 * The wiring of the slots (req-177, ADR-0096's `fleet/routing`): the
 * composition root's helper, as `compose-supervisor` is for the runs. It
 * resolves the machine's paths (the service home's `service.json`,
 * opencode's `auth.json`, Kimi's home, the user's home for Claude's default
 * login) and hands every part its collaborators; `routing/` itself never
 * touches Node.
 */
import * as path from 'node:path';
import type { SlotListCheck } from './api/slot-routes';
import { FetchQuotaHttp } from './fetch-quota-http';
import type { Clock } from './ports/clock';
import type { FileSystem } from './ports/file-system';
import type { SlotView } from './protocol';
import { ClaudeCodeQuotaSource } from './routing/claude-code-quota-source';
import { CountingQuotaSource } from './routing/counting-quota-source';
import { FallbackQuotaSource } from './routing/fallback-quota-source';
import { KimiQuotaSource } from './routing/kimi-quota-source';
import { QuotaRefreshLoop, type Schedule } from './routing/quota-refresh-loop';
import type { QuotaHttp, QuotaSource } from './routing/quota-source';
import { ServiceConfigFile } from './routing/service-config-file';
import type { Slot } from './routing/slot';
import { parseServiceSlots, type SlotConfigParse } from './routing/slot-config';
import { SlotGate } from './routing/slot-gate';
import { SlotRegistry } from './routing/slot-registry';
import { SlotReservations } from './routing/slot-reservations';
import { SlotRunListener } from './routing/slot-run-listener';
import { SlotStateResolver } from './routing/slot-state-resolver';
import { SurplusCalculator } from './routing/surplus-calculator';
import { ZaiQuotaSource } from './routing/zai-quota-source';

export interface RoutingDeps {
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
  readonly http?: QuotaHttp;
  readonly schedule?: Schedule;
}

export interface Routing {
  readonly registry: SlotRegistry;
  readonly gate: SlotGate;
  readonly listener: SlotRunListener;
  readonly config: ServiceConfigFile;
  readonly check: SlotListCheck;
  /** Creates `service.json` when absent, loads the slots, reads the quotas, starts the schedule. */
  start(): Promise<void>;
  stop(): void;
}

const nodeSchedule: Schedule = (fn, ms) => {
  const timer = setTimeout(fn, ms);
  timer.unref();
  return { cancel: () => clearTimeout(timer) };
};

function opencodeAuthFile(deps: RoutingDeps): string {
  const data = deps.env['XDG_DATA_HOME'];
  return path.join(data !== undefined && data !== '' ? data : path.join(deps.userHome, '.local', 'share'), 'opencode', 'auth.json');
}

function kimiHomeOf(deps: RoutingDeps): string {
  const home = deps.env['KIMI_HOME'];
  return home !== undefined && home !== '' ? home : path.join(deps.userHome, '.kimi-code');
}

/** One source per slot: its provider's readout, with the runner's counting behind it. */
function sourcesOf(deps: RoutingDeps, claude: ClaudeCodeQuotaSource, counting: CountingQuotaSource): (slot: Slot) => QuotaSource {
  const http = deps.http ?? new FetchQuotaHttp();
  const zai = new FallbackQuotaSource(new ZaiQuotaSource({ http, fs: deps.fs, authFile: opencodeAuthFile(deps), clock: deps.clock }), counting);
  const kimi = new FallbackQuotaSource(new KimiQuotaSource({ http, fs: deps.fs, home: kimiHomeOf(deps), clock: deps.clock }), counting);
  const claudeCode = new FallbackQuotaSource(claude, counting);
  const byKind: Readonly<Record<Slot['quota'], QuotaSource>> = { zai, kimi, 'claude-code': claudeCode, counting };
  return (slot) => byKind[slot.quota];
}

export function composeRouting(deps: RoutingDeps): Routing {
  const config = new ServiceConfigFile(deps.fs, path.join(deps.home, 'service.json'));
  const claude = new ClaudeCodeQuotaSource(deps.fs, deps.userHome);
  const counting = new CountingQuotaSource(deps.clock);
  const reservations = new SlotReservations();
  const load = async (): Promise<SlotConfigParse> => {
    const { root, error } = await config.read();
    const parsed = parseServiceSlots(root);
    return error === null ? parsed : { ...parsed, errors: [error, ...parsed.errors] };
  };
  const registry = new SlotRegistry({
    config: { load },
    sourceOf: sourcesOf(deps, claude, counting),
    reservations,
    resolver: new SlotStateResolver(new SurplusCalculator()),
    clock: deps.clock,
    onChange: deps.publish,
    log: deps.log,
  });
  const loop = new QuotaRefreshLoop(registry, deps.schedule ?? nodeSchedule, deps.log);
  return {
    registry,
    gate: new SlotGate(registry, reservations),
    listener: new SlotRunListener({ registry, reservations, claude, counting }),
    config,
    check: (slots) => parseServiceSlots({ slots }).errors,
    start: async () => {
      await config.ensure().catch((error: unknown) => deps.log(`service.json could not be created: ${error instanceof Error ? error.message : String(error)}`));
      await loop.tick();
      loop.start();
    },
    stop: () => loop.stop(),
  };
}
