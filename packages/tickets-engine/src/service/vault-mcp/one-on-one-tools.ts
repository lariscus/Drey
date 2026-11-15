import { harnessTakesMcp } from '../../fleet/harness/mcp-support';
import { ONE_ON_ONE_VAULT_TOOLS, type OneOnOneSeat, type OneOnOneToolSeam } from '../../fleet/session/one-on-one-toolset';
import type { WorkerProviderId } from '../../fleet/protocol';

export interface OneOnOneToolsDeps {
  /** Is the vault MCP listening now? A 1:1 started while it is not has no vault (a stream note says so). */
  readonly listening: () => boolean;
  /** Does this harness describe an MCP launch? */
  readonly takesMcp?: (provider: WorkerProviderId) => boolean;
}

/**
 * The 1:1's tool seam over Drey Service's vault MCP (req-217, ADR-0093 ×
 * ADR-0094): what the brief may name is what the spawn path will really
 * attach — the vault read tools, when the endpoint listens and the persona's
 * harness takes an MCP configuration. A persona with no harness (`api`)
 * talks over the chat bridge and has no tools. The fleet's `fleet_status` /
 * `fleet_watch` are Drey's own server's, not served here (req-252).
 */
export class OneOnOneVaultTools implements OneOnOneToolSeam {
  constructor(private readonly deps: OneOnOneToolsDeps) {}

  attached(seat: OneOnOneSeat): readonly string[] {
    if (seat.provider === null || !this.deps.listening()) {
      return [];
    }
    return (this.deps.takesMcp ?? harnessTakesMcp)(seat.provider) ? ONE_ON_ONE_VAULT_TOOLS : [];
  }
}
