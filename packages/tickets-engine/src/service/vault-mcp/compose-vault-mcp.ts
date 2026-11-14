/**
 * The `mcp` component's wiring (req-167): the Node adapters (disk, crypto,
 * launch files, the HTTP face) and the engine's two seams — its config (the
 * registered vaults Drey names) and its board (the project records and the
 * personas' `write-notes`, req-283). Called
 * once by the service host; a spec builds the parts over fakes instead.
 */
import { PERSONA_RUN_METHODS, type RunRecordReply } from '../../contracts/persona-run-records';
import type { ProjectRecord } from '../../contracts/projects';
import type { Persona } from '../../core/persona';
import { PersonaRecordTools, type PersonaRecordsPort } from './persona-record-tools';
import { ProjectRights, type RightsSource } from './project-rights';
import { RegisteredVaults, type VaultsConfig } from './registered-vaults';
import { RunTokens } from './run-tokens';
import { VaultCallAuditor } from './vault-call-auditor';
import { VaultMcpCalls } from './vault-mcp-calls';
import { VaultMcpComponent } from './vault-mcp-component';
import { VaultMcpHttp } from './vault-mcp-http';
import type { VaultPathsChange } from './vault-paths-change';
import { NodeLaunchFiles } from './launch-files';
import { NodeTokenCrypto } from './node-token-crypto';
import { NodeVaultDisk } from './node-vault-disk';

export interface VaultMcpWiring {
  /** The engine's config, once the engine is up (the service's own file before). */
  readonly config: VaultsConfig;
  /** The engine's invoke channel; null before the engine is up. */
  readonly invoke: () => ((method: string, payload?: unknown) => Promise<unknown>) | null;
  /** The vault the service was started for. */
  readonly hostedVault: string;
  readonly build: string;
  readonly log: (message: string, level?: 'info' | 'warn' | 'error') => void;
  readonly onChange: () => void;
  /** A worker's call changed files (req-213): the engine's paths channel hears it. */
  readonly changed?: (change: VaultPathsChange) => void;
}

/** req-226: the worker's own persona writes go to the engine's one writer of the tickets repository. */
function recordsPort(invoke: VaultMcpWiring['invoke']): PersonaRecordsPort {
  const call = async (method: string, payload: unknown): Promise<RunRecordReply> => {
    const channel = invoke();
    return channel === null ? { ok: false, error: 'the engine is not up' } : ((await channel(method, payload)) as RunRecordReply);
  };
  return {
    memoryWrite: (write) => call(PERSONA_RUN_METHODS.memory, write),
    journalWrite: (write) => call(PERSONA_RUN_METHODS.journal, write),
  };
}

/** req-283: the board's project records and a persona's `allowed: write-notes`, read through the engine at every call. */
function rightsSource(invoke: VaultMcpWiring['invoke']): RightsSource {
  const call = (method: string): Promise<unknown> => {
    const channel = invoke();
    return channel === null ? Promise.reject(new Error('the engine is not up')) : channel(method);
  };
  return {
    projects: async () => (await call('projectRecords')) as readonly ProjectRecord[],
    writesNotes: async (id) => ((await call('listPersonas')) as readonly Persona[]).find((p) => p.id === id)?.allowed.writeNotes === true,
  };
}

export function composeVaultMcp(wiring: VaultMcpWiring): VaultMcpComponent {
  const disk = new NodeVaultDisk();
  const now = (): Date => new Date();
  const calls = new VaultMcpCalls({
    vaults: new RegisteredVaults(wiring.config, wiring.hostedVault, disk),
    disk,
    rights: new ProjectRights(rightsSource(wiring.invoke), disk),
    auditor: new VaultCallAuditor({ now, log: wiring.log }),
    records: new PersonaRecordTools(recordsPort(wiring.invoke)),
    ...(wiring.changed === undefined ? {} : { changed: wiring.changed }),
  });
  return new VaultMcpComponent({
    endpoint: (handler) => new VaultMcpHttp(handler, wiring.build),
    tokens: new RunTokens(new NodeTokenCrypto()),
    calls,
    files: new NodeLaunchFiles(),
    now,
    log: wiring.log,
    onChange: wiring.onChange,
  });
}
