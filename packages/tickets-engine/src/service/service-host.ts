/**
 * Drey Service's host (req-164, ADR-0092): one process, four components,
 * one lifecycle.
 *
 * - **engine** — `createEngine`, the board service, chat, verify and the
 *   invoke channel; always on while the service runs.
 * - **runner** — the Crew runner, in-process ({@link RunnerComponent});
 *   sleeps on req-110's verdict and wakes on demand.
 * - **gateway** — the remote gateway inside the engine (ADR-0086); its row
 *   follows the remote settings.
 * - **mcp** — the vault MCP the workers use (req-167, {@link VaultMcpComponent});
 *   Drey's own MCP server for other programs stays in the Drey process.
 *
 * The host wires the parts and runs the tick: the control port
 * ({@link ControlServer} and its route groups), the log ({@link ServiceLog}
 * over per-component daily files), `service.lock`, Settings → Background
 * service applied live ({@link ServiceSettingsReader}), whether the service
 * stays ({@link ServiceStay}) and the tray icon's window process
 * ({@link WindowProcesses}, req-165).
 *
 * **Optional (the owner's ruling on Q3, 2026-11-08).** `service.enabled`
 * (default off) decides the mode: **background** (outlives Drey, sleeps on
 * the two-level verdict) or **with Drey** (follows Drey out).
 */
import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import { SERVICE_PREF_DEFAULTS, type ServicePrefs } from '../../../../shared/service-settings';
import { staySpans, type ServiceHostOptions } from './service-host-options';
import { PERSONA_RUN_METHODS, type ClosingRoundWritten } from '../contracts/persona-run-records';
import { createEngine, type Engine } from '../server/engine';
import { FileConfigStore } from '../server/file-config';
import { componentRecords } from './component-records';
import { ComponentRoutes, type ComponentControls } from './control/component-routes';
import { ControlServer } from './control/control-server';
import { LifecycleRoutes } from './control/lifecycle-routes';
import { LogRoutes } from './control/log-routes';
import { SettingsRoutes } from './control/settings-routes';
import { StatusRoutes } from './control/status-routes';
import { WindowRoutes } from './control/window-routes';
import { DailyLogFiles } from './daily-log-files';
import { hasHandedOverRuns, retireLegacyEngine } from './legacy';
import { LegacyRunnerGate } from './legacy-runner-gate';
import { LockWriter } from './lock-writer';
import { NodeLogFileSystem } from './node-log-file-system';
import { RunnerComponent } from './runner-component';
import { SERVICE_LOCK_VERSION, removeServiceLock, type ComponentName, type ComponentRecord } from './service-lock';
import { ServiceLog, type LogComponent, type LogLevel } from './service-log';
import { ServiceSettingsReader } from './service-settings-reader';
import type { ServiceMode, ServiceStatus, ShutdownReply } from './service-status';
import { ServiceStay } from './service-stay';
import { serviceSleepVerdict, type ServiceLiveness } from './sleep';
import { WindowProcesses } from './window-processes';
import { composeVaultMcp } from './vault-mcp/compose-vault-mcp';
import type { VaultMcpComponent } from './vault-mcp/vault-mcp-component';

export { formatServiceLogLine, type LogLevel } from './service-log';
export { FIRST_DREY_WAIT_MS, WITH_DREY_GRACE_MS } from './service-stay';
export type { ServiceMode, ServiceStatus } from './service-status';
export type { ServiceHostOptions } from './service-host-options';

const NO_WINDOWS = { open: () => ({ ok: false as const, error: 'this service starts no window process' }) };

export class ServiceHost {
  private engine: Engine | null = null;
  private readonly runner: RunnerComponent;
  private readonly vaultMcp: VaultMcpComponent;
  private readonly serviceLog: ServiceLog;
  private readonly logFiles: DailyLogFiles;
  private readonly settings: ServiceSettingsReader;
  private readonly stay: ServiceStay;
  private readonly windows: WindowProcesses | null;
  private readonly logRoutes: LogRoutes;
  private control: ControlServer | null = null;
  private prefs: ServicePrefs = SERVICE_PREF_DEFAULTS;
  private token = '';
  private port = 0;
  private readonly startedAt = new Date().toISOString();
  private readonly lockWriter: LockWriter;
  private readonly legacyGate: LegacyRunnerGate;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private closing: Promise<ShutdownReply> | null = null;
  private mode: ServiceMode = 'with-drey';
  private autostartApplied: boolean | null = null;

