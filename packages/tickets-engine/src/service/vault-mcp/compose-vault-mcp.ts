/**
 * The `mcp` component's wiring (req-167): the Node adapters (disk, crypto,
 * launch files, the HTTP face) and the engine's two seams — its config (the
 * registered vaults Drey names) and its board (the personas' grants). Called
 * once by the service host; a spec builds the parts over fakes instead.
 */
import type { Persona } from '../../core/persona';
import { PersonaRights } from './persona-rights';
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
  readonly invoke: () => ((method: string) => Promise<unknown>) | null;
  /** The vault the service was started for. */
  readonly hostedVault: string;
  readonly build: string;
  readonly log: (message: string, level?: 'info' | 'warn' | 'error') => void;
  readonly onChange: () => void;
  /** A worker's call changed files (req-213): the engine's paths channel hears it. */
  readonly changed?: (change: VaultPathsChange) => void;
}

/** A persona's `allowed: write-vaults`, read off the board's persona list at every call. */
function personaSource(invoke: VaultMcpWiring['invoke']): { writeVaultsOf(id: string): Promise<readonly string[] | null> } {
  return {
    writeVaultsOf: async (id) => {
      const call = invoke();
      if (call === null) {
        return null;
      }
      const personas = (await call('listPersonas')) as readonly Persona[];
      const persona = personas.find((p) => p.id === id);
      return persona === undefined ? null : (persona.allowed.writeVaults ?? []);
    },
  };
}

export function composeVaultMcp(wiring: VaultMcpWiring): VaultMcpComponent {
  const disk = new NodeVaultDisk();
  const now = (): Date => new Date();
  const calls = new VaultMcpCalls({
    vaults: new RegisteredVaults(wiring.config, wiring.hostedVault, disk),
    disk,
    rights: new PersonaRights(personaSource(wiring.invoke)),
    auditor: new VaultCallAuditor({ now, log: wiring.log }),
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
