/**
 * What an ACP harness offers (req-286): opencode, Kimi CLI and Copilot CLI
 * list their models in the `session/new` reply — a config option of id or
 * category `model` with its `options` (`{ value, name }`, opencode 2.0.32),
 * or ACP's `models.availableModels` (`{ modelId, name }`). `initialize`
 * names the version (`agentInfo.version`); a `session/new` refused with
 * "Authentication required" means signed out (Kimi 2.5.2). The probe's
 * session is deleted again where the agent offers it.
 */
import type { OfferedModel, ProbeOutcome, WorkerProviderId } from '../protocol';
import type { SpawnFn } from '../ports/process-spawner';
import { AcpClient } from './acp-client';
import type { BinaryLocator } from './probe-binary';

const PROBE_MS = 45_000;

type Entry = Readonly<Record<string, unknown>>;
const isEntry = (value: unknown): value is Entry => typeof value === 'object' && value !== null && !Array.isArray(value);
const textOf = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);
const listOf = (value: unknown): readonly Entry[] => (Array.isArray(value) ? value.filter(isEntry) : []);

/** The harness an ACP probe asks, and how it is started. */
export interface AcpProbeTarget {
  readonly provider: WorkerProviderId;
  readonly label: string;
  readonly command: string;
  readonly args: readonly string[];
}

export const ACP_PROBE_TARGETS: readonly AcpProbeTarget[] = [
  { provider: 'opencode', label: 'opencode', command: 'opencode', args: ['acp'] },
  { provider: 'kimi', label: 'Kimi CLI', command: 'kimi', args: ['acp'] },
  { provider: 'copilot', label: 'Copilot CLI', command: 'copilot', args: ['--acp', '--stdio'] },
];

/** The models a `session/new` result offers, in its order. */
export function acpModelsOf(result: Entry): OfferedModel[] {
  const option = listOf(result['configOptions']).find((o) => o['id'] === 'model' || o['category'] === 'model');
  const fromOption = listOf(option?.['options']).map((o) => ({ model: textOf(o['value']), name: textOf(o['name']) }));
  const models = isEntry(result['models']) ? listOf(result['models']['availableModels']).map((m) => ({ model: textOf(m['modelId']), name: textOf(m['name']) })) : [];
  const found: OfferedModel[] = [];
  for (const entry of [...fromOption, ...models]) {
    if (entry.model !== null && !found.some((m) => m.model === entry.model)) {
      found.push({ model: entry.model, name: entry.name });
    }
  }
  return found;
}

export class AcpProbe {
  readonly provider: WorkerProviderId;
  readonly label: string;

  private readonly cwd: string;
  private readonly timeoutMs: number;

  constructor(
    private readonly target: AcpProbeTarget,
    private readonly spawnFn: SpawnFn,
    private readonly locator: BinaryLocator,
    /** Where the probe's session starts; how long it may take (45 s). */
    place: { readonly cwd: string; readonly timeoutMs?: number },
  ) {
    this.provider = target.provider;
    this.label = target.label;
    this.cwd = place.cwd;
    this.timeoutMs = place.timeoutMs ?? PROBE_MS;
  }

  async probe(): Promise<ProbeOutcome> {
    if ((await this.locator.find(this.target.command)) === null) {
      return { installed: false, version: null, signedIn: null, models: [], error: null };
    }
    const proc = this.spawnFn(this.target.command, this.target.args, { cwd: this.cwd });
    const acp = new AcpClient(proc, { onRequest: () => undefined, onNotification: () => undefined, onNoise: () => undefined }, this.target.command);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<ProbeOutcome>((resolve) => {
      timer = setTimeout(() => resolve(failed(`${this.label} did not answer`)), this.timeoutMs);
    });
    const outcome = await Promise.race([this.ask(acp), deadline]);
    clearTimeout(timer);
    await proc.killTree().catch(() => undefined);
    return outcome;
  }

  private async ask(acp: AcpClient): Promise<ProbeOutcome> {
    const init = await acp.call('initialize', { protocolVersion: 1, clientCapabilities: {} });
    if (init.error !== undefined) {
      return failed(`${this.label}: ${init.error.message ?? 'initialize refused'}`);
    }
    const info = isEntry(init.result?.['agentInfo']) ? init.result['agentInfo'] : {};
    const version = textOf(info['version']);
    const session = await acp.call('session/new', { cwd: this.cwd, mcpServers: [] });
    if (session.error !== undefined) {
      const message = session.error.message ?? 'session/new refused';
      return /auth/i.test(message) ? { installed: true, version, signedIn: false, models: [], error: null } : { ...failed(`${this.label}: ${message}`), version };
    }
    const result = session.result ?? {};
    await this.deleteSession(acp, init.result ?? {}, textOf(result['sessionId']));
    return { installed: true, version, signedIn: true, models: acpModelsOf(result), error: null };
  }

  /** Best effort: the probe leaves no session behind where the agent can delete one. */
  private async deleteSession(acp: AcpClient, init: Entry, sessionId: string | null): Promise<void> {
    const capabilities = isEntry(init['agentCapabilities']) ? init['agentCapabilities'] : {};
    const session = isEntry(capabilities['sessionCapabilities']) ? capabilities['sessionCapabilities'] : {};
    if (sessionId !== null && session['delete'] !== undefined) {
      await Promise.race([acp.call('session/delete', { sessionId }), new Promise((resolve) => setTimeout(resolve, 2_000))]);
    }
  }
}

function failed(error: string): ProbeOutcome {
  return { installed: true, version: null, signedIn: null, models: [], error };
}