  private constructor(private readonly opts: ServiceHostOptions) {
    this.logFiles = new DailyLogFiles(opts.home, new NodeLogFileSystem());
    this.serviceLog = new ServiceLog({ sink: opts.logSink ?? this.logFiles, ...(opts.stdout === undefined ? {} : { mirror: opts.stdout }) });
    this.settings = new ServiceSettingsReader(() => this.engine?.config ?? null);
    this.stay = new ServiceStay({ idleMs: opts.idleMs, ...(opts.now === undefined ? {} : { now: opts.now }), ...staySpans(opts) });
    this.windows = opts.spawnWindow === undefined ? null : new WindowProcesses({ spawn: opts.spawnWindow, log: (m, l) => this.log('window', m, l) });
    this.logRoutes = new LogRoutes(this.serviceLog);
    const ownConfig = new FileConfigStore(path.join(opts.home, 'config.json'));
    this.vaultMcp = composeVaultMcp({
      config: { get: (key) => (this.engine?.config ?? ownConfig).get(key) },
      invoke: () => (this.engine === null ? null : (method, payload) => this.engine!.invoke(method, payload)),
      hostedVault: opts.vaultPath,
      build: opts.build,
      log: (message, level) => this.log('mcp', message, level ?? 'info'),
      // req-213: a worker's vault write reaches Drey's vault round through the engine's paths channel.
      onChange: () => void this.refreshLock(), changed: (change) => this.engine?.emitPaths(change),
    });
    this.runner =new RunnerComponent({
      root: path.join(opts.home, 'fleet'),
      ...(opts.runnerIdleMs === undefined ? {} : { idleMs: opts.runnerIdleMs }),
      // The engine's store is the one Drey's sync writes; before it exists, the file.
      storeBacked: async () => ((await (this.engine?.config ?? ownConfig).get<string>('dk.store')) ?? '').trim() !== '',
      log: (line) => this.log('runner', line.replace(/^\[fleet [^\]]+\] /, '')),
      onChange: () => void this.refreshLock(),
      // req-180: the governor reads the Load group from the settings the tick refreshes.
      governorSettings: () => ({ heavySeats: this.prefs.heavySeats, reserve: this.prefs.reserve, lowPriority: this.prefs.lowPriority, quietHours: this.prefs.quietHours }),
      ...(opts.startRunner === undefined ? {} : { start: opts.startRunner }),
      vault: this.vaultMcp,
      // req-225: the closing round's records go to the engine's one writer of the tickets repository.
      personaRecords: { closingRound: async (write) => (this.engine === null ? null : ((await this.engine.invoke(PERSONA_RUN_METHODS.closingRound, write)) as ClosingRoundWritten)) },
    });
    this.lockWriter = new LockWriter(opts.home, (message) => this.log('service', message, 'error'));
    this.legacyGate = new LegacyRunnerGate(opts.home, this.runner, (c, m, l) => this.log(c, m, l), opts.legacy);
  }

  /** Migration, engine, control port, lock — in that order. */
  static async start(opts: ServiceHostOptions): Promise<ServiceHost> {
    const host = new ServiceHost(opts);
    await host.boot();
    return host;
  }

  log(component: LogComponent, message: string, level: LogLevel = 'info'): void {
    this.serviceLog.log(component, message, level);
  }

  private async boot(): Promise<void> {
    const { home } = this.opts;
    await fsp.mkdir(home, { recursive: true });
    this.log('service', `starting (pid ${process.pid}, build ${this.opts.build}) for ${this.opts.vaultPath}`);
    // Migration (req-164): the pre-service processes go before anything binds.
    const log = (message: string): void => this.log('service', message);
    await retireLegacyEngine(home, log, this.opts.legacy).catch((error: unknown) => log(`retiring the old engine failed: ${String(error)}`));
    await this.legacyGate.check();
    this.engine = await (this.opts.createEngine ?? createEngine)({
      vaultPath: this.opts.vaultPath,
      home,
      clientDir: this.opts.clientDir,
      log: (message, level) => this.log('engine', message, level ?? 'info'),
      runner: this.runner,
      // req-217: the brief of a 1:1 names the vault read tools the service's MCP attaches to it.
      oneOnOneTools: this.vaultMcp.oneOnOneTools,
      ...this.opts.engineOptions,
    });
    this.token = this.engine.token;
    await this.vaultMcp.start();
    await this.applySettings();
    this.control = new ControlServer(() => this.token, this.routes(), (message) => this.log('service', message, 'error'));
    this.port = await this.control.listen();
    await this.refreshLock();
    this.log('service', `up: control 127.0.0.1:${this.port}, engine ${this.engine.invokeUrl}, ${this.mode === 'background' ? 'background (outlives Drey)' : 'with Drey (the background service is off)'}`);
    // Runs a retiring runner handed over wait for a successor: wake it now.
    if (!this.legacyGate.busy && (await hasHandedOverRuns(path.join(home, 'fleet')))) {
      this.log('runner', 'handed-over runs found — waking the runner to take them back');
      void this.runner.wake();
    }
    this.windows?.sync(this.prefs.trayIcon);
    this.ticker = setInterval(() => void this.tick(), this.opts.tickMs ?? 5_000);
    this.ticker.unref();
  }

  private routes(): ConstructorParameters<typeof ControlServer>[1] {
    return [
      new StatusRoutes({ build: this.opts.build, status: () => Promise.resolve(this.status()) }),
      this.logRoutes,
      new LifecycleRoutes({ shutdown: (r) => this.shutdown(r), restart: () => this.restart(), log: (m) => this.log('service', m) }),
      new SettingsRoutes({ config: () => this.engine?.config ?? null, apply: () => this.applyAndReport() }),
      new ComponentRoutes(this.controls()),
      new WindowRoutes(this.windows ?? NO_WINDOWS),
    ];
  }

  private controls(): ComponentControls {
    return {
      wakeRunner: async () => {
        const woke = await this.runner.wake();
        return woke.ok ? { ok: true } : woke;
      },
      stopRunner: () => this.runner.stop(),
      runnerRecord: () => this.runner.record(),
      setGateway: async (enabled) => {
        if (this.engine === null) {
          return { ok: false, error: 'the engine is not up yet' };
        }
        await this.engine.invoke('configure', { enabled });
        this.log('gateway', enabled ? 'switched on from the service' : 'switched off from the service');
        await this.refreshLock();
        return { ok: true };
      },
      restartService: () => this.restart(),
    };
  }

  /** Settings → Background service, applied now: the mode, start with Windows, the log level, the idle span. */
  private async applySettings(): Promise<void> {
    this.prefs = await this.settings.read();
    const mode: ServiceMode = this.prefs.enabled ? 'background' : 'with-drey';
    if (mode !== this.mode) {
      this.log('service', mode === 'background' ? 'the background service is on — it outlives Drey' : 'the background service is off — it ends with Drey');
      this.mode = mode;
    }
    this.serviceLog.setThreshold(this.prefs.logLevel === 'quiet' ? 'quiet' : this.prefs.logLevel === 'detailed' ? 'detailed' : 'normal');
    if (this.opts.idleFromSettings === true) {
      this.stay.setIdleMs(this.prefs.idleMinutes * 60_000);
    }
    const autostart = this.prefs.enabled && this.prefs.autostart;
    if (autostart !== this.autostartApplied) {
      this.autostartApplied = autostart;
      await (this.opts.applyAutostart?.(autostart) ?? Promise.resolve()).then(
        () => this.log('service', `start with Windows: ${autostart ? 'on' : 'off'}`),
        (error: unknown) => this.log('service', `start with Windows could not be ${autostart ? 'registered' : 'removed'}: ${String(error)}`, 'warn'),
      );
    }
  }

  private async applyAndReport(): Promise<{ readonly mode: string; readonly autostart: boolean }> {
    await this.applySettings();
    await this.refreshLock();
    return { mode: this.mode, autostart: this.autostartApplied === true };
  }

  private liveness(): ServiceLiveness {
    const remote = this.engine?.remoteStatus();
    return {
      dreyClients: this.engine?.dreyClients() ?? 0,
      runnerAwake: this.runner.awake,
      gatewayServesDevices: remote !== undefined && remote.config.enabled && remote.devices.length > 0,
    };
  }

  private async tick(): Promise<void> {
    if (this.closing !== null) {
      return;
    }
    if (this.legacyGate.busy) {
      await this.legacyGate.check();
    }
    await this.applySettings();
    await this.refreshLock();
    this.windows?.sync(this.prefs.trayIcon);
    const reason = this.stay.leaveReason(this.mode, this.liveness());
    if (reason !== null) {
      this.log('service', reason);
      void this.shutdown({ handover: false });
    }
  }

  private records(): Record<ComponentName, ComponentRecord> {
    return componentRecords({
      engineUrl: this.engine?.invokeUrl ?? null,
      vaultPath: this.opts.vaultPath,
      runner: this.runner.record(),
      gateway: this.engine?.remoteStatus() ?? null,
      mcp: this.vaultMcp.record(),
    });
  }

  status(): ServiceStatus {
    const state = this.liveness();
    return {
      pid: process.pid,
      build: this.opts.build,
      startedAt: this.startedAt,
      vaultPath: this.opts.vaultPath,
      components: this.records(),
      sleep: serviceSleepVerdict(state),
      dreyClients: state.dreyClients,
      mode: this.mode,
      settings: this.prefs,
      logFolder: this.logFiles.folder,
      trayRunning: this.windows?.trayRunning ?? false,
    };
  }

  private async refreshLock(): Promise<void> {
    if (this.control === null || this.closing !== null) {
      return;
    }
    await this.lockWriter.write({
      version: SERVICE_LOCK_VERSION,
      pid: process.pid,
      build: this.opts.build,
      startedAt: this.startedAt,
      home: this.opts.home,
      vaultPath: this.opts.vaultPath,
      port: this.port,
      token: this.token,
      mode: this.mode,
      components: this.records(),
    });
  }

  /** The atomic restart (req-165): the runs are handed over, the successor starts once this service has let go. */
  restart(): Promise<ShutdownReply> {
    return this.shutdown({ handover: true, successor: true });
  }

  /**
   * Leaves. `handover` (a newer build, req-51, or a restart): the runner
   * hands its runs over — refused while a run is in its gate, and then the
   * service serves on. Otherwise the runner stops its live runs first.
   */
  shutdown(request: { readonly handover: boolean; readonly successor?: boolean }): Promise<ShutdownReply> {
    if (this.closing !== null) {
      return this.closing;
    }
    const closing = this.letGo(request.handover);
    this.closing = closing.then(async (reply) => {
      if (!reply.ok) {
        this.closing = null;
        return reply;
      }
      await this.close(request.successor === true);
      return reply;
    });
    return this.closing;
  }

  private async letGo(handover: boolean): Promise<ShutdownReply> {
    if (!handover) {
      await this.runner.stop().catch((error: unknown) => this.log('runner', `stop failed: ${String(error)}`, 'warn'));
      return { ok: true };
    }
    const reply = await this.runner.handOver().catch((error: unknown) => ({ ok: false as const, error: String(error) }));
    if (!reply.ok) {
      this.log('service', `handover deferred: ${reply.error}`, 'warn');
      return reply;
    }
    this.log('service', 'handed the runs over — leaving');
    return { ok: true };
  }

  private async close(successor: boolean): Promise<void> {
    if (this.ticker !== null) {
      clearInterval(this.ticker);
    }
    this.windows?.stopAll();
    await this.vaultMcp.stop();
    await this.engine?.close().catch((error: unknown) => this.log('engine', `close failed: ${String(error)}`, 'warn'));
    await removeServiceLock(this.opts.home, process.pid).catch(() => undefined);
    if (successor && this.opts.respawn !== undefined) {
      this.opts.respawn();
      this.log('service', 'restarting: the successor is starting');
    }
    this.log('service', 'stopped');
    await this.serviceLog.flush();
    this.logRoutes.closeAll();
    this.control?.close();
    setTimeout(() => this.opts.exit(0), 50).unref?.();
  }
}
