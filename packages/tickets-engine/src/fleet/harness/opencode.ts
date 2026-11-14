/**
 * The `opencode` harness over ACP (req-182; replaces the `opencode serve`
 * adapter of ADR-0075): `opencode acp`, newline-delimited JSON-RPC on
 * stdio, measured against opencode 2.0.32. It advertises `loadSession` and
 * `session/resume`; approvals arrive as `session/request_permission` (when
 * opencode's own permission config says `ask`), its question tool as an
 * `elicitation/create` form (the client advertises `elicitation.form`); the
 * prompt reply carries the turn's tokens, `usage_update` the context window
 * and the session's cost. Login is opencode's own (`opencode auth login`).
 */
import type { SpawnFn } from '../ports/process-spawner';
import { AcpAdapter } from './acp-adapter';
import type { AcpHarness } from './acp-harness';
import { PromptUsageMeter } from './acp-usage';
import type { NowFn, ProviderAdapter } from './contract';
import { opencodeLaunchConfig, opencodeModeFor, opencodeModelSettings } from './opencode-settings';

export function opencodeHarness(): AcpHarness {
  return {
    id: 'opencode',
    label: 'OpenCode',
    agent: 'opencode',
    launch: (start) => {
      const config = opencodeLaunchConfig(start);
      const note = config.notes.length > 0 ? { note: config.notes.join(' · ') } : {};
      return config.content === null
        ? { command: 'opencode', args: ['acp'], ...note }
        : { command: 'opencode', args: ['acp'], env: { OPENCODE_CONFIG_CONTENT: config.content }, ...note };
    },
    clientCapabilities: { elicitation: { form: {} } },
    resume: ['resume', 'load'],
    modelSettings: opencodeModelSettings,
    modeFor: opencodeModeFor,
    meter: () => new PromptUsageMeter(),
    emptyTurnIsRefusal: true,
  };
}

export function opencodeAdapter(spawnFn: SpawnFn, now: NowFn = (): Date => new Date()): ProviderAdapter {
  return new AcpAdapter(opencodeHarness(), spawnFn, now);
}
